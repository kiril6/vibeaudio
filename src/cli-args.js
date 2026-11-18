/** Command-line parsing: parseArgs, flag tables, the --help text. */

const path = require("path");
const pkg = require("../package.json");
const chimefile = require("./chimefile");
const { isKnownGenre, normalizeVolume, loadConfig, musicEnabled, projectSettings, AVAILABLE_GENRES } = require("./player");
const { printUpdateNotice } = require("./cli-status");


const DEFAULT_GRACE_PERIOD_MS = 1500; // 1.5 second silence grace window

const HOOK_ACTIONS = [
  "--install-hooks",
  "--uninstall-hooks",
  "--hook-start",
  "--hook-stop",
  "--hook-tool",
  "--hook-wait",
  "--hook-resume",
  "--hook-end",
  "--daemon"
];

/**
 * Flags that consume the next argument. Without this list a trailing
 * `vibe --genre` falls through every branch below and lands in cmdArgs, so the
 * wrapper tries to spawn a program called `--genre` and reports ENOENT on it -
 * the one error message that says nothing about the actual mistake.
 */
const VALUE_FLAGS = new Set([
  "-g", "--genre",
  "-v", "--volume",
  "-cv", "--chime-volume",
  "--grace",
  "--music",
  "--success-chime", "--failure-chime", "--attention-chime",
  "--announcements",
  "--seed",
  "--tools",
  "--event",
  "--announce",
  "--outcome",
  "--exit-code",
  "--port",
  "--out"
]);

