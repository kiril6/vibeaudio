/**
 * Agent Hooks Integration (Claude Code, Codex, Cursor, Grok, Gemini CLI, Copilot CLI, Qwen Code)
 *
 * Hooks fire as short-lived processes, so playback lives in a detached daemon
 * tracked by a pid file. The prompt-submit event starts it, the stop event
 * tears it down and plays the chime. This tracks the agent's actual thinking
 * window instead of guessing from a wrapped process's lifetime.
 *
 * The supported agents differ only in where the file lives, what the events
 * are called and how one entry is shaped - TARGETS holds those three facts and
 * everything else below is shared.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { AudioPlayer } = require("./player");

const STATE_DIR = path.join(os.homedir(), ".vibeaudio");
const PID_FILE = path.join(STATE_DIR, "daemon.pid");
const INTENSITY_FILE = path.join(STATE_DIR, "intensity");
// One file per agent session with a turn in flight. The music plays while any of
// them is working; each holds where its transcript began and, while paused for
// the user, what will resume it.
const SESSIONS_DIR = path.join(STATE_DIR, "sessions");
// Payloads that name no session share this one slot.
const ANON_SESSION = "anon";
const CLI_ENTRY = path.join(__dirname, "..", "bin", "vibeaudio.js");

/**
 * Reactive mode: which tier a tool call implies. Looking things up stays
 * sparse, edits bring in the groove, shelling out and handing work to a
 * subagent go to peak. Unknown tools sit in the middle rather than swinging
 * the mix.
 *
 * The agents don't agree on tool names, so every vocabulary lives here: Claude
 * Code's PascalCase set (which Grok shares), Codex's snake_case one, and
 * Cursor's short names. They don't collide, so one flat map covers them all.
 *
 * Tiers here were checked against 30,532 real tool calls rather than guessed.
 * Two things that measurement changed:
 *
 * - `Task` was the old name for the subagent tool; it is `Agent` now, so the
 *   heaviest thing an agent does was landing on the fallback tier. Both are
 *   listed, since an older Claude Code still emits the old one.
 * - A third of all calls (33.7%) are MCP tools, which arrive as
 *   `mcp__<server>__<tool>` (Claude Code) or `MCP:<tool>` (Cursor) and cannot
 *   be enumerated - every user has different servers. They keep the fallback
 *   deliberately: an MCP call is usually real work, but rarely the heaviest
 *   thing in a turn, which is exactly what tier 2 means.
 *
 * Tools that mean "the agent has stopped and is waiting for the human" belong
 * at tier 1 even though they are not lookups - nothing is being worked on.
 */
const TOOL_TIERS = {
  // Claude Code - lookups, bookkeeping, and waiting on the user
  Read: 1, Glob: 1, Grep: 1, WebFetch: 1, WebSearch: 1, TodoWrite: 1,
  ToolSearch: 1, SearchSkills: 1, ListAgents: 1, ListSkills: 1,
  TaskCreate: 1, TaskUpdate: 1, TaskOutput: 1,
  BashOutput: 1, KillShell: 1,
  AskUserQuestion: 1, ExitPlanMode: 1, SendUserFile: 1, SendMessage: 1,
  // Claude Code - editing
  Edit: 2, Write: 2, MultiEdit: 2, NotebookEdit: 2,
  // Claude Code - shelling out, or handing the work to something else
  Bash: 3, Agent: 3, Task: 3, Skill: 3, Workflow: 3,
  // Codex
  read_file: 1, list_dir: 1, grep: 1, web_search: 1, update_plan: 1,
  apply_patch: 2,
  shell: 3,
  // Cursor
  Delete: 2,
  Shell: 3
};

function toolTier(toolName) {
  return TOOL_TIERS[toolName] || 2;
}

function readIntensity() {
  try {
    const tier = parseInt(fs.readFileSync(INTENSITY_FILE, "utf8").trim(), 10);
    return tier >= 1 && tier <= 3 ? tier : null;
  } catch (e) {
    return null; // No signal yet - the player falls back to time escalation.
  }
}

function parsePayload(raw) {
  try {
    const payload = JSON.parse(raw);
    return payload !== null && typeof payload === "object" ? payload : {};
  } catch (e) {
    return {}; // Malformed or absent payload.
  }
}

