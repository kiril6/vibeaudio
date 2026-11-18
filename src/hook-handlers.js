/** What each hook event does: start, stop, wait, resume, end, notify, announce. */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { AudioPlayer } = require("./player");
const { loadConfig } = require("./player");
const { playbackDisabled } = require("./player");
const { recordTurn } = require("./history");
const speech = require("./speech");
const { STATE_DIR, INTENSITY_FILE, TOOL_TIERS, parsePayload, payloadToolName, payloadSession, payloadProject, projectName } = require("./hook-core");
const { stopDaemon, sessionId, sessionFile, readSession, writeSession, listSessions, working, STUCK_WINDOW, STUCK_FAILURES, isStuck, emitEvent, daemonRunning, spawnDaemon } = require("./hook-state");

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
  if (status === "error" || status === "aborted") return "failure";
  // Antigravity's Stop: NO_TOOL_CALL is the normal end (seen live; its docs
  // say model_stop). An error or the step limit is a turn that did not finish.
  return /error|max_steps/i.test(String(payload.terminationReason || "")) ? "failure" : "success";
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

/**
 * Opt-in desktop notification, for the moment a chime cannot answer "which
 * one?": with several terminals going, a sound says something finished and
 * leaves you alt-tabbing to find out what. Off by default - a banner is more
 * intrusive than a sound. Env beats the saved setting, like every other one.
 */
function notifyEnabled(env = process.env, config = loadConfig()) {
  const raw = String(env.VIBE_NOTIFY ?? config.notify ?? "").trim().toLowerCase();
  return ["1", "true", "on", "yes"].includes(raw);
}

function sessionLabel(payload, cwd = process.cwd()) {
  return projectName(payloadProject(payload) || cwd);
}

/**
 * The command that shows a notification, or null where there is no built-in
 * way to (Windows, for now). Title and body travel as argv, never spliced into
 * a script string: a project directory is user-controlled text.
 */
function notifyCommand(platform, title, body) {
  if (platform === "darwin") {
    return {
      cmd: "osascript",
      args: ["-e", "on run argv", "-e", "display notification (item 1 of argv) with title (item 2 of argv)", "-e", "end run", body, title]
    };
  }
  if (platform === "linux") return { cmd: "notify-send", args: ["--", title, body] };
  return null;
}

