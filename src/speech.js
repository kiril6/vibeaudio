/**
 * Spoken announcements (#33): the sentence after the chime that says *which*
 * project finished, failed or needs you. A chime says that something happened
 * and leaves you alt-tabbing to find out what.
 *
 * Opt-in (`--speak`, `speak` in config.json, `VIBE_SPEAK`). Three modes:
 * `auto` speaks only when two or more sessions are going - the one case where
 * the chime cannot answer "which one?"; with a single session the sentence
 * would repeat what the chime already said. `always` speaks every time.
 *
 * The voice is the operating system's own (`say`, `spd-say` / `espeak`,
 * `System.Speech`), so nothing is installed and nothing leaves the machine.
 * The words are fixed: a project name and a state, never the agent's output.
 * The project name is user-controlled text, so it travels as argv (or an
 * environment variable on Windows), never spliced into a shell or a script.
 *
 * Speech runs in a detached process of its own (`node speech.js --run ...`):
 * the agent waits on the hook, and the sentence has to start after the chime,
 * not on top of it. That process takes a lock for the length of the sentence,
 * so sessions that finish together speak one after another, not over each
 * other. Merging them into one sentence is not done.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const STATE_DIR = path.join(os.homedir(), ".vibeaudio");
const LOCK_FILE = path.join(STATE_DIR, "speech.lock");
const LAST_FILE = path.join(STATE_DIR, "speech.json");

const SPEECH_MAX_CHARS = 200;
const REPEAT_MS = 5000; // the same sentence inside this window is dropped
const LOCK_STALE_MS = 30000; // a holder this old died without releasing
const LOCK_WAIT_MS = 20000; // a queue this long is not worth joining
const SPEAK_TIMEOUT_MS = 15000; // a voice that hangs is killed

// How long each chime plays, plus a breath: the sentence starts after it.
const CHIME_MS = { success: 1600, failure: 1800, attention: 1300, stuck: 1800 };
const CHIME_GAP_MS = 150;

const MODES = ["off", "auto", "always"];

function parseMode(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "always") return "always";
  if (["1", "true", "on", "yes", "auto"].includes(raw)) return "auto";
  return "off";
}

/** Env beats the saved setting, like every other one. */
function speakMode(env = process.env, config = {}) {
  return parseMode(env.VIBE_SPEAK ?? config.speak);
}

/** Whether to speak now: `auto` needs two or more sessions to be worth it. */
function shouldSpeak(mode, sessionCount) {
  return mode === "always" || (mode === "auto" && sessionCount >= 2);
}

/**
 * Text that is safe to hand a voice: no control characters, and no embedded
 * speech commands. macOS `say` reads `[[volm 0]]` and its kin out of the text,
 * so a project directory called that would otherwise steer the voice.
 */
function cleanText(text, max = SPEECH_MAX_CHARS) {
  let out = String(text).replace(/[\u0000-\u001f\u007f]+/g, " ");
  while (/\[\[[^\]]*\]\]/.test(out)) out = out.replace(/\[\[[^\]]*\]\]/g, " ");
  out = out.replace(/\[\[|\]\]/g, " "); // what nesting left behind
  return out.replace(/\s+/g, " ").trim().slice(0, max);
}

/** "my-app_v2" reads better as "my app v2" than as "my dash app underscore v2". */
function speakableLabel(label) {
  return cleanText(String(label).replace(/[-_.]+/g, " "), 60) || "a session";
}

/**
 * The fixed sentences. `tool` is only passed for a built-in tool name: an MCP
 * tool's name is third-party text, and the line never speaks it.
 */
function phrase(kind, label, tool = "") {
  const who = speakableLabel(label);
  const what = cleanText(String(tool).replace(/_/g, " "), 40);
  switch (kind) {
    case "failure": return `${who}: failed.`;
    case "attention": return what ? `${who} needs you: ${what}.` : `${who} needs you.`;
    case "stuck": return `${who} looks stuck.`;
    default: return `${who}: done.`;
  }
}

const POWERSHELL_SCRIPT =
  "Add-Type -AssemblyName System.Speech; " +
  "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; " +
  "$s.Volume = [int]$env:VIBE_SPEECH_VOLUME; " +
  "$s.Speak($env:VIBE_SPEECH_TEXT)";

/**
 * The command that speaks `text`, or null where this machine has no voice.
 * `volume` is VibeAudio's 0-1 setting where the voice has a way to take it:
 * macOS `say` follows the system volume unless told otherwise, and `spd-say`
 * has no usable scale, so it speaks at its own level.
 */
