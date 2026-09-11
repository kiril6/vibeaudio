/**
 * Claude Code Hooks Integration
 *
 * Hooks fire as short-lived processes, so playback lives in a detached daemon
 * tracked by a pid file. UserPromptSubmit starts it, Stop tears it down and
 * plays the chime. This tracks the agent's actual thinking window instead of
 * guessing from a wrapped process's lifetime.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { AudioPlayer } = require("./player");

const STATE_DIR = path.join(os.homedir(), ".vibeaudio");
const PID_FILE = path.join(STATE_DIR, "daemon.pid");
const CLI_ENTRY = path.join(__dirname, "..", "bin", "vibeaudio.js");

// A lost Stop hook must not leave music looping forever.
const MAX_DAEMON_MS = 15 * 60 * 1000;

function settingsPath() {
  return path.join(os.homedir(), ".claude", "settings.json");
}

function readPid() {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch (e) {
    return null;
  }
}

function stopDaemon() {
  const pid = readPid();
  fs.rmSync(PID_FILE, { force: true });
  if (pid === null) return false;

  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch (e) {
    return false; // Already gone
  }
}

/**
 * Internal mode: holds the audio open until told to stop. The player's own
 * loop timer keeps the event loop alive.
 */
function runDaemon(genre, volume) {
  const player = new AudioPlayer();
  if (!player.start(genre, volume)) process.exit(0);

  const shutdown = () => {
    player.stop({ playChime: false });
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  setTimeout(shutdown, MAX_DAEMON_MS);
}

function hookStart(genre, volume) {
  stopDaemon(); // Single instance: a new prompt replaces the previous run
  fs.mkdirSync(STATE_DIR, { recursive: true });

  const child = spawn(
    process.execPath,
    [CLI_ENTRY, "--daemon", "--genre", genre, "--volume", String(Math.round(volume * 100))],
    { detached: true, stdio: "ignore" }
  );
  child.unref();

  fs.writeFileSync(PID_FILE, String(child.pid));
  return child.pid;
}

function hookStop({ outcome = "success", volume = 0.4, chimeVolume = null, noChime = false } = {}) {
  const wasPlaying = stopDaemon();
  if (!wasPlaying || noChime) return false;

  // Chime plays in this short-lived hook process, after the daemon is gone.
  new AudioPlayer().stop({ playChime: true, outcome, volume, chimeVolume });
  return true;
}

function hookCommand(flag, genre, volume) {
  const base = `"${process.execPath}" "${CLI_ENTRY}" ${flag}`;
  return flag === "--hook-start"
    ? `${base} --genre ${genre} --volume ${Math.round(volume * 100)}`
    : base;
}

function isVibeHook(entry) {
  return (entry.hooks || []).some(
    (h) => typeof h.command === "string" && /--hook-(start|stop)\b/.test(h.command)
  );
}

function setHook(hooks, event, command) {
  // Replacing our own entries keeps repeat installs idempotent and leaves
  // every other tool's hooks untouched.
  const kept = (hooks[event] || []).filter((entry) => !isVibeHook(entry));
  kept.push({ hooks: [{ type: "command", command, timeout: 5 }] });
  hooks[event] = kept;
}

function loadSettings(file) {
  if (!fs.existsSync(file)) return { settings: {}, raw: null };
  const raw = fs.readFileSync(file, "utf8");
  try {
    return { settings: JSON.parse(raw), raw };
  } catch (e) {
    throw new Error(`${file} is not valid JSON (${e.message}) — refusing to overwrite it.`);
  }
}

function installHooks(genre = "lofi", volume = 0.4, file = settingsPath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const { settings, raw } = loadSettings(file);
  let backup = null;
  if (raw !== null) {
    backup = `${file}.vibeaudio.bak`;
    fs.writeFileSync(backup, raw);
  }

  settings.hooks = settings.hooks || {};
  setHook(settings.hooks, "UserPromptSubmit", hookCommand("--hook-start", genre, volume));
  setHook(settings.hooks, "Stop", hookCommand("--hook-stop", genre, volume));

  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  return { file, backup };
}

function uninstallHooks(file = settingsPath()) {
  if (!fs.existsSync(file)) return { file, removed: 0 };

  const { settings } = loadSettings(file);
  if (!settings.hooks) return { file, removed: 0 };

  let removed = 0;
  for (const [event, entries] of Object.entries(settings.hooks)) {
    const kept = entries.filter((entry) => !isVibeHook(entry));
    removed += entries.length - kept.length;

    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }

  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  return { file, removed };
}

module.exports = {
  runDaemon,
  hookStart,
  hookStop,
  stopDaemon,
  installHooks,
  uninstallHooks,
  settingsPath,
  isVibeHook,
  PID_FILE
};
