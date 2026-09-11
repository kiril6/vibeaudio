/**
 * VibeAudio CLI Wrapper Implementation
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const {
  AudioPlayer,
  getAudioPath,
  clearCache,
  detectPlayer,
  resolveGenre,
  isKnownGenre,
  wavDurationMs,
  AVAILABLE_GENRES
} = require("./player");
const pkg = require("../package.json");

const DEFAULT_GRACE_PERIOD_MS = 1500; // 1.5 second silence grace window

const HOOK_ACTIONS = [
  "--install-hooks",
  "--uninstall-hooks",
  "--hook-start",
  "--hook-stop",
  "--hook-tool",
  "--daemon"
];

function printHelp() {
  console.log(`
\x1b[1m\x1b[36mVibeAudio\x1b[0m v${pkg.version}
Procedural focus music while your AI coding tools think.

\x1b[1mUSAGE:\x1b[0m
  vibe [options] <command> [args...]
  vibeaudio [options] <command> [args...]

\x1b[1mEXAMPLES:\x1b[0m
  vibe --install-hooks           \x1b[90m# best for interactive Claude Code — music follows thinking\x1b[0m
  vibe npm test                  \x1b[90m# wrap any command that exits when it's done\x1b[0m
  vibe claude -p "explain this"
  vibe --genre synthwave claude
  vibe --genre 8bit sleep 5
  vibe --volume 30 npm test
  vibe --preview jazz

\x1b[1mOPTIONS:\x1b[0m
  -g, --genre <name>           Select genre: lofi (default), synthwave, 8bit, electronic, jazz, zen, random
  -v, --volume <0-100>         Set playback volume (default: 40)
  -cv, --chime-volume <0-100>   Set independent completion chime volume
      --grace <ms>             Silence window before music starts, in ms (default: ${DEFAULT_GRACE_PERIOD_MS})
      --seed <n>               Force a specific arrangement (default: derived from the project directory)
      --whisper                Preset: 15% volume (late night / headphones)
      --quiet                  Preset: 25% volume (focus / open office)
      --loud                   Preset: 75% volume (hear from across the room)
      --no-chime               Disable the resolution completion chime
      --no-hud                 Disable terminal window/tab title animation
      --preview <genre>        Play one loop of a genre and exit
      --clear-cache            Delete cached audio, then exit
      --mcp                    Run as Model Context Protocol (MCP) server for Desktop apps
      --install-hooks          Wire music into Claude Code hooks (no wrapper needed)
      --reactive               With --install-hooks: intensity follows the tool in use
      --uninstall-hooks        Remove the Claude Code hooks again
  -h, --help                   Show this help message
      --version                Show version

\x1b[1mENVIRONMENT:\x1b[0m
  VIBE_GENRE=<name>            Set persistent default genre (e.g. export VIBE_GENRE=jazz)
  VIBE_VOLUME=<0-100>          Set persistent default volume (e.g. export VIBE_VOLUME=25)
  VIBE_CHIME_VOLUME=<0-100>    Set persistent chime volume (e.g. export VIBE_CHIME_VOLUME=60)
  VIBE_GRACE_MS=<ms>           Set persistent grace window in ms (e.g. export VIBE_GRACE_MS=3000)
  VIBE_SEED=<n>                Pin the arrangement instead of deriving it from the directory
`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let genre = (process.env.VIBE_GENRE || "lofi").toLowerCase();

  const envVol = process.env.VIBE_VOLUME ? parseInt(process.env.VIBE_VOLUME, 10) : NaN;
  let volume = !isNaN(envVol) ? Math.max(5, Math.min(100, envVol)) / 100.0 : 0.40;

  const envChimeVol = process.env.VIBE_CHIME_VOLUME ? parseInt(process.env.VIBE_CHIME_VOLUME, 10) : NaN;
  let chimeVolume = !isNaN(envChimeVol) ? Math.max(5, Math.min(100, envChimeVol)) / 100.0 : null;

  const envGrace = process.env.VIBE_GRACE_MS ? parseInt(process.env.VIBE_GRACE_MS, 10) : NaN;
  let grace = !isNaN(envGrace) ? Math.max(0, envGrace) : DEFAULT_GRACE_PERIOD_MS;

  let noChime = false;
  let noHud = false;
  let preview = null;
  let clearCacheFlag = false;
  let hookAction = null;
  let reactive = false;
  let cmdArgs = [];

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--version") {
      console.log(pkg.version);
      process.exit(0);
    }

    if (arg === "-g" || arg === "--genre") {
      if (i + 1 < args.length) {
        genre = args[i + 1].toLowerCase();
        i += 2;
        continue;
      }
    }

    if (arg === "-v" || arg === "--volume") {
      if (i + 1 < args.length) {
        const parsed = parseInt(args[i + 1], 10);
        if (!isNaN(parsed)) {
          volume = Math.max(5, Math.min(100, parsed)) / 100.0;
        }
        i += 2;
        continue;
      }
    }

    if (arg === "-cv" || arg === "--chime-volume") {
      if (i + 1 < args.length) {
        const parsed = parseInt(args[i + 1], 10);
        if (!isNaN(parsed)) {
          chimeVolume = Math.max(5, Math.min(100, parsed)) / 100.0;
        }
        i += 2;
        continue;
      }
    }

    if (arg === "--grace") {
      if (i + 1 < args.length) {
        const parsed = parseInt(args[i + 1], 10);
        if (!isNaN(parsed)) {
          grace = Math.max(0, parsed);
        }
        i += 2;
        continue;
      }
    }

    if (arg === "--seed") {
      if (i + 1 < args.length) {
        const parsed = parseInt(args[i + 1], 10);
        if (!isNaN(parsed)) process.env.VIBE_SEED = String(parsed >>> 0);
        i += 2;
        continue;
      }
    }

    if (arg === "--preview") {
      preview = i + 1 < args.length ? args[i + 1].toLowerCase() : genre;
      i += 2;
      continue;
    }

    if (arg === "--clear-cache") {
      clearCacheFlag = true;
      i += 1;
      continue;
    }

    if (HOOK_ACTIONS.includes(arg)) {
      hookAction = arg.slice(2);
      i += 1;
      continue;
    }

    if (arg === "--reactive") {
      reactive = true;
      i += 1;
      continue;
    }

    if (arg === "--whisper") {
      volume = 0.15;
      i += 1;
      continue;
    }

    if (arg === "--quiet") {
      volume = 0.25;
      i += 1;
      continue;
    }

    if (arg === "--loud") {
      volume = 0.75;
      i += 1;
      continue;
    }

    if (arg === "--no-chime") {
      noChime = true;
      i += 1;
      continue;
    }

    if (arg === "--no-hud") {
      noHud = true;
      i += 1;
      continue;
    }

    // Everything from here is the child command
    cmdArgs = args.slice(i);
    break;
  }

  if (!isKnownGenre(genre)) {
    console.error(
      `\x1b[33m[vibeaudio] Unknown genre '${genre}' — falling back to lofi.\x1b[0m\n` +
        `  Available: ${AVAILABLE_GENRES.join(", ")}, random`
    );
    genre = "lofi";
  }

  return {
    genre,
    volume,
    chimeVolume,
    grace,
    noChime,
    noHud,
    preview,
    clearCache: clearCacheFlag,
    hookAction,
    reactive,
    cmdArgs
  };
}

const { promptInteractive } = require("./interactive");
const { TerminalHud } = require("./hud");

function signalExitCode(signal) {
  return 128 + (os.constants.signals[signal] || 0);
}

function previewGenre(genre, volume) {
  if (!isKnownGenre(genre)) {
    console.error(`\x1b[31m[vibeaudio] Unknown genre '${genre}'.\x1b[0m Available: ${AVAILABLE_GENRES.join(", ")}, random`);
    process.exit(1);
  }

  const backend = detectPlayer();
  if (!backend) {
    console.error("\x1b[31m[vibeaudio] No supported audio player found — cannot preview.\x1b[0m");
    process.exit(1);
  }

  const resolved = resolveGenre(genre);
  const audioFile = getAudioPath(resolved, 2);
  const seconds = ((wavDurationMs(audioFile) || 6500) / 1000).toFixed(1);

  console.log(`\x1b[36m♫ Previewing \x1b[1m${resolved}\x1b[0m\x1b[36m (tier 2, ${seconds}s) — Ctrl+C to stop\x1b[0m`);
  spawnSync(backend.cmd, backend.args(audioFile, volume), { stdio: "ignore" });
}

function runHookAction(action, { genre, volume, chimeVolume, noChime, reactive }) {
  const hooks = require("./hooks");

  switch (action) {
    case "daemon":
      return hooks.runDaemon(genre, volume, { reactive });

    case "hook-start":
      hooks.hookStart(genre, volume, { reactive });
      return;

    case "hook-stop":
      hooks.hookStop({ outcome: "success", volume, chimeVolume, noChime });
      return;

    case "hook-tool":
      return hooks.hookTool();

    case "install-hooks": {
      const { file, backup } = hooks.installHooks(genre, volume, hooks.settingsPath(), { reactive });
      console.log(`\x1b[32m✔ VibeAudio hooks installed in ${file}\x1b[0m`);
      if (backup) console.log(`  Previous settings backed up to ${backup}`);
      console.log(`  UserPromptSubmit → music starts (${genre} @ ${Math.round(volume * 100)}%)`);
      console.log(`  Stop             → music stops + success chime`);
      if (reactive) {
        console.log(`  PreToolUse       → intensity follows the tool in use (reactive mode)`);
      }
      console.log(`  Restart Claude Code for the hooks to take effect.`);
      console.log(`  Remove them any time with: vibe --uninstall-hooks`);
      return;
    }

    case "uninstall-hooks": {
      const { file, removed } = hooks.uninstallHooks();
      console.log(
        removed > 0
          ? `\x1b[32m✔ Removed ${removed} VibeAudio hook(s) from ${file}\x1b[0m`
          : `\x1b[90mNo VibeAudio hooks found in ${file}\x1b[0m`
      );
      return;
    }
  }
}

/**
 * Claude Code fires our hooks itself, so wrapping it would layer a second
 * stream over the hook daemon's - and the wrapper's stream is the wrong one:
 * it times the REPL's whole session rather than the model's thinking, so it
 * never stops while you read or type.
 */