function voiceCommand(platform, text, volume = 0.4, has = () => false) {
  const v = Math.max(0.05, Math.min(1, Number(volume) || 0.4));
  if (platform === "darwin") {
    return has("say") ? { cmd: "say", args: ["--", `[[volm ${v.toFixed(2)}]] ${text}`] } : null;
  }
  if (platform === "win32") {
    return {
      cmd: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-Command", POWERSHELL_SCRIPT],
      env: { VIBE_SPEECH_TEXT: text, VIBE_SPEECH_VOLUME: String(Math.round(v * 100)) }
    };
  }
  if (has("spd-say")) return { cmd: "spd-say", args: ["-w", "--", text] };
  for (const cmd of ["espeak-ng", "espeak"]) {
    if (has(cmd)) return { cmd, args: ["-a", String(Math.round(v * 200)), "--", text] };
  }
  return null;
}

function currentVoice(text, volume) {
  const { isInstalled } = require("./interactive");
  return voiceCommand(process.platform, text, volume, isInstalled);
}

/** `--doctor`: is there anything to speak with here? */
function voiceAvailable() {
  return currentVoice("test", 0.4) !== null;
}

/**
 * Hand a sentence to a detached process that waits `delayMs` (for the chime),
 * takes its turn on the lock, and speaks. Returns false when nothing was
 * started. Never throws and never waits: the caller is a hook.
 */
function speak(text, { delayMs = 0, volume = 0.4 } = {}) {
  try {
    const { playbackDisabled } = require("./player");
    if (playbackDisabled()) return false; // a mute means quiet, speech included
    const clean = cleanText(text);
    if (!clean || !currentVoice(clean, volume)) return false;
    const child = spawn(process.execPath, [__filename, "--run", String(Math.max(0, Math.round(delayMs))), String(volume), clean], {
      detached: true,
      stdio: "ignore"
    });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch (e) {
    return false;
  }
}

/** How long to wait so a sentence starts after the chime that was just played. */
function chimeDelayMs(outcome, played = true) {
  return played ? (CHIME_MS[outcome] || CHIME_MS.success) + CHIME_GAP_MS : 0;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

/** One speaker at a time across processes: exclusive create, with a stale check. */
async function acquireLock(waitMs = LOCK_WAIT_MS) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: "wx" });
      return () => fs.rmSync(LOCK_FILE, { force: true });
    } catch (e) {
      if (e.code !== "EEXIST") return null;
    }
    try {
      const held = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
      if (Date.now() - held.at > LOCK_STALE_MS || !pidAlive(held.pid)) fs.rmSync(LOCK_FILE, { force: true });
    } catch (e) {
      // Unreadable (being written, or just removed): look again.
    }
    if (Date.now() > deadline) return null;
    await sleep(100);
  }
}

function speakNow(text, volume) {
  return new Promise((resolve) => {
    const voice = currentVoice(text, volume);
    if (!voice) return resolve(false);
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(ok);
    };
    let child;
    try {
      child = spawn(voice.cmd, voice.args, { stdio: "ignore", env: { ...process.env, ...(voice.env || {}) } });
    } catch (e) {
      return resolve(false);
    }
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch (e) { /* gone already */ }
      finish(false);
    }, SPEAK_TIMEOUT_MS);
    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0));
  });
}

/** The body of the detached process. */
async function run(delayMs, volume, text) {
  const { playbackDisabled } = require("./player");
  await sleep(delayMs);
  const release = await acquireLock();
  if (!release) return; // could not get a turn: drop it rather than talk over someone
  try {
    if (playbackDisabled()) return; // muted while it waited
    try {
      const last = JSON.parse(fs.readFileSync(LAST_FILE, "utf8"));
      if (last.text === text && Date.now() - last.at < REPEAT_MS) return;
    } catch (e) { /* first one, or unreadable: nothing to compare */ }
    fs.writeFileSync(LAST_FILE, JSON.stringify({ text, at: Date.now() }));
    await speakNow(text, volume);
  } finally {
    release();
  }
}

if (require.main === module && process.argv[2] === "--run") {
  run(Number(process.argv[3]) || 0, Number(process.argv[4]) || 0.4, String(process.argv[5] || ""))
    .catch(() => {})
    .finally(() => process.exit(0));
}

module.exports = {
  MODES,
  speakMode,
  shouldSpeak,
  cleanText,
  phrase,
  voiceCommand,
  voiceAvailable,
  speak,
  chimeDelayMs,
  acquireLock,
  LOCK_FILE,
  LAST_FILE,
  SPEECH_MAX_CHARS
};
