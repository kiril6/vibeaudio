/**
 * VibeAudio CLI Wrapper Implementation
 */

const { spawn } = require("child_process");
const { AudioPlayer } = require("./player");
const pkg = require("../package.json");

const GRACE_PERIOD_MS = 1500; // 1.5 second silence grace window

function printHelp() {
  console.log(`
\x1b[1m\x1b[36mVibeAudio\x1b[0m v${pkg.version}
Procedural focus music while your AI coding tools think.

\x1b[1mUSAGE:\x1b[0m
  vibe [options] <command> [args...]
  vibeaudio [options] <command> [args...]

\x1b[1mEXAMPLES:\x1b[0m
  vibe claude
  vibe gemini
  vibe --genre synthwave claude
  vibe --genre 8bit sleep 5
  vibe --volume 30 npm test

\x1b[1mOPTIONS:\x1b[0m
  -g, --genre <name>     Select music genre: lofi (default), synthwave, 8bit
  -v, --volume <0-100>   Set playback volume (default: 40)
      --no-chime         Disable the resolution completion chime
  -h, --help             Show this help message
      --version          Show version
`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let genre = "lofi";
  let volume = 0.40;
  let noChime = false;
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

    if (arg === "--no-chime") {
      noChime = true;
      i += 1;
      continue;
    }

    // Everything from here is the child command
    cmdArgs = args.slice(i);
    break;
  }

  return { genre, volume, noChime, cmdArgs };
}

function run() {
  const { genre, volume, noChime, cmdArgs } = parseArgs(process.argv);

  if (cmdArgs.length === 0) {
    printHelp();
    process.exit(1);
  }

  const player = new AudioPlayer();
  const startTime = Date.now();
  let musicStarted = false;

  // 1.5-second grace window before triggering audio
  const graceTimer = setTimeout(() => {
    musicStarted = true;
    player.start(genre, volume);
  }, GRACE_PERIOD_MS);

  const command = cmdArgs[0];
  const commandArgs = cmdArgs.slice(1);

  const child = spawn(command, commandArgs, {
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  const cleanup = (code = 0) => {
    clearTimeout(graceTimer);
    const elapsed = Date.now() - startTime;
    const shouldChime = musicStarted && !noChime && code === 0 && elapsed > GRACE_PERIOD_MS;
    player.stop({ playChime: shouldChime, volume: Math.min(0.5, volume * 0.9) });
    process.exit(code);
  };

  child.on("error", (err) => {
    clearTimeout(graceTimer);
    player.stop({ playChime: false });
    console.error(`\x1b[31m[vibeaudio] Failed to start command '${command}':\x1b[0m ${err.message}`);
    process.exit(1);
  });

  child.on("close", (code) => {
    cleanup(code !== null ? code : 0);
  });

  // Relay termination signals cleanly
  process.on("SIGINT", () => {
    clearTimeout(graceTimer);
    player.stop({ playChime: false });
    if (child.pid) child.kill("SIGINT");
  });

  process.on("SIGTERM", () => {
    clearTimeout(graceTimer);
    player.stop({ playChime: false });
    if (child.pid) child.kill("SIGTERM");
  });
}

module.exports = { run, parseArgs };
