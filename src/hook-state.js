/** Daemon, sessions, public state, events and the transcript-interrupt watcher. */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const { execFileSync } = require("child_process");

const { AudioPlayer } = require("./player");

const { STATE_DIR, PID_FILE, INTENSITY_FILE, SESSIONS_DIR, EVENTS_FILE, ANON_SESSION, CLI_ENTRY, readIntensity, parsePayload, payloadSession, payloadProject, MAX_DAEMON_MS, DAEMON_CEILING_MS, projectName } = require("./hook-core");
const { TARGETS } = require("./hook-targets");


function settingsPath() {
  return TARGETS.claude.file();
}

function readPid() {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch (e) {
    return null;
  }
}

/**
 * A pid file outlives its daemon whenever the daemon dies without cleanup
 * (SIGKILL, crash, reboot), and the OS recycles pids - so the number alone is
 * not proof of what it now names. hookStart calls stopDaemon on every prompt,
 * so an unverified kill would eventually SIGTERM an unrelated process.
 *
 * Failing closed is the safe direction here: a daemon we decline to kill stops
 * itself once no session is left (MAX_DAEMON_MS of silence), while killing a stranger's process has no such
 * ceiling.
 *
 * ponytail: posix only. Windows has no cheap command-line lookup, so the pid
 * is trusted there as before; revisit if hooks see real Windows use.
 */
function daemonArgv(pid) {
  if (process.platform === "win32") return null;
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "args="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      // Run on every prompt: a ps that never answers must not hold the hook.
      timeout: 3000,
      killSignal: "SIGKILL"
    });
  } catch (e) {
    return null; // No such process, ps unavailable, or it did not answer in time.
  }
}

function isOurDaemon(pid) {
  if (process.platform === "win32") return true;
  const out = daemonArgv(pid);
  // Failing closed: no argv means no kill.
  return out !== null && out.includes("vibeaudio") && out.includes("--daemon");
}

/**
 * What the background player is playing right now, or null if nothing is.
 *
 * Read from the daemon's own command line rather than a file it would have to
 * keep in step - spawnDaemon() puts the settings there already, and a process
 * that dies without cleanup cannot leave a stale answer behind. It is the
 * settings *in flight*, which is the question a running daemon raises: a
 * genre saved a moment ago does not reach it until the next prompt.
 */
function daemonPlaying() {
  const pid = readPid();
  if (pid === null || !isOurDaemon(pid)) return null;

  const argv = daemonArgv(pid) || "";
  const genre = /--genre (\S+)/.exec(argv);
  const volume = /--volume (\d+)/.exec(argv);
  return {
    pid,
    genre: genre ? genre[1] : null,
    volume: volume ? Number(volume[1]) : null,
    reactive: /--reactive/.test(argv),
    follows: /--follow-volume/.test(argv)
  };
}

/**
 * Stops the player. `keepSessions` leaves the session files alone: the hooks
 * use it because they decide per session what is still going on, and --mute
 * because a mute is about sound - the turns are still in flight, and should
 * still reach --state, --events and --report. --stop and uninstall end
 * everything, or a later tool call would resume music nobody is waiting for;
 * each session dropped gets an `ended` event with that `reason`, or an
 * --events consumer would show it working forever (#24).
 */
function stopDaemon({ keepSessions = false, reason = "stop" } = {}) {
  const pid = readPid();
  fs.rmSync(PID_FILE, { force: true });
  if (!keepSessions) {
    // Removed before its event, so each line's status is what it left behind
    // and the last one reads idle.
    for (const s of listSessions()) {
      fs.rmSync(sessionFile(s.id), { force: true });
      emitEvent("ended", s.id, s.project, { reason });
    }
    fs.rmSync(SESSIONS_DIR, { recursive: true, force: true });
  }
  if (pid === null || !isOurDaemon(pid)) return false;

  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch (e) {
    return false; // Already gone
  }
}