// Detached and unref'd: the agent waits on this hook, and a missing
// osascript/notify-send (a Linux box with no notification daemon) must be
// invisible rather than an error in someone's agent.
function banner(body) {
  if (!notifyEnabled() || playbackDisabled()) return false; // a mute means quiet, banners included
  const command = notifyCommand(process.platform, "VibeAudio", body);
  if (!command) return false;
  try {
    const child = spawn(command.cmd, command.args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch (e) {
    return false;
  }
}

function notify(raw, message) {
  return banner(`${sessionLabel(parsePayload(raw))}: ${message}`);
}

/**
 * `--announce` can be switched off for good (menu, `--announcements off`,
 * `VIBE_ANNOUNCE=off`) for a script that cannot be edited. On unless said
 * otherwise; env beats the saved setting.
 */
function announceEnabled(env = process.env, config = loadConfig()) {
  const raw = String(env.VIBE_ANNOUNCE ?? config.announce ?? "").trim().toLowerCase();
  return !["0", "false", "off", "no"].includes(raw);
}

/**
 * The spoken line for a hook event (#33), after its chime. `sessionCount` is
 * how many sessions are in flight, this one included: in `auto` mode it takes
 * two to be worth saying, since the point is "which one?". `chimed` says a
 * chime was started detached, so the sentence waits for it; one that already
 * played to the end (the Stop hook plays it inline) needs no wait. Only a
 * built-in tool is named: an MCP tool's name is third-party text.
 */
function speakEvent(raw, kind, sessionCount, { chimed = false, volume = 0.4, tool = "" } = {}) {
  try {
    if (!speech.shouldSpeak(speech.speakMode(process.env, loadConfig()), sessionCount)) return false;
    const named = tool && Object.hasOwn(TOOL_TIERS, tool) ? tool : "";
    return speech.speak(speech.phrase(kind, sessionLabel(parsePayload(raw)), named), {
      delayMs: speech.chimeDelayMs(kind, chimed),
      volume
    });
  } catch (e) {
    return false; // speech must never fail the hook
  }
}

const ANNOUNCE_FILE = path.join(STATE_DIR, "announce.json");
const ANNOUNCE_MAX_CHARS = 200;
const ANNOUNCE_REPEAT_MS = 5000;
const ANNOUNCE_OUTCOMES = ["success", "failure", "attention"];

/**
 * `vibe --announce <text>`: VibeAudio's signals for something that is not an
 * agent turn (a CI run, a deploy, a script). A chime for the outcome, the
 * `--notify` banner, and an `announced` event, so a light watching `--events`
 * reacts too. Never starts or stops music and never touches a session.
 *
 * The text is shown in a banner, so control characters go and the length is
 * capped; it only ever travels as argv. A repeat of the same text within a few
 * seconds is dropped whole, so a script in a loop cannot machine-gun the
 * speakers. Mute silences the chime and banner; the event is still written,
 * like every event.
 *
 * Returns false when it was a repeat, true otherwise; never throws.
 */
function announce(text, { outcome = "success", volume = 0.4, chimeVolume = null, noChime = false, genre } = {}) {
  try {
    if (!announceEnabled()) return false; // switched off: inert, event included
    const clean = String(text).replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, ANNOUNCE_MAX_CHARS);
    const now = Date.now();
    try {
      const last = JSON.parse(fs.readFileSync(ANNOUNCE_FILE, "utf8"));
      if (last.text === clean && now - last.at < ANNOUNCE_REPEAT_MS) return false;
    } catch (e) { /* first one, or an unreadable file: nothing to compare */ }
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(ANNOUNCE_FILE, JSON.stringify({ text: clean, at: now }));

    emitEvent("announced", null, null, { source: "cli", text: clean, outcome });
    banner(`${clean}${outcome === "failure" ? " (failed)" : outcome === "attention" ? " (needs you)" : ""}`);
    // Detached: a pipeline should not wait out the chime.
    if (!noChime) new AudioPlayer().stop({ playChime: true, outcome, volume, chimeVolume, genre, detach: true });
    // The caller's own text, read after the chime. No session count to wait on:
    // a script has no "which one", so `auto` and `always` both speak it.
    if (speech.speakMode(process.env, loadConfig()) !== "off") {
      speech.speak(clean, { delayMs: speech.chimeDelayMs(outcome, !noChime), volume: chimeVolume !== null ? chimeVolume : volume });
    }
    return true;
  } catch (e) {
    return true; // a notifier must never fail the script that called it
  }
}

function hookStop({ outcome = "success", volume = 0.4, chimeVolume = null, noChime = false, genre, raw = "" } = {}) {
  const id = sessionId(payloadSession(parsePayload(raw)));
  const active = listSessions().length; // this session included, until its file goes
  // A turn that ends while paused for the user - a denied tool that nothing
  // resumed after - still finished, so its session counts either way.
  const session = readSession(id);
  const tracked = session !== null;
  fs.rmSync(sessionFile(id), { force: true });
  if (tracked) emitEvent("finished", id, payloadProject(parsePayload(raw)) || session.project, { outcome });
  if (session && Number.isFinite(session.started)) {
    const now = Date.now();
    // A turn that ends while still paused for you has been blocked since then.
    const blockedMs = (session.blockedMs || 0) + (session.waiting != null && session.waitStart ? now - session.waitStart : 0);
    // ponytail: assumes a playback backend exists; a machine with none hears no music either.
    const chimed = !noChime && !playbackDisabled();
    recordTurn({ project: payloadProject(parsePayload(raw)) || process.cwd(), ms: now - session.started, blockedMs, outcome, session: id, chimed, at: now });
  }

  // The music is every working session's, so it ends with the last of them.
  // Everyone else's carries on, and this session still gets its own chime.
  const others = working(listSessions()).length > 0;
  const wasPlaying = others ? false : stopDaemon({ keepSessions: true });
  if (!others) fs.rmSync(INTENSITY_FILE, { force: true });
  if (!(tracked || wasPlaying)) return false;
  notify(raw, outcome === "failure" ? "failed" : "finished");
  const speakVolume = chimeVolume !== null ? chimeVolume : volume;
  if (noChime) {
    speakEvent(raw, outcome === "failure" ? "failure" : "success", active, { volume: speakVolume });
    return false;
  }

  // Chime plays in this short-lived hook process, to the end; the sentence
  // starts after it, so it needs no delay of its own.
  new AudioPlayer().stop({ playChime: true, outcome, volume, chimeVolume, genre });
  speakEvent(raw, outcome === "failure" ? "failure" : "success", active, { volume: speakVolume });
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

  const id = sessionId(payloadSession(payload));
  const session = readSession(id);
  if (!session || session.waiting != null) return false;

  writeSession(id, { ...session, waiting: waitKey(raw), waitStart: Date.now() });
  emitEvent("waiting", id, session.project, waitKey(raw) ? { tool: waitKey(raw) } : {});
  if (working(listSessions()).length === 0) stopDaemon({ keepSessions: true });
  const tool = payloadToolName(raw);
  notify(raw, tool ? `needs you (${tool})` : "needs you");
  if (!noChime) new AudioPlayer().stop({ playChime: true, outcome: "attention", volume, chimeVolume, detach: true });
  speakEvent(raw, "attention", listSessions().length, {
    chimed: !noChime && !playbackDisabled(),
    volume: chimeVolume !== null ? chimeVolume : volume,
    tool
  });
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
function hookResume(raw, genre, volume, { reactive = false, follow = false, music = true, chimeVolume = null, noChime = false } = {}) {
  const payload = parsePayload(raw);
  const id = sessionId(payloadSession(payload));
  const session = readSession(id);
  if (!session) return false;

  // Every tool call lands here, so this is where the stuck signal is kept.
  // An interrupt is the user stopping a tool, not the tool failing.
  // ponytail: two parallel tool calls in one session can each read, then write,
  // and one result is lost. A heuristic over eight calls survives that.
  const failed = payload.hook_event_name === "PostToolUseFailure" && !payload.is_interrupt;
  const recent = [...(session.recent || []), failed ? 1 : 0].slice(-STUCK_WINDOW);
  const next = { ...session, recent };
  const crossing = isStuck(next) === isStuck(session) ? null : isStuck(next) ? "stuck" : "recovered";
  if (crossing === "stuck") {
    notify(raw, `looks stuck - ${STUCK_FAILURES} of its last ${STUCK_WINDOW} tool calls failed`);
    // With music on the daemon adds the heartbeat; with it off there is no
    // loop to put one under, so the pulse plays once on its own. Detached: the
    // agent waits on this hook.
    if (!music && !noChime) new AudioPlayer().stop({ playChime: true, outcome: "stuck", volume, chimeVolume, detach: true });
    speakEvent(raw, "stuck", listSessions().length, {
      chimed: !music && !noChime && !playbackDisabled(),
      volume: chimeVolume !== null ? chimeVolume : volume
    });
  }

  // An empty key is a wait that named nothing (a Notification): the next tool
  // to finish is the first sign of work carrying on.
  const resumes = session.waiting != null && (session.waiting === "" || session.waiting === waitKey(raw));
  if (!resumes) {
    writeSession(id, next);
    if (crossing) emitEvent(crossing, id, session.project);
    return false; // Not waiting - the common case, on every tool call.
  }

  const blockedMs = (session.blockedMs || 0) + (session.waitStart ? Date.now() - session.waitStart : 0);
  writeSession(id, { ...next, waiting: null, waitStart: null, blockedMs });
  emitEvent("resumed", id, session.project);
  if (crossing) emitEvent(crossing, id, session.project);
  if (music && !daemonRunning()) spawnDaemon(genre, volume, reactive, follow);
  return true;
}

/**
 * An unmute while a turn is in flight: a mute stopped the player, and nothing
 * else would start one until the next prompt. Only for a session that is
 * working (a waiting one is waiting on the user, and says so with silence), and
 * never over a daemon already playing. Not reactive: that flag lives in the hook
 * commands, so a reactive install is plain until its next tool-driven resume.
 */
function resumeAfterUnmute(genre, volume, { music = true, follow = false } = {}) {
  if (!music || daemonRunning() || working(listSessions()).length === 0) return false;
  spawnDaemon(genre, volume, false, follow);
  return true;
}

/**
 * A saved genre or music switch reaches music already playing now, not at the
 * next prompt: whoever pressed the button is listening. The player is replaced
 * (or just stopped for music off) while the sessions stay, so chimes, events and
 * --report carry on. Returns whether anything changed.
 */
function applyLiveMusic(genre, volume, { music = true, follow = false } = {}) {
  const was = daemonRunning();
  if (was) stopDaemon({ keepSessions: true });
  const start = music && !playbackDisabled({ calls: false }) && working(listSessions()).length > 0;
  if (start) spawnDaemon(genre, volume, false, follow);
  return was || start;
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
  const id = sessionId(payloadSession(parsePayload(raw)));
  const session = readSession(id);
  if (!session) return false;

  fs.rmSync(sessionFile(id), { force: true });
  emitEvent(parsePayload(raw).hook_event_name === "Interrupt" ? "interrupted" : "ended", id, session.project);
  if (working(listSessions()).length === 0) {
    stopDaemon({ keepSessions: true });
    fs.rmSync(INTENSITY_FILE, { force: true });
  }
  return true;
}


module.exports = { outcomeFromPayload, readPayload, notifyEnabled, sessionLabel, notifyCommand, banner, notify, announceEnabled, speakEvent, ANNOUNCE_FILE, ANNOUNCE_MAX_CHARS, ANNOUNCE_REPEAT_MS, ANNOUNCE_OUTCOMES, announce, hookStop, waitKey, WAIT_NOTIFICATIONS, hookWait, hookResume, resumeAfterUnmute, applyLiveMusic, hookEnd };
