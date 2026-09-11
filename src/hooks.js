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
const INTENSITY_FILE = path.join(STATE_DIR, "intensity");
const CLI_ENTRY = path.join(__dirname, "..", "bin", "vibeaudio.js");

/**
 * Reactive mode: which tier a tool call implies. Searching and reading stay
 * sparse, edits bring in the groove, shelling out and subagents go to peak.
 * Unknown tools sit in the middle rather than swinging the mix.
 */
const TOOL_TIERS = {
  Read: 1, Glob: 1, Grep: 1, WebFetch: 1, WebSearch: 1, TodoWrite: 1,
  Edit: 2, Write: 2, MultiEdit: 2, NotebookEdit: 2,
  Bash: 3, Task: 3
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

/**
 * PreToolUse hook: Claude Code delivers the tool call as JSON on stdin.
 * Writes a tier for the running daemon to pick up at its next loop boundary.
 */
function hookTool() {
  let raw = "";
  const commit = () => {
    let toolName = "";
    try {
      toolName = JSON.parse(raw).tool_name || "";
    } catch (e) {
      // Malformed or absent payload - fall back to the neutral tier.
    }
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      fs.writeFileSync(INTENSITY_FILE, String(toolTier(toolName)));
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
function runDaemon(genre, volume, { reactive = false } = {}) {
  const player = new AudioPlayer();
  const started = player.start(genre, volume, {
    intensity: reactive ? readIntensity : null
  });
  if (!started) process.exit(0);

  const shutdown = () => {
    player.stop({ playChime: false });
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  setTimeout(shutdown, MAX_DAEMON_MS);
}

function hookStart(genre, volume, { reactive = false } = {}) {
  stopDaemon(); // Single instance: a new prompt replaces the previous run
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.rmSync(INTENSITY_FILE, { force: true }); // Don't inherit the last prompt's activity

  const args = [CLI_ENTRY, "--daemon", "--genre", genre, "--volume", String(Math.round(volume * 100))];
  if (reactive) args.push("--reactive");

  const child = spawn(process.execPath, args, { detached: true, stdio: "ignore" });
  child.unref();

  fs.writeFileSync(PID_FILE, String(child.pid));
  return child.pid;
}

function hookStop({ outcome = "success", volume = 0.4, chimeVolume = null, noChime = false } = {}) {
  const wasPlaying = stopDaemon();
  fs.rmSync(INTENSITY_FILE, { force: true });
  if (!wasPlaying || noChime) return false;

  // Chime plays in this short-lived hook process, after the daemon is gone.
  new AudioPlayer().stop({ playChime: true, outcome, volume, chimeVolume });
  return true;
}

function hookCommand(flag, genre, volume, reactive = false) {
  const base = `"${process.execPath}" "${CLI_ENTRY}" ${flag}`;
  if (flag !== "--hook-start") return base;

  const start = `${base} --genre ${genre} --volume ${Math.round(volume * 100)}`;
  return reactive ? `${start} --reactive` : start;
}

function isVibeHook(entry) {
  return (entry.hooks || []).some(
    (h) => typeof h.command === "string" && /--hook-(start|stop|tool)\b/.test(h.command)
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

function installHooks(genre = "lofi", volume = 0.4, file = settingsPath(), { reactive = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const { settings, raw } = loadSettings(file);
  let backup = null;
  if (raw !== null) {
    backup = `${file}.vibeaudio.bak`;
    fs.writeFileSync(backup, raw);
  }

  settings.hooks = settings.hooks || {};
  setHook(settings.hooks, "UserPromptSubmit", hookCommand("--hook-start", genre, volume, reactive));
  setHook(settings.hooks, "Stop", hookCommand("--hook-stop", genre, volume));

  // Only reactive mode needs per-tool-call signalling.
  if (reactive) {
    setHook(settings.hooks, "PreToolUse", hookCommand("--hook-tool", genre, volume));
  } else if (settings.hooks.PreToolUse) {
    const kept = settings.hooks.PreToolUse.filter((entry) => !isVibeHook(entry));
    if (kept.length) settings.hooks.PreToolUse = kept;
    else delete settings.hooks.PreToolUse;
  }

  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  return { file, backup, reactive };
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
  hookTool,
  toolTier,
  readIntensity,
  stopDaemon,
  installHooks,
  uninstallHooks,
  settingsPath,
  isVibeHook,
  PID_FILE
};