function parseArgs(argv) {
  const args = argv.slice(2);

  // Flag beats env var beats saved config beats the built-in default. The
  // saved config is what makes "set my genre" have one answer instead of three
  // - see loadConfig() in player.js - and it sits below the env var so a shell
  // that exports one keeps winning, as it always did.
  const saved = loadConfig();
  // A setting saved for this directory sits between the environment and the
  // global default: `--here` is a deliberate choice about one project, so it
  // outranks the machine-wide one, and an export still outranks both.
  const here = projectSettings(saved);
  const setting = (key) => (here[key] !== undefined ? here[key] : saved[key]);

  let music = musicEnabled(process.env, saved);
  let genre = (process.env.VIBE_GENRE || setting("genre") || "lofi").toLowerCase();

  let volume = normalizeVolume(process.env.VIBE_VOLUME, normalizeVolume(setting("volume"), 0.40));
  let chimeVolume = normalizeVolume(process.env.VIBE_CHIME_VOLUME, normalizeVolume(setting("chimeVolume"), null));

  const envGrace = process.env.VIBE_GRACE_MS ? parseInt(process.env.VIBE_GRACE_MS, 10) : NaN;
  let grace = !isNaN(envGrace) ? Math.max(0, envGrace)
    : Number.isFinite(setting("grace")) ? Math.max(0, setting("grace"))
    : DEFAULT_GRACE_PERIOD_MS;

  // What the user typed on THIS command line, as opposed to what was inherited
  // from the environment or the saved file. `vibe --genre jazz` with nothing
  // after it is a request to change the default, and this is how run() tells
  // that apart from a genre that merely happens to be in effect.
  const typed = {};

  let noChime = false;
  let noHud = false;
  let preview = null;
  let render = null;
  let clearCacheFlag = false;
  let statusFlag = false;
  let stateFlag = false;
  let statuslineFlag = false;
  let whyFlag = false;
  let eventsFlag = false;
  let doctorFlag = false;
  let notifyFlag = null;
  let callsFlag = null;
  let speakFlag = null;
  let announcementsFlag = null;
  let reportDays = null;
  let cardFlag = false;
  let cardOut = null;
  let stopFlag = false;
  let muteFlag = null;
  let muteMinutes = null;
  let hookAction = null;
  let mcp = false;
  let reactive = false;
  let followVolume = false;
  let plugin = false;
  let hookEvent = null;
  let dashboardFlag = false;
  let dashboardPort = null;
  let noOpen = false;
  let announceText = null;
  let announceOutcome = null;
  let announceExit = null;
  let here_flag = false;
  let dryRun = false;
  let tools = null;
  let cmdArgs = [];

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (VALUE_FLAGS.has(arg) && i + 1 >= args.length) {
      console.error(`\x1b[31m[vibeaudio] ${arg} needs a value.\x1b[0m Run vibe --help for the options.`);
      process.exit(1);
    }

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
        typed.genre = genre;
        i += 2;
        continue;
      }
    }

    if (arg === "-v" || arg === "--volume") {
      if (i + 1 < args.length) {
        volume = normalizeVolume(args[i + 1], volume);
        typed.volume = volume;
        i += 2;
        continue;
      }
    }

    if (arg === "-cv" || arg === "--chime-volume") {
      if (i + 1 < args.length) {
        chimeVolume = normalizeVolume(args[i + 1], chimeVolume);
        typed.chimeVolume = chimeVolume;
        i += 2;
        continue;
      }
    }

    if (arg === "--grace") {
      if (i + 1 < args.length) {
        const parsed = parseInt(args[i + 1], 10);
        if (!isNaN(parsed)) {
          grace = Math.max(0, parsed);
          typed.grace = grace;
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

    // Optional filename: `--render` alone names the file after the genre.
    // Only a non-flag counts, so `vibe --render --genre zen` still parses as
    // both, the way `--mute claude` does.
    if (arg === "--render") {
      i += 1;
      if (args[i] !== undefined && !args[i].startsWith("-")) {
        render = args[i];
        i += 1;
      } else {
        render = "";
      }
      continue;
    }

    if (arg === "--clear-cache") {
      clearCacheFlag = true;
      i += 1;
      continue;
    }

    if (arg === "--status") {
      statusFlag = true;
      i += 1;
      continue;
    }

    if (arg === "--music") {
      const value = args[i + 1].toLowerCase();
      if (value !== "on" && value !== "off") {
        console.error(`\x1b[31m[vibeaudio] --music takes on or off, not '${args[i + 1]}'.\x1b[0m`);
        process.exit(1);
      }
      music = value === "on";
      typed.music = music;
      i += 2;
      continue;
    }

    if (arg === "--success-chime" || arg === "--failure-chime" || arg === "--attention-chime") {
      const kind = arg.slice(2, -"-chime".length);
      const value = args[i + 1].trim();
      // A relative path would mean a different file in every project, so it is refused, not guessed.
      if (value.toLowerCase() !== "default" && !chimefile.expandChimePath(value)) {
        console.error(`\x1b[31m[vibeaudio] ${arg} needs an absolute path (or ~/...), or 'default' - not '${value}'.\x1b[0m`);
        process.exit(1);
      }
      typed.chimes = { ...typed.chimes, [kind]: value.toLowerCase() === "default" ? null : value };
      // A flag beats the environment, and the player reads the environment, so this is what makes a one-off work.
      process.env[`VIBE_CHIME_${kind.toUpperCase()}`] = value;
      i += 2;
      continue;
    }

    if (arg === "--announce" || arg === "--outcome" || arg === "--exit-code") {
      const value = args[i + 1];
      if (arg === "--announce") announceText = value;
      else if (arg === "--outcome") {
        announceOutcome = value.toLowerCase();
        const known = require("./hooks").ANNOUNCE_OUTCOMES;
        if (!known.includes(announceOutcome)) {
          console.error(`\x1b[31m[vibeaudio] --outcome takes ${known.join(", ")}, not '${value}'.\x1b[0m`);
          process.exit(1);
        }
      } else {
        if (!/^-?\d+$/.test(value)) {
          console.error(`\x1b[31m[vibeaudio] --exit-code takes a number, not '${value}'.\x1b[0m`);
          process.exit(1);
        }
        announceExit = parseInt(value, 10);
      }
      i += 2;
      continue;
    }

    if (arg === "--dashboard" || arg === "--no-open") {
      if (arg === "--dashboard") dashboardFlag = true;
      else noOpen = true;
      i += 1;
      continue;
    }

    if (arg === "--port") {
      const n = Number(args[i + 1]);
      if (!/^\d+$/.test(args[i + 1]) || n > 65535) {
        console.error(`\x1b[31m[vibeaudio] --port takes a number from 0 to 65535, not '${args[i + 1]}'.\x1b[0m`);
        process.exit(1);
      }
      dashboardPort = n;
      i += 2;
      continue;
    }

    if (arg === "--statusline") {
      statuslineFlag = true;
      i += 1;
      continue;
    }

    if (arg === "--why") {
      whyFlag = true;
      i += 1;
      continue;
    }

    if (arg === "--state" || arg === "--events") {
      if (arg === "--state") stateFlag = true;
      else eventsFlag = true;
      i += 1;
      continue;
    }

    if (arg === "--report") {
      // Optional window in days, like --mute's minutes: `vibe --report 30`.
      i += 1;
      reportDays = 7;
      if (args[i] !== undefined && /^\d+$/.test(args[i])) {
        reportDays = Math.min(Math.max(parseInt(args[i], 10), 1), 365);
        i += 1;
      }
      continue;
    }

    if (arg === "--card") {
      cardFlag = true;
      i += 1;
      continue;
    }

    if (arg === "--out") {
      cardOut = args[i + 1];
      i += 2;
      continue;
    }

    if (arg === "--notify" || arg === "--no-notify") {
      notifyFlag = arg === "--notify";
      i += 1;
      continue;
    }

    if (arg === "--mute-on-calls" || arg === "--no-mute-on-calls") {
      callsFlag = arg === "--mute-on-calls";
      i += 1;
      continue;
    }

    if (arg === "--speak" || arg === "--speak-always" || arg === "--no-speak") {
      speakFlag = arg === "--speak" ? "auto" : arg === "--speak-always" ? "always" : "off";
      i += 1;
      continue;
    }

    if (arg === "--announcements") {
      const value = args[i + 1].toLowerCase();
      if (value !== "on" && value !== "off") {
        console.error(`\x1b[31m[vibeaudio] --announcements takes on or off, not '${args[i + 1]}'.\x1b[0m`);
        process.exit(1);
      }
      announcementsFlag = value === "on";
      i += 2;
      continue;
    }

    if (arg === "--doctor") {
      doctorFlag = true;
      i += 1;
      continue;
    }

    if (arg === "--stop") {
      stopFlag = true;
      i += 1;
      continue;
    }

    if (arg === "--mute" || arg === "--unmute") {
      muteFlag = arg === "--mute";
      i += 1;
      // Optional duration: `--mute 30`. Only a bare number counts, so
      // `vibe --mute claude` still parses as a mute plus a command.
      if (muteFlag && args[i] !== undefined && /^\d+$/.test(args[i])) {
        muteMinutes = parseInt(args[i], 10);
        i += 1;
      }
      continue;
    }

    if (arg === "--mcp") {
      mcp = true;
      i += 1;
      continue;
    }

    if (HOOK_ACTIONS.includes(arg)) {
      hookAction = arg.slice(2);
      i += 1;
      continue;
    }

    if (arg === "--here") {
      here_flag = true;
      i += 1;
      continue;
    }

    if (arg === "--reactive") {
      reactive = true;
      i += 1;
      continue;
    }

    // Internal, set by the hooks: a daemon with no volume of its own follows
    // the saved one while it plays.
    if (arg === "--follow-volume") {
      followVolume = true;
      i += 1;
      continue;
    }

    // Internal, set by the plugin's hooks.json: yield to hooks that
    // --install-hooks already wrote, so both being present is not a double chime.
    if (arg === "--plugin") {
      plugin = true;
      i += 1;
      continue;
    }

    // Internal, also the plugin's: which event this hook entry is for, so a
    // hook can ignore events the agent running it does not use that way.
    if (arg === "--event") {
      hookEvent = args[i + 1] || null;
      i += 2;
      continue;
    }

    if (arg === "--dry-run") {
      dryRun = true;
      i += 1;
      continue;
    }

    if (arg === "--tools") {
      tools = args[i + 1];
      i += 2;
      continue;
    }

    if (arg === "--whisper") {
      volume = 0.15;
      typed.volume = volume;
      i += 1;
      continue;
    }

    if (arg === "--quiet") {
      volume = 0.25;
      typed.volume = volume;
      i += 1;
      continue;
    }

    if (arg === "--loud") {
      volume = 0.75;
      typed.volume = volume;
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

    // `--` ends our flags: everything after it is the command, even if it
    // starts with a dash. The conventional escape hatch, and the reason the
    // check below can be strict.
    if (arg === "--") {
      cmdArgs = args.slice(i + 1);
      break;
    }

    // A mistyped flag used to fall through here and be spawned as a program,
    // so `vibe --typo npm test` reported `spawn --typo ENOENT` - an error
    // about the wrong thing entirely. A bare "-" is left alone; some commands
    // use it to mean stdin.
    if (arg.length > 1 && arg.startsWith("-")) {
      console.error(
        `\x1b[31m[vibeaudio] Unknown option '${arg}'.\x1b[0m Run vibe --help for the list.\n` +
        `  If you meant to run a command that starts with a dash: vibe -- ${arg} ...`
      );
      process.exit(1);
    }

    // Everything from here is the child command
    cmdArgs = args.slice(i);
    break;
  }

  if (!isKnownGenre(genre)) {
    // A typo that would be SAVED is a different thing from a typo on a run:
    // falling back to lofi here would quietly overwrite the default the user
    // already had, on the strength of a misspelling. Refuse and change nothing.
    if (typed.genre !== undefined && cmdArgs.length === 0) {
      console.error(
        `\x1b[31m[vibeaudio] Unknown genre '${genre}' — nothing saved.\x1b[0m\n` +
          `  Available: ${AVAILABLE_GENRES.join(", ")}, random`
      );
      process.exit(1);
    }
    console.error(
      `\x1b[33m[vibeaudio] Unknown genre '${genre}' — falling back to lofi.\x1b[0m\n` +
        `  Available: ${AVAILABLE_GENRES.join(", ")}, random`
    );
    genre = "lofi";
    if (typed.genre) typed.genre = "lofi";
  }

  return {
    genre,
    volume,
    chimeVolume,
    grace,
    noChime,
    noHud,
    preview,
    render,
    clearCache: clearCacheFlag,
    status: statusFlag,
    state: stateFlag,
    statusline: statuslineFlag,
    why: whyFlag,
    music,
    events: eventsFlag,
    doctor: doctorFlag,
    notify: notifyFlag,
    muteOnCalls: callsFlag,
    speak: speakFlag,
    announcements: announcementsFlag,
    report: reportDays,
    card: cardFlag,
    cardOut,
    stop: stopFlag,
    mute: muteFlag,
    muteMinutes,
    hookAction,
    mcp,
    reactive,
    followVolume,
    plugin,
    hookEvent,
    dashboard: dashboardFlag ? { port: dashboardPort, open: !noOpen } : null,
    announce: { text: announceText, outcome: announceOutcome, exitCode: announceExit },
    dryRun,
    tools,
    typed,
    hereOnly: here_flag,
    cmdArgs
  };
}



function printHelp() {
  // Both callers process.exit() next. On macOS a piped stdout is async, so Node 18/20
  // dropped everything past the 8 KB pipe buffer (CI on #77). Blocking writes flush first.
  process.stdout._handle?.setBlocking?.(true);
  console.log(`
\x1b[1m\x1b[36mVibeAudio\x1b[0m v${pkg.version}
Procedural focus music while your AI coding tools think.

\x1b[1mUSAGE:\x1b[0m
  vibe [options] <command> [args...]
  vibeaudio [options] <command> [args...]

\x1b[1mEXAMPLES:\x1b[0m
  vibe --install-hooks           \x1b[90m# best for interactive agents — music follows thinking\x1b[0m
  vibe --genre jazz --volume 25  \x1b[90m# save your default — reaches hooks, wrapper and MCP\x1b[0m
  vibe --install-hooks --tools codex   \x1b[90m# wire up one agent instead of every one found\x1b[0m
  vibe npm test                  \x1b[90m# wrap any command that exits when it's done\x1b[0m
  vibe claude -p "explain this"
  vibe --genre synthwave claude
  vibe --genre 8bit sleep 5
  vibe --volume 30 npm test
  vibe --preview jazz
  gh run watch; vibe --announce "CI finished" --exit-code $?   \x1b[90m# the chime for a CI run or a script\x1b[0m
  vibe --render                  \x1b[90m# save this repo's sound as a .wav to share\x1b[0m
  vibe --mute-on-calls           \x1b[90m# go quiet while the microphone is in use (a call), and carry on when it ends\x1b[0m
  vibe --notify                  \x1b[90m# a desktop banner naming the project when a turn finishes or needs you (macOS, Linux)\x1b[0m
  vibe --speak                   \x1b[90m# a voice names the project after the chime (--no-speak turns it off)\x1b[0m
  vibe                           \x1b[90m# menu: pick a tool and a sound (p auditions a genre); "Alerts & extras" flips banners, speech, announce, music, mute\x1b[0m

\x1b[1mOPTIONS:\x1b[0m
  -g, --genre <name>           Select genre: lofi (default), synthwave, 8bit, electronic, jazz, zen, piano, drone, rain, ocean, random
  -v, --volume <5-100>         Set playback volume (default: 40)
  -cv, --chime-volume <5-100>   Set independent completion chime volume
      --grace <ms>             Silence window before music starts, in ms (default: ${DEFAULT_GRACE_PERIOD_MS})
      --here                   With a saved setting: this directory only, not everywhere
      --seed <n>               Force a specific arrangement (default: derived from the project directory)
      --music <on|off>         off = signals only: chimes, banners and events, no music (a saved setting)
      --whisper                Preset: 15% volume (late night / headphones)
      --quiet                  Preset: 25% volume (focus / open office)
      --loud                   Preset: 75% volume (hear from across the room)
      --no-chime               Disable the resolution completion chime
      --no-hud                 Disable terminal window/tab title animation
      --preview <genre>        Play one loop of a genre and exit
      --render [file]          Write this project's music to a .wav and exit (full scale, ignores --volume)
      --status                 Say why the music is silent or playing, then show what is
                               installed, running and detected, and exit
      --mute-on-calls | --no-mute-on-calls   Pause the music while the microphone is in use by any app and resume after the call; chimes and speech wait too (off by default; macOS, Windows, Linux with pactl)
      --notify | --no-notify   Also show a desktop banner naming the project when a turn finishes, fails, needs you or looks stuck (macOS and Linux; off by default)
      --speak | --no-speak     Also say which project finished, failed or needs you, after the chime - with two or more sessions going (off by default)
      --speak-always           Like --speak, but every time, even with one session
      --success-chime <file>   Play your own sound when a turn finishes (also --failure-chime, and --attention-chime for "needs you"; WAV, 16-bit PCM, up to 3 s; 'default' restores the built-in; add --here for this project)
      --announcements <on|off> Turn vibe --announce on or off for good (a saved setting; on by default)
      --report [days]          How long you waited on agents, and where (default: 7 days)
      --card [--out <path>]    With --report: save the totals as an image (PNG on macOS, SVG anywhere) to ~/.vibeaudio/card.*, replaced each run
      --state                  Print what every agent is doing as JSON: idle, working, stuck or waiting
      --announce <text>        Play the signals for something that is not an agent (CI, a deploy, a script), then exit (spoken too when --speak is on)
      --outcome <o>            With --announce: success (default), failure or attention
      --exit-code <n>          With --announce: 0 is success, anything else failure (use $?)
      --dashboard              Serve a read-only live view of every agent on this machine, and open it
      --port <n>               With --dashboard: the port (default ${require("./dashboard").DEFAULT_PORT}, else a free one)
      --no-open                With --dashboard: do not open the browser
      --statusline             Print that as one plain line for tmux or a prompt; prints nothing when idle
      --why                    One plain line: why the music is playing or silent (the first line of --status)
      --events                 Stream agent state changes as JSON lines, until stopped
      --doctor                 Check the setup; each problem comes with its fix (exit 1 if any)
      --stop                   Stop the background player, then exit
      --mute [minutes]         Silence everything for a call (default: 60 min, 0 = until unmuted)
      --unmute                 Resume normal playback, then exit
      --clear-cache            Delete cached audio, then exit
      --mcp                    Run as Model Context Protocol (MCP) server for Desktop apps
      --install-hooks          Wire music into your agent's hooks (no wrapper needed)
      --tools <list>           With --install-hooks: claude,codex,cursor,grok,gemini,copilot,qwen,windsurf,antigravity (auto-detect)
      --reactive               With --install-hooks: intensity follows the tool in use
      --dry-run                With --install-hooks: show what would change, write nothing
      --uninstall-hooks        Remove the hooks again, from every agent
  -h, --help                   Show this help message
      --version                Show version (update with: npm i -g vibeaudio)

\x1b[1mSETTINGS:\x1b[0m
  A genre or volume with no command after it is saved as your default:

      vibe --genre zen               \x1b[90m# applies on the next prompt, nothing to reinstall\x1b[0m
      vibe --genre zen --here        \x1b[90m# this project only — the default stays as it was\x1b[0m

  Saved to ~/.vibeaudio/config.json and read by the wrapper, your agent hooks
  and the MCP server alike. A flag beats an environment variable beats a
  \x1b[1m--here\x1b[0m setting beats the global one, so a one-off
  \x1b[1mvibe --genre 8bit npm test\x1b[0m stays a one-off.

\x1b[1mINTEGRATIONS:\x1b[0m
  Every agent's state, as one stream you can build on (lights, banners, webhooks):

      vibe --events                  \x1b[90m# the current state, then one JSON line per change\x1b[0m
      vibe --state                   \x1b[90m# one snapshot: idle, working, stuck or waiting\x1b[0m
      vibe --statusline              \x1b[90m# one plain line for tmux or a prompt\x1b[0m

  Events: started, waiting, resumed, stuck, recovered, finished, interrupted, ended, announced.
  Recipes (tmux, Starship, voice, webhook, Home Assistant): https://kiril6.github.io/vibeaudio/

\x1b[1mUNINSTALL:\x1b[0m
  In this order, so no agent is left running a hook that points at nothing:

      vibe --uninstall-hooks         \x1b[90m# 1. unwire every agent, and stop any player still running\x1b[0m
      npm rm -g vibeaudio            \x1b[90m# 2. remove the CLI\x1b[0m
      rm -rf ~/.vibeaudio            \x1b[90m# 3. optional: cached audio, saved settings, state\x1b[0m

\x1b[1mENVIRONMENT:\x1b[0m
  VIBE_GENRE=<name>            Override the saved genre for this shell
  VIBE_VOLUME=<5-100>          Override the saved volume for this shell
  VIBE_CHIME_VOLUME=<5-100>    Override the saved chime volume for this shell
  VIBE_CHIME_SUCCESS=<file>    Your own done sound for this shell (VIBE_CHIME_FAILURE, VIBE_CHIME_ATTENTION)
  VIBE_GRACE_MS=<ms>           Override the saved grace window, in ms
  VIBE_MUSIC=<on|off>          Override the saved music setting for this shell
  VIBE_NOTIFY=<on|off>         Override the saved desktop-banner setting for this shell
  VIBE_SPEAK=<auto|always|off> Override the saved spoken-announcement setting for this shell
  VIBE_ANNOUNCE=<on|off>       Turn vibe --announce off for this shell
  VIBE_SEED=<n>                Pin the arrangement instead of deriving it from the directory
  VIBE_DISABLE=1               Mute automatic playback without uninstalling anything
  VIBE_NO_UPDATE_CHECK=1       Never check npm for a newer version

\x1b[1mNO SOUND?\x1b[0m
  vibe --doctor                  \x1b[90m# checks the setup; each problem comes with its fix\x1b[0m
  vibe --status                  \x1b[90m# shows whether you are muted, and what is installed\x1b[0m
  vibe --unmute                  \x1b[90m# clears a mute\x1b[0m

\x1b[1mMORE:\x1b[0m
  Settings and state: ~/.vibeaudio
  Docs: https://kiril6.github.io/vibeaudio/
  Problems and ideas: https://github.com/kiril6/vibeaudio/issues
`);
  printUpdateNotice();
}

module.exports = { DEFAULT_GRACE_PERIOD_MS, HOOK_ACTIONS, VALUE_FLAGS, parseArgs, printHelp };