function hooksAlreadyCover(cmdArgs, settingsFile = null) {
  if (path.basename(cmdArgs[0]) !== "claude") return false;

  try {
    const hooks = require("./hooks");
    const file = settingsFile || hooks.settingsPath();
    if (!fs.existsSync(file)) return false;

    const settings = JSON.parse(fs.readFileSync(file, "utf8"));
    return Object.values(settings.hooks || {}).some((entries) =>
      (entries || []).some(hooks.isVibeHook)
    );
  } catch (e) {
    // Unreadable settings are the hook installer's problem to report, not ours.
    return false;
  }
}

function executeCommand(cmdArgs, genre, volume, chimeVolume, grace = DEFAULT_GRACE_PERIOD_MS, noChime, noHud = false) {
  const player = new AudioPlayer();
  const hookDriven = hooksAlreadyCover(cmdArgs);
  const hud = !noHud && !hookDriven ? new TerminalHud(genre) : null;
  const startTime = Date.now();
  let musicStarted = false;
  let finished = false;

  // `claude -p` exits when its work does, so the wrapper is right there. An
  // interactive session is the case where process lifetime isn't thinking time.
  const interactiveAgent =
    path.basename(cmdArgs[0]) === "claude" &&
    !cmdArgs.slice(1).some((a) => a === "-p" || a === "--print");

  if (hookDriven) {
    console.error(
      "\x1b[90m[vibeaudio] Claude Code hooks are installed — letting them drive the music, " +
      "so it follows the agent's thinking instead of this session's length.\n" +
      "           Change the sound with: vibe --genre <name> --volume <n> --install-hooks\x1b[0m"
    );
  } else if (interactiveAgent) {
    console.error(
      "\x1b[33m[vibeaudio] Wrapping an interactive session: music plays until you quit, " +
      "not just while the agent thinks.\n" +
      "           For music that tracks thinking, run: vibe --install-hooks\x1b[0m"
    );
  }

  // Grace window before triggering audio (silences fast commands)
  const graceTimer = hookDriven ? null : setTimeout(() => {
    musicStarted = true;
    player.start(genre, volume);
    if (hud) hud.start();
  }, grace);

  const command = cmdArgs[0];
  const commandArgs = cmdArgs.slice(1);

  const child = spawn(command, commandArgs, {
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  // Runs exactly once: both the signal path and the close path lead here.
  const cleanup = (code, signal = null) => {
    if (finished) return;
    finished = true;
    clearTimeout(graceTimer);

    const elapsed = Date.now() - startTime;
    const interrupted = signal === "SIGINT" || signal === "SIGTERM";
    const outcome = code === 0 ? "success" : "failure";
    // A deliberate abort is not an outcome worth chiming about.
    const shouldChime = musicStarted && !noChime && !interrupted && elapsed > grace;

    if (hud) hud.stop({ outcome, code, interrupted });
    player.stop({
      playChime: shouldChime,
      outcome,
      volume: Math.min(0.5, volume * 0.9),
      chimeVolume
    });
    process.exit(code);
  };

  child.on("error", (err) => {
    if (finished) return;
    finished = true;
    clearTimeout(graceTimer);
    if (hud) hud.stop({ outcome: "failure", code: 1 });
    player.stop({ playChime: false });
    console.error(`\x1b[31m[vibeaudio] Failed to start command '${command}':\x1b[0m ${err.message}`);
    process.exit(1);
  });

  // A signal-killed child reports code === null; mapping that to 0 would claim
  // success for an aborted run.
  child.on("close", (code, signal) => {
    if (signal) cleanup(signalExitCode(signal), signal);
    else cleanup(code !== null ? code : 0);
  });

  // Relay termination signals, then let the child's exit drive cleanup.
  const relaySignal = (signal) => {
    if (!child.pid || finished) {
      cleanup(signalExitCode(signal), signal);
      return;
    }
    child.kill(signal);
    const fallback = setTimeout(() => cleanup(signalExitCode(signal), signal), 2000);
    if (fallback.unref) fallback.unref();
  };

  process.on("SIGINT", () => relaySignal("SIGINT"));
  process.on("SIGTERM", () => relaySignal("SIGTERM"));
}

async function run() {
  if (process.argv.includes("--mcp")) {
    const { startMcpServer } = require("./mcp");
    return startMcpServer();
  }

  const {
    genre,
    volume,
    chimeVolume,
    grace,
    noChime,
    noHud,
    preview,
    clearCache: shouldClear,
    hookAction,
    reactive,
    cmdArgs
  } = parseArgs(process.argv);

  if (hookAction) {
    try {
      return runHookAction(hookAction, { genre, volume, chimeVolume, noChime, reactive });
    } catch (e) {
      // Settings problems are the user's to fix — report them, don't stack-trace.
      console.error(`\x1b[31m[vibeaudio] ${e.message}\x1b[0m`);
      process.exit(1);
    }
  }

  if (reactive) {
    console.error(
      "\x1b[33m[vibeaudio] --reactive only applies to --install-hooks; ignoring it here.\x1b[0m"
    );
  }

  if (shouldClear) {
    console.log(`\x1b[32m[vibeaudio] Cleared cache at ${clearCache()}\x1b[0m`);
    return;
  }

  if (preview) {
    return previewGenre(preview, volume);
  }

  if (cmdArgs.length === 0) {
    if (process.stdin.isTTY) {
      try {
        const selection = await promptInteractive();
        const chosenVol = selection.volume !== undefined ? selection.volume : volume;
        return executeCommand(selection.cmd, selection.genre, chosenVol, chimeVolume, grace, noChime, noHud);
      } catch (e) {
        process.exit(0);
      }
    } else {
      printHelp();
      process.exit(1);
    }
  }

  executeCommand(cmdArgs, genre, volume, chimeVolume, grace, noChime, noHud);
}

module.exports = { run, parseArgs, hooksAlreadyCover };