function payloadToolName(raw) {
  const payload = parsePayload(raw);
  // Claude Code, Codex and Cursor send tool_name; Grok sends toolName.
  // Reading only one of them would silently pin that agent to tier 2.
  return String(payload.tool_name || payload.toolName || "");
}

/**
 * PreToolUse hook: Claude Code delivers the tool call as JSON on stdin.
 * Writes a tier for the running daemon to pick up at its next loop boundary.
 */
function hookTool() {
  let raw = "";
  const commit = () => {
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      fs.writeFileSync(INTENSITY_FILE, String(toolTier(payloadToolName(raw))));
    } catch (e) {
      // Never let a hook failure disturb the agent.
    }
    process.exit(0);
  };

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    raw += chunk;
  });
  process.stdin.on("end", commit);
  // A hook must never hang the tool call waiting on stdin.
  setTimeout(commit, 500).unref();
}

// A lost Stop hook must not leave music looping forever.
const MAX_DAEMON_MS = 15 * 60 * 1000;

/**
 * The agents VibeAudio can wire itself into, and the few things that differ
 * between them: where the file lives, what the events are called, how one
 * entry is shaped. Each was verified against the tool itself - its installed
 * binary and a live run where it is installed, its released source where not -
 * never inferred from another tool's docs.
 *
 * `events` beyond start/stop/tool are optional, and a target only lists what
 * that tool was shown to fire:
 * - wait:    the agent is blocked on the user (pause + attention chime)
 * - resume:  what ends a wait
 * - failure: a turn ending in error *instead of* the stop event
 * - end:     the session closing, which can cut a turn off before stop
 *
 * `seed` is the root object to write when the file does not exist yet. Cursor
 * and Copilot require a schema version; Codex rejects unknown root keys
 * outright, so nothing may be added there beyond `hooks`.
 */