function fileSize(file) {
  try {
    return fs.statSync(file).size;
  } catch (e) {
    return 0;
  }
}

/**
 * A turn starts at a prompt. The transcript offset is taken here, not when a
 * daemon spawns, because a resume respawns the daemon mid-turn - and an
 * interrupt written just before that must still count.
 */
function newTurn(raw) {
  const payload = parsePayload(raw);
  const transcript = typeof payload.transcript_path === "string" ? payload.transcript_path : "";
  const offset = transcript ? fileSize(transcript) : 0;
  return {
    session: String(payloadSession(payload) || ""),
    project: payloadProject(payload) || process.cwd(),
    transcript,
    offset,
    blocked: blockedJustBefore(transcript, offset),
    // Antigravity has no prompt event: its start is PreInvocation, which fires
    // before every model call and counts them from 0 within the turn. Only the
    // first one is a new turn; the rest would restart the music mid-turn.
    continues: Number(payload.invocationNum) > 0
  };
}

const BLOCK_LOOKBACK_MS = 3000;

/**
 * Whether another hook has already rejected this very prompt. Hooks run side
 * by side and a native blocker is faster to start than we are, so its transcript
 * entry can land *before* the offset taken above - where the daemon, which reads
 * only what follows, would never see it. Looked at the tail instead, and only
 * for an entry stamped within the last moments, so an earlier blocked prompt
 * does not silence this one.
 */
function blockedJustBefore(transcript, offset) {
  if (!transcript || !offset) return false;
  try {
    const len = Math.min(offset, 16384);
    const fd = fs.openSync(transcript, "r");
    const buf = Buffer.alloc(len);
    try {
      fs.readSync(fd, buf, 0, len, offset - len);
    } finally {
      fs.closeSync(fd);
    }
    const lines = buf.toString("utf8").split("\n");
    if (len < offset) lines.shift(); // Began mid-line.
    return lines.some((line) => {
      if (!isInterruptEntry(line)) return false;
      try {
        return Date.now() - Date.parse(JSON.parse(line).timestamp) <= BLOCK_LOOKBACK_MS;
      } catch (e) {
        return false;
      }
    });
  } catch (e) {
    return false;
  }
}

// The id ends up in a file name.
function sessionId(id) {
  return String(id || ANON_SESSION).replace(/[^\w.-]/g, "_").slice(0, 100);
}

function sessionFile(id) {
  return path.join(SESSIONS_DIR, `${id}.json`);
}

function readSession(id) {
  try {
    return JSON.parse(fs.readFileSync(sessionFile(id), "utf8"));
  } catch (e) {
    return null;
  }
}

