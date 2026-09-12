/**
 * Agent Hooks Integration (Claude Code, Codex, Cursor)
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
const CLI_ENTRY = path.join(__dirname, "..", "bin", "vibeaudio.js");

/**
 * Reactive mode: which tier a tool call implies. Searching and reading stay
 * sparse, edits bring in the groove, shelling out and subagents go to peak.
 * Unknown tools sit in the middle rather than swinging the mix.
 *
 * The agents don't agree on tool names, so every vocabulary lives here: Claude
 * Code's PascalCase set (which Grok shares), Codex's snake_case one, and
 * Cursor's short names. They don't collide, so one flat map covers them all.
 */
const TOOL_TIERS = {
  // Claude Code
  Read: 1, Glob: 1, Grep: 1, WebFetch: 1, WebSearch: 1, TodoWrite: 1,
  Edit: 2, Write: 2, MultiEdit: 2, NotebookEdit: 2,
  Bash: 3, Task: 3,
  // Codex
  read_file: 1, list_dir: 1, grep: 1, web_search: 1, update_plan: 1,
  apply_patch: 2,
  shell: 3,
  // Cursor (MCP calls arrive as "MCP:<name>" and fall through to the middle)
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

/**
 * PreToolUse hook: Claude Code delivers the tool call as JSON on stdin.
 * Writes a tier for the running daemon to pick up at its next loop boundary.
 */
function hookTool() {
  let raw = "";
  const commit = () => {
    let toolName = "";
    try {
      const payload = JSON.parse(raw);
      // Claude Code, Codex and Cursor send tool_name; Grok sends toolName.
      // Reading only one of them would silently pin that agent to tier 2.
      toolName = payload.tool_name || payload.toolName || "";
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

/**
 * The agents VibeAudio can wire itself into, and the three things that differ
 * between them. Verified against the files each tool actually writes:
 *
 *   Claude Code  ~/.claude/settings.json  PascalCase events, nested entries
 *   Codex        ~/.codex/hooks.json      same shape, different file
 *   Cursor       ~/.cursor/hooks.json     camelCase events, flat entries
 *
 * `seed` is the root object to write when the file does not exist yet. Cursor
 * requires its schema version; Codex rejects unknown root keys outright, so
 * nothing may be added there beyond `hooks`.
 */
const TARGETS = {
  claude: {
    name: "Claude Code",
    cmd: "claude",
    file: () => path.join(os.homedir(), ".claude", "settings.json"),
    events: { start: "UserPromptSubmit", stop: "Stop", tool: "PreToolUse" },
    entry: (command) => ({ hooks: [{ type: "command", command, timeout: 5 }] }),
    commands: (entry) => (entry.hooks || []).map((h) => h.command),
    seed: () => ({})
  },
  codex: {
    name: "Codex",
    cmd: "codex",
    file: () => path.join(os.homedir(), ".codex", "hooks.json"),
    events: { start: "UserPromptSubmit", stop: "Stop", tool: "PreToolUse" },
    entry: (command) => ({ hooks: [{ type: "command", command, timeout: 5 }] }),
    commands: (entry) => (entry.hooks || []).map((h) => h.command),
    seed: () => ({}),
    // Codex records a trusted_hash per hook in config.toml and asks before
    // running one it has not seen, so the install is not live until approved.
    note: "Codex asks you to trust a new hook the first time it fires — approve it once."
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

function stopDaemon() {
  const pid = readPid();
  fs.rmSync(PID_FILE, { force: true });
  if (pid === null || !isOurDaemon(pid)) return false;

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

function isVibeHook(entry, id = "claude") {
  return target(id)
    .commands(entry)
    .some((c) => typeof c === "string" && /--hook-(start|stop|tool)\b/.test(c));
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

function readVibeEntryCount(file, id) {
  try {
    const { settings } = loadSettings(file);
    return Object.values(settings.hooks || {}).reduce(
      (n, entries) => n + (entries || []).filter((e) => isVibeHook(e, id)).length,
      0
    );
  } catch (e) {
    return 0; // Unreadable: the delete below still cleans it up.
  }
}

function loadSettings(file, t = null) {
  if (!fs.existsSync(file)) return { settings: t ? t.seed() : {}, raw: null };
  const raw = fs.readFileSync(file, "utf8");
  try {
    return { settings: JSON.parse(raw), raw };
  } catch (e) {
    throw new Error(`${file} is not valid JSON (${e.message}) — refusing to overwrite it.`);
  }
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

function installHooks(genre = "lofi", volume = 0.4, file = null, { reactive = false, id = "claude" } = {}) {
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

  fs.mkdirSync(path.dirname(file), { recursive: true });

  const { settings, raw } = loadSettings(file, t);
  let backup = null;
  if (raw !== null) {
    backup = `${file}.vibeaudio.bak`;
    fs.writeFileSync(backup, raw);
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

  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  return { file, backup, reactive, id, name: t.name, note: t.note || null, events: ev };
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

  const { settings } = loadSettings(file);
  if (!settings.hooks) return { file, removed: 0, id };

  let removed = 0;
  for (const [event, entries] of Object.entries(settings.hooks)) {
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
  runDaemon,
  hookStart,
  hookStop,
  hookTool,
  toolTier,
  readIntensity,
  stopDaemon,
  isOurDaemon,
  installHooks,
  ephemeralInstallReason,
  uninstallHooks,
  settingsPath,
  isVibeHook,
  TARGETS,
  targetFile,
  detectTargets,
  PID_FILE
};