const TARGETS = {
  claude: {
    name: "Claude Code",
    cmd: "claude",
    file: () => path.join(os.homedir(), ".claude", "settings.json"),
    // - wait: PermissionRequest fires when the dialog is shown in the terminal,
    //   the SDK (desktop app, IDEs) and print mode alike - Notification's
    //   permission_prompt is raised by the terminal UI alone, after 6s idle.
    // - Esc reaches no hook at all; the daemon watches the transcript for it.
    events: {
      start: "UserPromptSubmit",
      stop: "Stop",
      tool: "PreToolUse",
      wait: ["PermissionRequest", "Elicitation"],
      resume: ["PostToolUse", "PostToolUseFailure", "ElicitationResult"],
      failure: "StopFailure",
      end: "SessionEnd"
    },
    entry: (command) => ({ hooks: [{ type: "command", command, timeout: 5 }] }),
    commands: (entry) => (entry.hooks || []).map((h) => h.command),
    seed: () => ({})
  },
  codex: {
    name: "Codex",
    cmd: "codex",
    file: () => path.join(os.homedir(), ".codex", "hooks.json"),
    // PermissionRequest runs only when Codex is about to ask for approval,
    // with tool_name, and is present in 0.125's binary. Its docs describe
    // Interrupt and SessionEnd too, but 0.125 has neither - and a strict parser
    // meeting an event it does not know would take every hook down with it.
    events: {
      start: "UserPromptSubmit",
      stop: "Stop",
      tool: "PreToolUse",
      wait: ["PermissionRequest"],
      resume: ["PostToolUse"]
    },
    entry: (command) => ({ hooks: [{ type: "command", command, timeout: 5 }] }),
    commands: (entry) => (entry.hooks || []).map((h) => h.command),
    seed: () => ({}),
    // Codex records a trusted_hash per hook in config.toml and asks before
    // running one it has not seen, so the install is not live until approved.
    note: "Codex asks you to trust each new hook the first time it fires — approve each one once."
  },
  cursor: {
    name: "Cursor",
    cmd: "cursor-agent",
    file: () => path.join(os.homedir(), ".cursor", "hooks.json"),
    events: { start: "beforeSubmitPrompt", stop: "stop", tool: "preToolUse" },
    entry: (command) => ({ command, timeout: 5 }),
    commands: (entry) => (entry.command ? [entry.command] : []),
    seed: () => ({ version: 1 })
  },
  grok: {
    name: "Grok",
    cmd: "grok",
    // Grok reads every *.json in this directory, so we get a file of our own
    // rather than merging into someone else's - which also makes uninstall a
    // delete instead of an edit. `dedicated` says so.
    file: () => path.join(os.homedir(), ".grok", "hooks", "vibeaudio.json"),
    dedicated: true,
    // Directory, not file: detection can't use dirname() like the others.
    configDir: () => path.join(os.homedir(), ".grok"),
    events: { start: "UserPromptSubmit", stop: "Stop", tool: "PreToolUse" },
    entry: (command) => ({ hooks: [{ type: "command", command, timeout: 5 }] }),
    commands: (entry) => (entry.hooks || []).map((h) => h.command),
    seed: () => ({})
  },
  gemini: {
    name: "Gemini CLI",
    cmd: "gemini",
    file: () => path.join(os.homedir(), ".gemini", "settings.json"),
    // Verified against gemini-cli v0.59.0's source (hooks/types.ts,
    // settingsSchema.ts) - the Gemini CLI available to test against predated
    // hooks, so there was no binary to run. Hooks are on by default and
    // user-level ones need no trust step. The permission dialog is a
    // Notification, and it names no tool - so any AfterTool resumes.
    events: {
      start: "BeforeAgent",
      stop: "AfterAgent",
      tool: "BeforeTool",
      wait: ["Notification"],
      resume: ["AfterTool"],
      end: "SessionEnd"
    },
    entry: (command) => ({ hooks: [{ type: "command", command, name: "vibeaudio", timeout: 5000 }] }),
    commands: (entry) => (entry.hooks || []).map((h) => h.command),
    seed: () => ({}),
    // Settings, not events, that may sit in the same `hooks` object.
    configKeys: ["enabled", "disabled", "notifications"],
    // Unlike the four above, not verified to re-read hooks mid-session.
    liveReload: false,
    note: "Not checked whether an open Gemini CLI session reloads hooks — start a new one to be sure."
  },
  copilot: {
    name: "GitHub Copilot CLI",
    cmd: "copilot",
    // Copilot reads every *.json in hooks/, so, like Grok, a file of our own.
    // PascalCase event names select its Claude-compatible payloads
    // (snake_case, tool_name "Bash"); camelCase ones get a different dialect.
    // Verified live on 1.0.80: its PermissionRequest fires before *every*
    // permission check, prompt or not, so the wait signal is the
    // permission_prompt Notification, which names no tool.
    file: () => path.join(process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot"), "hooks", "vibeaudio.json"),
    dedicated: true,
    configDir: () => process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot"),
    events: {
      start: "UserPromptSubmit",
      stop: "Stop",
      tool: "PreToolUse",
      wait: ["Notification"],
      resume: ["PostToolUse", "PostToolUseFailure"],
      end: "SessionEnd"
    },
    entry: (command) => ({ type: "command", command, timeoutSec: 5 }),
    commands: (entry) => (entry.command ? [entry.command] : []),
    seed: () => ({ version: 1 }),
    // Unlike the four above, not verified to re-read hooks mid-session.
    liveReload: false,
    note: "Not checked whether an open Copilot CLI session reloads hooks — start a new one to be sure."
  },
  qwen: {
    name: "Qwen Code",
    cmd: "qwen",
    file: () => path.join(os.homedir(), ".qwen", "settings.json"),
    // Verified against qwen-code v0.23.3's source (hooks/types.ts): Claude
    // Code's event set, including a PermissionRequest raised when the dialog
    // is displayed, with tool_name. Timeouts are milliseconds.
    events: {
      start: "UserPromptSubmit",
      stop: "Stop",
      tool: "PreToolUse",
      wait: ["PermissionRequest"],
      resume: ["PostToolUse", "PostToolUseFailure"],
      failure: "StopFailure",
      end: "SessionEnd"
    },
    entry: (command) => ({ hooks: [{ type: "command", command, name: "vibeaudio", timeout: 5000 }] }),
    commands: (entry) => (entry.hooks || []).map((h) => h.command),
    seed: () => ({}),
    // Unlike the four above, not verified to re-read hooks mid-session.
    liveReload: false,
    note: "Not checked whether an open Qwen Code session reloads hooks — start a new one to be sure."
  }
};

function target(id) {
  const t = TARGETS[id];
  if (!t) throw new Error(`unknown hook target '${id}' — expected one of ${Object.keys(TARGETS).join(", ")}`);
  return t;
}

function targetFile(id) {
  return target(id).file();
}

/**
 * Which of them are on this machine. The config directory is the reliable
 * signal - Cursor ships no CLI on PATH at all, and a tool that has never run
 * has nothing for us to merge into anyway. PATH is a fallback for the case of
 * a fresh install whose config directory does not exist yet.
 */
function detectTargets() {
  const { isInstalled } = require("./interactive");
  return Object.keys(TARGETS).filter((id) => {
    const t = TARGETS[id];
    const dir = t.configDir ? t.configDir() : path.dirname(t.file());
    return fs.existsSync(dir) || isInstalled(t.cmd);
  });
}

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
 * itself at MAX_DAEMON_MS, while killing a stranger's process has no such
 * ceiling.
 *
 * ponytail: posix only. Windows has no cheap command-line lookup, so the pid
 * is trusted there as before; revisit if hooks see real Windows use.
 */
function isOurDaemon(pid) {
  if (process.platform === "win32") return true;
  try {
    const out = execFileSync("ps", ["-p", String(pid), "-o", "args="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return out.includes("vibeaudio") && out.includes("--daemon");
  } catch (e) {
    return false; // No such process, or ps unavailable - either way, do not kill.
  }
}

/**
 * Stops the player. `keepSessions` leaves the session files alone: the hooks
 * use it because they decide per session what is still going on. Every other
 * stop (--stop, --mute, uninstall) ends everything, or a later tool call would
 * resume music nobody is waiting for.
 */
function stopDaemon({ keepSessions = false } = {}) {
  const pid = readPid();
  fs.rmSync(PID_FILE, { force: true });
  if (!keepSessions) fs.rmSync(SESSIONS_DIR, { recursive: true, force: true });
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
  return { session: String(payload.session_id || ""), transcript, offset: transcript ? fileSize(transcript) : 0 };
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
 * MAX_DAEMON_MS is a crashed agent - it never sent Stop - and is dropped here,
 * the same ceiling the daemon itself stops at.
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

// Claude Code's entry for Esc / the stop button: a user message whose text is
// "[Request interrupted by user]" or "... for tool use]".
const INTERRUPT_MARK = "[Request interrupted by user";

function isInterruptEntry(line) {
  if (!line.includes(INTERRUPT_MARK)) return false; // Cheap filter before parsing.
  try {
    const entry = JSON.parse(line);
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
function runDaemon(genre, volume, { reactive = false } = {}) {
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
    minTier: () => Math.min(3, working(listSessions()).length)
  });
  if (!started) process.exit(0);

  const shutdown = () => {
    player.stop({ playChime: false });
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  setTimeout(shutdown, MAX_DAEMON_MS);

  setInterval(() => {
    if (sweep()) return;
    player.stop({ playChime: false });
    endIdle();
  }, INTERRUPT_POLL_MS);
}

function daemonRunning() {
  const pid = readPid();
  return pid !== null && isOurDaemon(pid);
}

function spawnDaemon(genre, volume, reactive) {
  const args = [CLI_ENTRY, "--daemon", "--genre", genre, "--volume", String(Math.round(volume * 100))];
  if (reactive) args.push("--reactive");

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
function hookStart(genre, volume, { reactive = false, turn = null } = {}) {
  const id = sessionId(turn && turn.session);
  // Before the spawn: the daemon reads it on startup.
  writeSession(id, { transcript: (turn && turn.transcript) || "", offset: (turn && turn.offset) || 0, waiting: null });
  if (working(listSessions()).some((s) => s.id !== id) && daemonRunning()) return readPid();

  stopDaemon({ keepSessions: true });
  fs.rmSync(INTENSITY_FILE, { force: true }); // Don't inherit the last prompt's activity
  return spawnDaemon(genre, volume, reactive);
}

/**
 * What the agent's stop event says about how the turn ended. Cursor reports
 * it in `status` ("completed", "aborted" or "error"). Claude Code's Stop
 * carries no verdict, but an API error ends the turn with StopFailure
 * *instead* of Stop, so that event is the verdict. Codex's StopRequest has
 * none, so it keeps the success chime - the alternative would be inventing a
 * failure the agent never claimed.
 */
function outcomeFromPayload(raw) {
  const payload = parsePayload(raw);
  if (payload.hook_event_name === "StopFailure") return "failure";
  const status = String(payload.status || "").toLowerCase();
  return status === "error" || status === "aborted" ? "failure" : "success";
}

/**
 * Reads the hook's stdin payload, then hands it on. A hook must never hang
 * the agent waiting for input that isn't coming, hence the timeout.
 */
function readPayload(done, timeoutMs = 500) {
  let raw = "";
  let settled = false;
  const collect = (chunk) => {
    raw += chunk;
  };

  const finish = () => {
    if (settled) return;
    settled = true;
    // Reading stdin resumes it, and a resumed stdin keeps the event loop
    // alive on its own. Without letting go here the hook process outlives
    // its work and sits there until the agent's own timeout kills it -
    // on every single turn.
    process.stdin.removeListener("data", collect);
    process.stdin.removeListener("end", finish);
    process.stdin.removeListener("error", finish);
    process.stdin.pause();
    done(raw);
  };

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", collect);
  process.stdin.on("end", finish);
  process.stdin.on("error", finish);
  setTimeout(finish, timeoutMs).unref();
}

function hookStop({ outcome = "success", volume = 0.4, chimeVolume = null, noChime = false, raw = "" } = {}) {
  const id = sessionId(parsePayload(raw).session_id);
  // A turn that ends while paused for the user - a denied tool that nothing
  // resumed after - still finished, so its session counts either way.
  const tracked = readSession(id) !== null;
  fs.rmSync(sessionFile(id), { force: true });

  // The music is every working session's, so it ends with the last of them.
  // Everyone else's carries on, and this session still gets its own chime.
  const others = working(listSessions()).length > 0;
  const wasPlaying = others ? false : stopDaemon({ keepSessions: true });
  if (!others) fs.rmSync(INTENSITY_FILE, { force: true });
  if (!(tracked || wasPlaying) || noChime) return false;

  // Chime plays in this short-lived hook process.
  new AudioPlayer().stop({ playChime: true, outcome, volume, chimeVolume });
  return true;
}

/**
 * What a wait is waiting for, and what ends it: the tool's name for a
 * permission dialog and its PostToolUse, the server's name for an MCP
 * elicitation and its ElicitationResult. PermissionRequest carries no
 * tool_use_id, hence names.
 */
function waitKey(raw) {
  const server = parsePayload(raw).mcp_server_name;
  return payloadToolName(raw) || (server ? `mcp:${server}` : "");
}

// Notification types that mean "blocked on the user". Agents whose permission
// dialog is a Notification send every other kind through the same event.
const WAIT_NOTIFICATIONS = new Set([
  "permission_prompt", // Copilot CLI
  "elicitation_dialog", // Copilot CLI
  "ToolPermission" // Gemini CLI
]);

/**
 * The agent is blocked on the user (a permission dialog, a question, a plan to
 * approve, an MCP server asking for input). Music that keeps playing says
 * "still working", which is the one thing that is not true, so it stops and
 * the attention chime asks instead - unless another session is still working,
 * whose music is not this dialog's to end.
 *
 * Only for a turn in flight: after it has ended there is nobody to interrupt,
 * and a second dialog while already waiting keeps the first wait rather than
 * chiming twice.
 *
 * The chime is detached: the agent waits on this hook before showing the
 * dialog, and a chime played to completion here held it back for its length.
 */
function hookWait(raw, { volume = 0.4, chimeVolume = null, noChime = false } = {}) {
  const payload = parsePayload(raw);
  const type = payload.notification_type ?? payload.notificationType;
  if (type !== undefined && !WAIT_NOTIFICATIONS.has(String(type))) return false;

  const id = sessionId(payload.session_id);
  const session = readSession(id);
  if (!session || session.waiting != null) return false;

  writeSession(id, { ...session, waiting: waitKey(raw) });
  if (working(listSessions()).length === 0) stopDaemon({ keepSessions: true });
  if (!noChime) new AudioPlayer().stop({ playChime: true, outcome: "attention", volume, chimeVolume, detach: true });
  return true;
}

/**
 * A tool call or an elicitation has ended. Nothing fires on an approval
 * itself, so this is the first signal that work carries on after one - resume,
 * if it is the one being waited for.
 *
 * The session keeps its transcript offset from the prompt, so an approved tool
 * interrupted with Esc, which still fires this PostToolUse, is seen by the
 * daemon and must not bring the music back.
 *
 * ponytail: matching by name means two same-named tools in one parallel batch,
 * one needing approval, can resume early - after the chime already did its
 * job. Match on tool_input as well if that ever shows up in practice.
 */
function hookResume(raw, genre, volume, { reactive = false } = {}) {
  const id = sessionId(parsePayload(raw).session_id);
  const session = readSession(id);
  if (!session || session.waiting == null) return false; // Not waiting - the common case, on every tool call.
  // An empty key is a wait that named nothing (a Notification): the next tool
  // to finish is the first sign of work carrying on.
  if (session.waiting !== "" && session.waiting !== waitKey(raw)) return false;

  writeSession(id, { ...session, waiting: null });
  if (!daemonRunning()) spawnDaemon(genre, volume, reactive);
  return true;
}

/**
 * The agent's session is over (quit, /clear, logout). A turn cut off by it
 * never reaches Stop. Silent: nothing finished.
 *
 * Only that session's own turn ends, so one terminal closing cannot silence
 * another that is mid-turn. Fails closed on an unknown session: with none on
 * record there is nothing of its to end, and the MAX_DAEMON_MS ceiling still
 * applies.
 */
function hookEnd(raw) {
  const id = sessionId(parsePayload(raw).session_id);
  if (!readSession(id)) return false;

  fs.rmSync(sessionFile(id), { force: true });
  if (working(listSessions()).length === 0) {
    stopDaemon({ keepSessions: true });
    fs.rmSync(INTENSITY_FILE, { force: true });
  }
  return true;
}

/**
 * The hook command is a string the agent hands to a shell, so every path in it
 * has to survive that shell. Double quotes do not: `$` and a backtick expand
 * inside them and a `"` ends the quote outright, so installing from a path
 * like /tmp/dollar$dir wrote a command the shell quietly rewrote into a
 * different one - and the install reported success. A hook that fails on every
 * prompt while claiming to be installed is the exact failure
 * ephemeralInstallReason() exists to prevent.
 *
 * POSIX gets single quotes, which expand nothing, plus the one escape a single
 * quote itself needs. Windows keeps double quotes: cmd expands neither `$` nor
 * a backtick, and `"` is not legal in a Windows path to begin with.
 */
function shellQuote(value) {
  if (process.platform === "win32") return `"${value}"`;
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function hookCommand(flag, genre, volume, reactive = false) {
  const base = `${shellQuote(process.execPath)} ${shellQuote(CLI_ENTRY)} ${flag}`;
  // Resuming respawns the daemon, so it needs the same settings as starting.
  if (flag !== "--hook-start" && flag !== "--hook-resume") return base;

  const start = `${base} --genre ${genre} --volume ${Math.round(volume * 100)}`;
  return reactive ? `${start} --reactive` : start;
}

const VIBE_HOOK_FLAG = /--hook-(start|stop|tool|wait|resume|end)\b/;

function isVibeHook(entry, id = "claude") {
  return target(id)
    .commands(entry)
    .some((c) => typeof c === "string" && VIBE_HOOK_FLAG.test(c));
}

function setHook(hooks, event, command, id) {
  // Replacing our own entries keeps repeat installs idempotent and leaves
  // every other tool's hooks untouched. Appending rather than prepending also
  // keeps the existing entries at their original index, which is what Codex
  // keys its per-hook trust records by.
  const kept = (hooks[event] || []).filter((entry) => !isVibeHook(entry, id));
  kept.push(target(id).entry(command));
  hooks[event] = kept;
}

/** [event, entries] for every event in a hooks object, skipping settings keys. */
function hookEntries(hooks, t) {
  const configKeys = (t && t.configKeys) || [];
  return Object.entries(hooks || {}).filter(([key]) => !configKeys.includes(key));
}

function readVibeEntryCount(file, id) {
  try {
    const { settings } = loadSettings(file, target(id));
    return hookEntries(settings.hooks, target(id)).reduce(
      (n, [, entries]) => n + entries.filter((e) => isVibeHook(e, id)).length,
      0
    );
  } catch (e) {
    return 0; // Unreadable: the delete below still cleans it up.
  }
}

function loadSettings(file, t = null) {
  if (!fs.existsSync(file)) return { settings: t ? t.seed() : {}, raw: null };
  const raw = fs.readFileSync(file, "utf8");

  let settings;
  try {
    settings = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${file} is not valid JSON (${e.message}) — refusing to overwrite it.`);
  }

  // Valid JSON in the wrong shape used to reach the callers and fail there as
  // "entries.filter is not a function", which tells the user nothing about
  // their own file. Checked here because install, uninstall and the entry
  // count all come through this function.
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error(`${file} does not contain a JSON object — refusing to overwrite it.`);
  }
  if (settings.hooks !== undefined) {
    if (settings.hooks === null || typeof settings.hooks !== "object" || Array.isArray(settings.hooks)) {
      throw new Error(`${file} has a "hooks" key that is not an object — refusing to overwrite it.`);
    }
    for (const [event, entries] of hookEntries(settings.hooks, t)) {
      if (!Array.isArray(entries)) {
        throw new Error(
          `${file} has hooks.${event} as ${Array.isArray(entries) ? "an array" : typeof entries}, ` +
          `not an array of entries — refusing to overwrite it.`
        );
      }
    }
  }

  return { settings, raw };
}

/**
 * Hooks record an absolute path to this CLI, so installing from a throwaway
 * `npx` checkout writes a path npm will eventually evict — leaving every
 * prompt firing a hook that silently fails. Refuse rather than plant that.
 */
function ephemeralInstallReason(entry = CLI_ENTRY) {
  const dir = entry.split(path.sep);
  if (dir.includes("_npx")) return "npx";
  if (dir.includes(".npm-cache") || dir.includes("_cacache")) return "npm cache";
  return null;
}

/**
 * `dryRun` computes the result without touching the disk - no directory, no
 * backup, no write - and returns it with the file's current contents, so the
 * caller can show exactly what would change in a file that belongs to the user.
 */
function installHooks(genre = "lofi", volume = 0.4, file = null, { reactive = false, id = "claude", dryRun = false } = {}) {
  const t = target(id);
  file = file || t.file();
  const ephemeral = ephemeralInstallReason();
  if (ephemeral) {
    throw new Error(
      `refusing to install hooks from a temporary ${ephemeral} checkout — the path ` +
      `(${CLI_ENTRY}) is deleted when the cache is cleared, which would leave Claude Code ` +
      `running a broken hook on every prompt.\n\n` +
      `Install it for real first, then re-run:\n\n` +
      `  npm i -g github:kiril6/vibeaudio\n  vibe --install-hooks\n`
    );
  }

  const { settings, raw } = loadSettings(file, t);
  if (!dryRun) fs.mkdirSync(path.dirname(file), { recursive: true });
  let backup = null;
  // Only worth backing up a file that holds someone else's config. A dedicated
  // target's file is ours alone, so a backup of it would just be a copy of our
  // own last install, left behind after the uninstall deletes the original.
  //
  // Written once and never overwritten: the second --install-hooks reads a
  // file that already contains our entries, so re-backing up would replace the
  // user's actual pre-VibeAudio config with a copy of our own last install -
  // while uninstall goes on calling it "your pre-VibeAudio config backup".
  // The first one is the only one that is true.
  if (raw !== null && !t.dedicated) {
    const backupFile = `${file}.vibeaudio.bak`;
    if (!fs.existsSync(backupFile)) {
      if (!dryRun) fs.writeFileSync(backupFile, raw);
      backup = backupFile;
    }
  }

  const ev = t.events;
  settings.hooks = settings.hooks || {};
  setHook(settings.hooks, ev.start, hookCommand("--hook-start", genre, volume, reactive), id);
  setHook(settings.hooks, ev.stop, hookCommand("--hook-stop", genre, volume), id);

  // Only reactive mode needs per-tool-call signalling.
  if (reactive) {
    setHook(settings.hooks, ev.tool, hookCommand("--hook-tool", genre, volume), id);
  } else if (settings.hooks[ev.tool]) {
    const kept = settings.hooks[ev.tool].filter((entry) => !isVibeHook(entry, id));
    if (kept.length) settings.hooks[ev.tool] = kept;
    else delete settings.hooks[ev.tool];
  }

  for (const event of ev.wait || []) {
    setHook(settings.hooks, event, hookCommand("--hook-wait", genre, volume), id);
  }
  // The agent awaits a resume before the next tool's permission check, so a
  // resume can never land after the next wait.
  // ponytail: one ~40ms node start per tool call; a shell-side existence
  // check on the waiting file would skip it if that ever shows.
  for (const event of ev.resume || []) {
    setHook(settings.hooks, event, hookCommand("--hook-resume", genre, volume, reactive), id);
  }
  if (ev.failure) setHook(settings.hooks, ev.failure, hookCommand("--hook-stop", genre, volume), id);
  if (ev.end) setHook(settings.hooks, ev.end, hookCommand("--hook-end", genre, volume), id);

  const after = `${JSON.stringify(settings, null, 2)}\n`;
  if (!dryRun) fs.writeFileSync(file, after);
  return { file, backup, reactive, id, name: t.name, note: t.note || null, events: ev, before: raw, after, dryRun };
}

/**
 * `/vibe` inside Claude Code: a command file, not a hook - it asks the model to
 * run the CLI, so mute, stop and genre changes need no second terminal. The
 * marker is how install and uninstall tell our file from a user's own vibe.md,
 * which neither may overwrite or delete.
 */
const SLASH_MARK = "<!-- vibeaudio:slash-command -->";

function slashCommandFile() {
  return path.join(os.homedir(), ".claude", "commands", "vibe.md");
}

function slashCommandText() {
  const cli = `${shellQuote(process.execPath)} ${shellQuote(CLI_ENTRY)}`;
  return `---
description: Control VibeAudio - status, mute, unmute, stop, or change genre or volume
argument-hint: "[status | mute [minutes] | unmute | stop | genre <name> | volume <5-100>]"
---
${SLASH_MARK}
Control VibeAudio, the focus music that plays while you work, for the user.
Arguments: \`$ARGUMENTS\`

Run the one matching command with the Bash tool, then report the result in a
single short sentence. Do nothing else.

- no arguments, or \`status\`: \`${cli} --status\`
- \`mute\` or \`mute <minutes>\`: \`${cli} --mute <minutes>\`
- \`unmute\`: \`${cli} --unmute\`
- \`stop\`: \`${cli} --stop\`
- \`genre <name>\` or \`volume <5-100>\`: first run \`${cli} --status\` and read
  Claude Code's current genre, volume, and whether it says "reactive". Then run
  \`${cli} --install-hooks --tools claude --genre <genre> --volume <volume>\`,
  adding \`--reactive\` if it was reactive, and changing only what was asked.
  Genres: lofi, synthwave, 8bit, electronic, jazz, zen, piano, drone, random.

For anything else, show the user the list above instead of running a command.
`;
}

function installSlashCommand({ file = slashCommandFile(), dryRun = false } = {}) {
  if (fs.existsSync(file) && !fs.readFileSync(file, "utf8").includes(SLASH_MARK)) {
    return { file, installed: false, reason: "a vibe.md that is not ours is already there" };
  }
  if (!dryRun) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, slashCommandText());
  }
  return { file, installed: true };
}

function uninstallSlashCommand({ file = slashCommandFile() } = {}) {
  if (!fs.existsSync(file) || !fs.readFileSync(file, "utf8").includes(SLASH_MARK)) return false;
  fs.rmSync(file, { force: true });
  return true;
}

function uninstallHooks(file = null, { id = "claude" } = {}) {
  const t = target(id);
  file = file || t.file();
  if (!fs.existsSync(file)) return { file, removed: 0, id };

  // Our own file has nothing of the user's in it, so removing our entries
  // would just leave an empty husk in a directory the tool scans.
  if (t.dedicated) {
    const removed = readVibeEntryCount(file, id);
    fs.rmSync(file, { force: true });
    return { file, removed, id };
  }

  const { settings } = loadSettings(file, t);
  if (!settings.hooks) return { file, removed: 0, id };

  let removed = 0;
  for (const [event, entries] of hookEntries(settings.hooks, t)) {
    const kept = entries.filter((entry) => !isVibeHook(entry, id));
    removed += entries.length - kept.length;

    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }

  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  return { file, removed, id };
}

module.exports = {
  shellQuote,
  runDaemon,
  hookStart,
  hookStop,
  hookTool,
  hookWait,
  hookResume,
  hookEnd,
  newTurn,
  outcomeFromPayload,
  readPayload,
  toolTier,
  readIntensity,
  stopDaemon,
  isOurDaemon,
  installHooks,
  ephemeralInstallReason,
  uninstallHooks,
  settingsPath,
  isVibeHook,
  hookEntries,
  installSlashCommand,
  uninstallSlashCommand,
  VIBE_HOOK_FLAG,
  TARGETS,
  targetFile,
  detectTargets,
  PID_FILE
};