// Written beside the target and renamed into place: the daemon lists this
// directory every poll and must never read half a file.
function writeSession(id, data) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  const tmp = `${sessionFile(id)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...data, ts: Date.now() }));
  fs.renameSync(tmp, sessionFile(id));
}

/**
 * Every session with a turn in flight. One that has not been touched for
 * MAX_DAEMON_MS is a crashed agent - it never sent Stop - and is dropped here;
 * the daemon stops once none is left, with DAEMON_CEILING_MS as the backstop.
 */
function listSessions() {
  let names;
  try {
    names = fs.readdirSync(SESSIONS_DIR);
  } catch (e) {
    return [];
  }
  const now = Date.now();
  const sessions = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -".json".length);
    const data = readSession(id);
    if (!data) continue;
    if (now - (data.ts || 0) > MAX_DAEMON_MS) fs.rmSync(sessionFile(id), { force: true });
    else sessions.push({ id, ...data });
  }
  return sessions;
}

// Working, as opposed to paused for the user.
const working = (sessions) => sessions.filter((s) => s.waiting == null);

// "Stuck": STUCK_FAILURES of a session's last STUCK_WINDOW tool calls failed.
// Measured on 4,497 real Claude Code turns (46,032 tool calls, 3.8% failing):
// this fires in 0.9% of turns, at minute 3 by the median, and those turns ran
// a median 3.3 minutes more - time someone could have stepped in. "3 of 8"
// fired in 2.4%, and "3 in a row" misses the usual loop, where an edit that
// succeeds sits between every failing test run. Rare is the point: a signal
// that fires often is one people learn to tune out.
const STUCK_WINDOW = 8;
const STUCK_FAILURES = 4;
const isStuck = (session) => (session.recent || []).filter(Boolean).length >= STUCK_FAILURES;

/**
 * The public face of the session files: what every agent on the machine is
 * doing, in five words that mean the same thing whichever agent it is. The
 * hard part of this project is mapping eight agents' hook events onto those
 * states; the music is one consumer of them, and `vibe --state` / `--events`
 * let anything else be another - a light, a menu bar, a tmux status line.
 * `status` is the machine's: the most urgent of its sessions, since one
 * session waiting on you matters more than three working.
 */
const STATE_RANK = ["idle", "working", "stuck", "waiting"];
const sessionState = (s) => (s.waiting != null ? "waiting" : isStuck(s) ? "stuck" : "working");

function agentState(sessions = listSessions()) {
  const list = sessions.map((s) => ({
    session: s.id,
    project: s.project || null,
    state: sessionState(s),
    since: s.started || null,
    ...(s.waiting ? { tool: s.waiting } : {}),
    ...(s.waiting != null && s.waitStart ? { waitingSince: s.waitStart } : {})
  }));
  const status = list.reduce((a, s) => (STATE_RANK.indexOf(s.state) > STATE_RANK.indexOf(a) ? s.state : a), "idle");
  return { v: 1, status, sessions: list };
}

/**
 * `vibe --statusline`: the state as one plain line for a tmux segment or a
 * shell prompt, and nothing at all when idle so the segment disappears. The
 * most urgent status, with a count when more than one session is in it; a
 * waiting session names its project, since that is the one you have to go to.
 * Plain text because tmux and Starship style it themselves.
 */
function formatStatusline({ status, sessions }) {
  if (status === "idle") return "";
  const active = sessions.filter((s) => s.state === status);
  const project = status === "waiting" && active[0].project ? `: ${projectName(active[0].project)}` : "";
  return `${status}${project}${active.length > 1 ? ` ×${active.length}` : ""}`;
}

/**
 * "Why is it silent?" / "why is it still playing?" as one line, the first of
 * --status (#76). Pure over what --status gathers (`musicFacts()` in cli.js),
 * so the order is the test: what silences everything (VIBE_DISABLE, a mute)
 * outranks what silences only the music, and a running player outranks every
 * reason it might not be running. Each silent line names the command that
 * changes it. `mute` is the minutes left, Infinity for an open-ended mute,
 * null when not muted; `musicSource` is "env", "project" or "" (saved or default).
 */
function explainMusic({ disabledByEnv, mute, backend, daemon, genre, volume, music, musicSource, sessions }) {
  const names = (list) => {
    const all = [...new Set(list.map((s) => (s.project ? projectName(s.project) : null)).filter(Boolean))];
    return all.length > 3 ? `${all.slice(0, 3).join(", ")} +${all.length - 3}` : all.join(", ");
  };
  const counted = (list, word) => {
    const n = names(list);
    return `${list.length} session${list.length === 1 ? "" : "s"} ${word}${n ? ` (${n})` : ""}`;
  };
  const silent = (text) => ({ playing: false, text: `silent: ${text}` });
  const working = sessions.filter((s) => s.state !== "waiting");
  const waiting = sessions.filter((s) => s.state === "waiting");

  if (disabledByEnv) return silent("VIBE_DISABLE is set in this shell (unset it to hear music)");
  if (mute != null) return silent(`muted ${mute === Infinity ? "until you unmute" : `for ${mute} more min`} (vibe --unmute)`);
  if (!backend) return silent("no audio player found on this machine (vibe --doctor)");
  if (daemon) {
    const stuck = sessions.filter((s) => s.state === "stuck");
    const level = volume === null ? "" : ` @ ${volume}%`;
    return {
      playing: true,
      text: `playing: ${daemon.genre || genre}${level}, ${working.length ? counted(working, "working") : "finishing a turn"}` +
        `${stuck.length ? `; heartbeat on, ${names(stuck) || "a session"} keeps failing` : ""}`
    };
  }
  if (waiting.length && !working.length) return silent(`${counted(waiting, "waiting on you")}; music resumes when you answer`);
  if (!music) {
    // The fix has to beat whatever turned it off: a saved global does not outrank an export or --here.
    const [where, fix] = { env: [" by VIBE_MUSIC in this shell", "unset VIBE_MUSIC"], project: [" for this project", "vibe --music on --here"] }[musicSource] || ["", "vibe --music on"];
    return silent(`music is off${where}; chimes still play (${fix})`);
  }
  if (working.length) return silent(`${counted(working, "working")} but the player is not running (vibe --doctor)`);
  return silent("no agent is working; music starts with your next prompt");
}

const EVENTS_MAX_BYTES = 256 * 1024;

/**
 * Appends one transition to ~/.vibeaudio/events.jsonl, after the session file
 * already reflects it, so `status` is the state the event left behind. Not
 * gated by a mute: a mute silences sound, and a light watching this is not
 * sound. Rotated to `.1` rather than trimmed in place, so a follower sees a
 * fresh file instead of re-reading the lines a trim kept. Never throws.
 */
function emitEvent(event, session, project, extra = {}) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    try {
      if (fs.statSync(EVENTS_FILE).size > EVENTS_MAX_BYTES) fs.renameSync(EVENTS_FILE, `${EVENTS_FILE}.1`);
    } catch (e) { /* no file yet */ }
    const line = { v: 1, at: Date.now(), event, session, project: project || null, ...extra, status: agentState().status };
    fs.appendFileSync(EVENTS_FILE, `${JSON.stringify(line)}\n`); // One write under PIPE_BUF: appends do not interleave.
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * `vibe --events`: the current state as one line, then every event as it is
 * written, until killed. Polled rather than fs.watch'd, which is unreliable on
 * the platforms this runs on; a quarter second is well inside a turn.
 */
function followEvents(write = (s) => process.stdout.write(s), pollMs = 250) {
  write(`${JSON.stringify({ event: "state", at: Date.now(), ...agentState() })}\n`);
  const stat = () => {
    try {
      const st = fs.statSync(EVENTS_FILE);
      return { size: st.size, ino: st.ino };
    } catch (e) {
      return { size: 0, ino: null };
    }
  };
  let { size: pos, ino } = stat();
  let partial = "";
  return setInterval(() => {
    const now = stat();
    if (now.ino !== ino || now.size < pos) {
      ino = now.ino; // Rotated: the new file holds only what came after.
      pos = 0;
      partial = "";
    }
    if (now.size <= pos) return;
    try {
      const fd = fs.openSync(EVENTS_FILE, "r");
      const buf = Buffer.alloc(now.size - pos);
      fs.readSync(fd, buf, 0, buf.length, pos);
      fs.closeSync(fd);
      pos = now.size;
      const lines = (partial + buf.toString("utf8")).split("\n");
      partial = lines.pop();
      for (const l of lines) if (l) write(`${l}\n`);
    } catch (e) { /* removed between stat and open: next poll */ }
  }, pollMs);
}

/** The last `n` events in the log, oldest first; [] when there is none yet. */
function recentEvents(n = 25) {
  try {
    return fs.readFileSync(EVENTS_FILE, "utf8").split("\n").filter(Boolean).slice(-n).flatMap((l) => {
      try { return [JSON.parse(l)]; } catch (e) { return []; } // a torn line is not worth losing the rest
    });
  } catch (e) {
    return [];
  }
}

// Claude Code's entry for Esc / the stop button: a user message whose text is
// "[Request interrupted by user]" or "... for tool use]".
const INTERRUPT_MARK = "[Request interrupted by user";
const BLOCKED_MARK = "UserPromptSubmit operation blocked by hook";

function isInterruptEntry(line) {
  if (!line.includes(INTERRUPT_MARK) && !line.includes(BLOCKED_MARK)) return false; // Cheap filter before parsing.
  try {
    const entry = JSON.parse(line);
    // A prompt another hook blocked: hooks run side by side, so ours had already
    // started the music, and no Stop will ever follow. The turn is over before
    // it began, which is the same silent end as an interrupt.
    if (entry.type === "system" && typeof entry.content === "string") return entry.content.startsWith(BLOCKED_MARK);
    if (entry.type !== "user" || !entry.message) return false;
    // Structural, not substring: a transcript that merely quotes the phrase -
    // in a tool result, a file, a prompt about this very feature - is not one.
    const content = entry.message.content;
    const texts = typeof content === "string"
      ? [content]
      : Array.isArray(content) ? content.filter((b) => b && b.type === "text").map((b) => b.text) : [];
    return texts.some((t) => typeof t === "string" && t.startsWith(INTERRUPT_MARK));
  } catch (e) {
    return false;
  }
}

/**
 * Interrupting Claude Code (Esc in the terminal, stop in the desktop app or an
 * IDE) fires no hook at all - not Stop, not StopFailure, and mid-tool only a
 * plain PostToolUse. What it always does is append an interrupt entry to the
 * transcript. Returns a poll that reads only what was appended since `offset`
 * and reports whether one arrived.
 */
function interruptWatcher(transcript, offset) {
  const { StringDecoder } = require("string_decoder");
  const decoder = new StringDecoder("utf8"); // A read can split a multibyte character.
  let pos = offset;
  let partial = "";

  return () => {
    try {
      const size = fileSize(transcript);
      if (size <= pos) return false;
      const fd = fs.openSync(transcript, "r");
      const buf = Buffer.alloc(size - pos);
      try {
        fs.readSync(fd, buf, 0, buf.length, pos);
      } finally {
        fs.closeSync(fd);
      }
      pos = size;
      const lines = (partial + decoder.write(buf)).split("\n");
      partial = lines.pop(); // Not a whole line yet.
      return lines.some(isInterruptEntry);
    } catch (e) {
      return false; // Unreadable transcript: the MAX_DAEMON_MS ceiling still applies.
    }
  };
}

const INTERRUPT_POLL_MS = 500;

/**
 * Internal mode: plays while any session is working. The player's own loop
 * timer keeps the event loop alive.
 */
function runDaemon(genre, volume, { reactive = false, volumeSource = null } = {}) {
  const watchers = new Map(); // session id -> its transcript poll

  // Drops sessions whose transcript shows an interrupt (Esc fires no hook, so
  // this is the only way to learn of one) and says whether any is still working.
  const sweep = () => {
    const sessions = listSessions();
    for (const id of watchers.keys()) if (!sessions.some((s) => s.id === id)) watchers.delete(id);
    for (const s of sessions) {
      if (!s.transcript) continue;
      // Built from the offset taken at the prompt, so a daemon respawned mid-turn
      // still sees an interrupt that came before it.
      if (!watchers.has(s.id)) watchers.set(s.id, interruptWatcher(s.transcript, s.offset));
      if (watchers.get(s.id)()) {
        fs.rmSync(sessionFile(s.id), { force: true });
        watchers.delete(s.id);
        emitEvent("interrupted", s.id, s.project);
      }
    }
    return working(listSessions()).length > 0;
  };

  // Silent, like Ctrl+C in the wrapper: an interrupt is never reported as done.
  const endIdle = () => {
    if (readPid() === process.pid) {
      fs.rmSync(PID_FILE, { force: true });
      fs.rmSync(INTENSITY_FILE, { force: true });
    }
    process.exit(0);
  };
  if (!sweep()) endIdle(); // Already interrupted before this daemon started.

  const player = new AudioPlayer();
  const started = player.start(genre, volume, {
    intensity: reactive ? readIntensity : null,
    // The same piece with more of it, as time escalation already does: two
    // sessions working is tier 2 at least, three or more is tier 3. Read at
    // each loop boundary, so it lands cleanly and eases off as they finish.
    minTier: () => Math.min(3, working(listSessions()).length),
    // A heartbeat under the music while any working session looks stuck.
    tension: () => working(listSessions()).some(isStuck)
  });
  if (!started) process.exit(0);

  // A second signal while fading changes nothing; the fade ends by itself.
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    player.fadeOut(() => process.exit(0));
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  setTimeout(shutdown, DAEMON_CEILING_MS);

  setInterval(() => {
    // The pid file names the one daemon that owns the speakers. Two prompts
    // at once can each find none running and spawn one; the last to write the
    // file wins, and the other must not play over it (#42).
    // ponytail: up to one poll of doubled audio; claim the pid file with an
    // exclusive create before spawning if that ever matters.
    if (readPid() !== process.pid) return shutdown();
    // A volume saved while this plays reaches it now, not at the next prompt.
    if (volumeSource) player.setVolume(volumeSource());
    if (sweep()) return;
    player.stop({ playChime: false });
    endIdle();
  }, INTERRUPT_POLL_MS);
}

function daemonRunning() {
  const pid = readPid();
  return pid !== null && isOurDaemon(pid);
}

function spawnDaemon(genre, volume, reactive, follow = false) {
  const args = [CLI_ENTRY, "--daemon", "--genre", genre, "--volume", String(Math.round(volume * 100))];
  if (reactive) args.push("--reactive");
  if (follow) args.push("--follow-volume");

  const child = spawn(process.execPath, args, { detached: true, stdio: "ignore" });
  child.unref();

  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(PID_FILE, String(child.pid));
  return child.pid;
}

/**
 * A prompt. With no other session working this replaces the player, as it
 * always did, so a genre change lands on the next prompt. With one working the
 * music carries on: restarting it would cut every other session's stream.
 */
function hookStart(genre, volume, { reactive = false, turn = null, follow = false, music = true } = {}) {
  if (turn && turn.blocked) return null; // Rejected before it began: nothing to play for.
  if (turn && turn.continues) return null; // A later model call in a turn already playing.
  const id = sessionId(turn && turn.session);
  // Before the spawn: the daemon reads it on startup.
  const project = (turn && turn.project) || process.cwd();
  writeSession(id, { project, transcript: (turn && turn.transcript) || "", offset: (turn && turn.offset) || 0, waiting: null, started: Date.now(), blockedMs: 0 });
  emitEvent("started", id, project);
  if (working(listSessions()).some((s) => s.id !== id) && daemonRunning()) return readPid();

  stopDaemon({ keepSessions: true });
  fs.rmSync(INTENSITY_FILE, { force: true }); // Don't inherit the last prompt's activity
  // Signals only: the session is tracked (chimes, events and the report read
  // it) but there is no music to start. Stopping first means a switch to off
  // lands on the next prompt rather than playing until the turn ends.
  if (!music) return null;
  return spawnDaemon(genre, volume, reactive, follow);
}


module.exports = { settingsPath, readPid, daemonArgv, isOurDaemon, daemonPlaying, stopDaemon, fileSize, newTurn, BLOCK_LOOKBACK_MS, blockedJustBefore, sessionId, sessionFile, readSession, writeSession, listSessions, working, STUCK_WINDOW, STUCK_FAILURES, isStuck, STATE_RANK, sessionState, agentState, formatStatusline, explainMusic, EVENTS_MAX_BYTES, emitEvent, followEvents, recentEvents, INTERRUPT_MARK, BLOCKED_MARK, isInterruptEntry, interruptWatcher, INTERRUPT_POLL_MS, runDaemon, daemonRunning, spawnDaemon, hookStart };
