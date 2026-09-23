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
  normalizeVolume,
  loadConfig,
  saveConfig,
  projectSettings,
  saveProjectConfig,
  wavDurationMs,
  projectSeed,
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
  "--hook-wait",
  "--hook-resume",
  "--hook-end",
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
  vibe --install-hooks           \x1b[90m# best for interactive agents — music follows thinking\x1b[0m
  vibe --genre jazz --volume 25  \x1b[90m# save your default — reaches hooks, wrapper and MCP\x1b[0m
  vibe --install-hooks --tools codex   \x1b[90m# wire up one agent instead of every one found\x1b[0m
  vibe npm test                  \x1b[90m# wrap any command that exits when it's done\x1b[0m
  vibe claude -p "explain this"
  vibe --genre synthwave claude
  vibe --genre 8bit sleep 5
  vibe --volume 30 npm test
  vibe --preview jazz
  vibe --render                  \x1b[90m# save this repo's sound as a .wav to share\x1b[0m
  vibe                           \x1b[90m# menu: pick a tool and a sound (p auditions a genre)\x1b[0m

\x1b[1mOPTIONS:\x1b[0m
  -g, --genre <name>           Select genre: lofi (default), synthwave, 8bit, electronic, jazz, zen, piano, drone, random
  -v, --volume <5-100>         Set playback volume (default: 40)
  -cv, --chime-volume <5-100>   Set independent completion chime volume
      --grace <ms>             Silence window before music starts, in ms (default: ${DEFAULT_GRACE_PERIOD_MS})
      --here                   With a saved setting: this directory only, not everywhere
      --seed <n>               Force a specific arrangement (default: derived from the project directory)
      --whisper                Preset: 15% volume (late night / headphones)
      --quiet                  Preset: 25% volume (focus / open office)
      --loud                   Preset: 75% volume (hear from across the room)
      --no-chime               Disable the resolution completion chime
      --no-hud                 Disable terminal window/tab title animation
      --preview <genre>        Play one loop of a genre and exit
      --render [file]          Write this project's music to a .wav and exit
      --status                 Show what is installed, running and detected, then exit
      --stop                   Stop the background player, then exit
      --mute [minutes]         Silence everything for a call (default: 60 min, 0 = until unmuted)
      --unmute                 Resume normal playback, then exit
      --clear-cache            Delete cached audio, then exit
      --mcp                    Run as Model Context Protocol (MCP) server for Desktop apps
      --install-hooks          Wire music into your agent's hooks (no wrapper needed)
      --tools <list>           With --install-hooks: claude,codex,cursor,grok,gemini,copilot,qwen (auto-detect)
      --reactive               With --install-hooks: intensity follows the tool in use
      --dry-run                With --install-hooks: show what would change, write nothing
      --uninstall-hooks        Remove the hooks again, from every agent
  -h, --help                   Show this help message
      --version                Show version

\x1b[1mSETTINGS:\x1b[0m
  A genre or volume with no command after it is saved as your default:

      vibe --genre zen               \x1b[90m# applies on the next prompt, nothing to reinstall\x1b[0m
      vibe --genre zen --here        \x1b[90m# this project only — the default stays as it was\x1b[0m

  Saved to ~/.vibeaudio/config.json and read by the wrapper, your agent hooks
  and the MCP server alike. A flag beats an environment variable beats a
  \x1b[1m--here\x1b[0m setting beats the global one, so a one-off
  \x1b[1mvibe --genre 8bit npm test\x1b[0m stays a one-off.

\x1b[1mENVIRONMENT:\x1b[0m
  VIBE_GENRE=<name>            Override the saved genre for this shell
  VIBE_VOLUME=<5-100>          Override the saved volume for this shell
  VIBE_CHIME_VOLUME=<5-100>    Override the saved chime volume for this shell
  VIBE_GRACE_MS=<ms>           Override the saved grace window, in ms
  VIBE_SEED=<n>                Pin the arrangement instead of deriving it from the directory
  VIBE_DISABLE=1               Mute automatic playback without uninstalling anything
  VIBE_NO_UPDATE_CHECK=1       Never check npm for a newer version
`);
  printUpdateNotice();
}

// Only where a person is reading: help, status and the menu. See update.js.
function printUpdateNotice() {
  if (!process.stdout.isTTY) return;
  const { ephemeralInstallReason } = require("./hooks");
  const line = require("./update").updateNotice({ ephemeral: Boolean(ephemeralInstallReason()) });
  if (line) console.log(`${line}\n`);
}

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
  "--seed",
  "--tools"
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
  let stopFlag = false;
  let muteFlag = null;
  let muteMinutes = null;
  let hookAction = null;
  let mcp = false;
  let reactive = false;
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
    stop: stopFlag,
    mute: muteFlag,
    muteMinutes,
    hookAction,
    mcp,
    reactive,
    dryRun,
    tools,
    typed,
    hereOnly: here_flag,
    cmdArgs
  };
}

const { promptInteractive } = require("./interactive");
const { TerminalHud } = require("./hud");

/**
 * Which agents to wire up. Auto-detection is the default because the honest
 * answer to "which of these do I have" lives on the user's disk, not in a
 * flag they have to know to pass; --tools is the override.
 */
function resolveTargets(explicit) {
  const hooks = require("./hooks");
  const known = Object.keys(hooks.TARGETS);

  // Absent is null; anything else was typed, empty string included. Testing
  // truthiness instead let `--tools ""` fall through to auto-detection and
  // install for every agent on the machine - the opposite of naming one.
  if (explicit !== null && explicit !== undefined) {
    const ids = explicit.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    // `--tools ""` or `--tools ,` names nothing, and silently installing
    // everywhere - or reporting success over an empty loop - is worse than
    // saying so.
    if (!ids.length) throw new Error(`--tools named no agent — expected one of: ${known.join(", ")}`);
    const bad = ids.filter((id) => !known.includes(id));
    if (bad.length) throw new Error(`unknown --tools value '${bad.join(", ")}' — expected: ${known.join(", ")}`);
    return ids;
  }

  const found = hooks.detectTargets();
  if (!found.length) {
    throw new Error(
      `no agent with a hook system found on this machine (looked for ${known.join(", ")}).\n` +
      `  Wrap the command instead: vibe <your-command>`
    );
  }
  return found;
}

/**
 * The one install path. Both --install-hooks and the menu's hooks branch call
 * this, so the two entry points can't drift in what they write or report.
 */
function installHookTargets(ids, genre, volume, reactive, dryRun = false, typed = {}) {
  const hooks = require("./hooks");

  // Migrating off a pinned install must not change what is playing: those
  // entries carry the settings the user has actually been hearing, while the
  // config file may not exist yet - so an untyped reinstall inherits from the
  // entries it is about to replace.
  //
  // A pin fills a gap and never overrides. Once a setting is saved, somebody
  // chose it, and a legacy pin left in some other agent's config is the older
  // fact of the two - without this, installing for every detected agent lets
  // four untouched installs outvote the genre the user picked a minute ago.
  const saved = loadConfig();
  const inherited = [];
  const gap = (key) => typed[key] === undefined && saved[key] === undefined;

  if (gap("genre") || gap("volume")) {
    const pinned = pinnedSettingsFor(ids);
    if (gap("genre") && pinned.genre && pinned.genre !== genre) {
      genre = pinned.genre;
      inherited.push(`genre ${genre}`);
    }
    if (gap("volume") && pinned.volume !== null && pinned.volume !== volume) {
      volume = pinned.volume;
      inherited.push(`volume ${Math.round(volume * 100)}%`);
    }
  }

  if (dryRun) console.log(`\x1b[1mDry run\x1b[0m — nothing below is written.\n`);
  if (inherited.length) {
    console.log(`\x1b[90mKeeping your current ${inherited.join(" and ")} — pass --genre/--volume to change it.\x1b[0m`);
  }

  // The hook entries no longer carry the genre and volume, so this is where
  // they live. Saved here rather than inside installHooks(), which stays a
  // pure config edit that tests can point at a throwaway file - the same
  // reason the slash command and stopDaemon() are driven from this layer.
  if (!dryRun) saveConfig({ genre, volume: Math.round(volume * 100) });

  for (const id of ids) {
    const result = hooks.installHooks(genre, volume, null, { reactive, id, dryRun });
    const { file, backup, name, note, events } = result;

    if (dryRun) {
      printHookPlan(result, hooks.TARGETS[id]);
    } else {
      console.log(`\x1b[32m✔ ${name} hooks installed in ${file}\x1b[0m`);
      if (backup) console.log(`  Previous config backed up to ${backup}`);
    }
    console.log(`  ${events.start.padEnd(19)}→ music starts (${genre} @ ${Math.round(volume * 100)}%)`);
    console.log(`  ${events.stop.padEnd(19)}→ music stops + success chime`);
    if (reactive) {
      console.log(`  ${events.tool.padEnd(19)}→ intensity follows the tool in use (reactive mode)`);
    }
    if (events.wait) console.log(`  ${events.wait[0].padEnd(19)}→ music pauses + "your turn" chime`);
    if (events.resume) console.log(`  ${events.resume[0].padEnd(19)}→ music resumes once you've answered`);
    if (events.failure) console.log(`  ${events.failure.padEnd(19)}→ music stops + failure chime (API error)`);
    if (events.end) console.log(`  ${events.end.padEnd(19)}→ music stops if that session started it`);

    if (id === "claude") {
      const slash = hooks.installSlashCommand({ dryRun });
      if (!slash.installed) console.log(`  \x1b[33m/vibe not installed: ${slash.reason} (${slash.file})\x1b[0m`);
      else console.log(`  ${"/vibe".padEnd(19)}→ ${dryRun ? "would write" : "control the music from inside Claude Code"} (${slash.file})`);
    }
    // Codex will not run a hook it has not been told to trust, so saying
    // "done" without this would be reporting an install that isn't live yet.
    if (note) console.log(`  \x1b[33m${note}\x1b[0m`);
  }

  if (dryRun) {
    console.log(`\n  Run again without --dry-run to apply.\n`);
    return;
  }
  // These re-read their hook file per event rather than caching it at startup,
  // verified for each, so an open session picks this up on its next prompt.
  const live = ids.filter((id) => hooks.TARGETS[id].liveReload !== false).map((id) => hooks.TARGETS[id].name);
  if (live.length) console.log(`  ${live.join(", ")}: takes effect on your next prompt - no restart needed.`);
  console.log(`  \x1b[90mChange the sound any time with: vibe --genre <name> --volume <n> — no reinstall.\x1b[0m`);
  if (ids.length > 1) {
    console.log(`  \x1b[90mOne player is shared: whichever agent you prompt last owns the music.\x1b[0m`);
  }
  console.log(`  Remove them any time with: vibe --uninstall-hooks\n`);
}

/**
 * What --dry-run shows: for each event, whether our entry would be added,
 * changed, left as it is or removed - read from the file as it is now against
 * the result installHooks computed, so the preview cannot drift from the write.
 */
function printHookPlan({ file, backup, name, before, after, id }, t) {
  const hooks = require("./hooks");
  const ours = (text) => {
    const map = new Map();
    if (!text) return map;
    for (const [event, entries] of hooks.hookEntries(JSON.parse(text).hooks, t)) {
      const mine = entries.filter((e) => hooks.isVibeHook(e, id));
      if (mine.length) map.set(event, JSON.stringify(mine));
    }
    return map;
  };
  const was = ours(before);
  const will = ours(after);

  console.log(`\x1b[1m${name}\x1b[0m — would ${before === null ? "create" : "edit"} ${file}`);
  if (backup) console.log(`  would back up the current file to ${backup}`);
  for (const event of new Set([...was.keys(), ...will.keys()])) {
    const mark = !was.has(event) ? "\x1b[32m+ add   \x1b[0m"
      : !will.has(event) ? "\x1b[31m- remove\x1b[0m"
      : was.get(event) === will.get(event) ? "\x1b[90m= same  \x1b[0m" : "\x1b[33m~ change\x1b[0m";
    console.log(`  ${mark} ${event}`);
  }
  if (before !== null) console.log(`  \x1b[90mEverything else in the file stays as it is.\x1b[0m`);
}

/**
 * Sweeps every target, not just the detected ones - a hook left behind in a
 * config file of a tool that has since been removed is exactly the thing an
 * uninstall is supposed to clear.
 */
function uninstallHookTargets() {
  const hooks = require("./hooks");
  let total = 0;

  for (const id of Object.keys(hooks.TARGETS)) {
    const { file, removed } = hooks.uninstallHooks(null, { id });
    total += removed;
    if (removed > 0) {
      console.log(`\x1b[32m✔ Removed ${removed} VibeAudio hook(s) from ${file}\x1b[0m`);
      const backupFile = `${file}.vibeaudio.bak`;
      // The backup is the user's safety net, so point at it rather than
      // deleting it for them - but only when one actually exists.
      if (fs.existsSync(backupFile)) {
        console.log(`  Your pre-VibeAudio config backup is kept at ${backupFile}`);
      }
    }
  }

  if (hooks.uninstallSlashCommand()) console.log(`\x1b[32m✔ Removed the /vibe command from Claude Code\x1b[0m`);
  if (total === 0) console.log(`\x1b[90mNo VibeAudio hooks were installed.\x1b[0m`);

  // Nothing will ever send a stop event once the hooks are gone, so a daemon
  // left running would play on unsupervised until its 15-minute cap - and
  // `npm rm -g` right after this would take away the only thing that could
  // stop it. Done here rather than in uninstallHooks() so that function stays
  // a pure config edit for tests.
  if (hooks.stopDaemon()) console.log(`  Stopped the background player that was still running.`);
}

/**
 * One place to answer "why am I hearing nothing / what is this configured to
 * do". Every line is read from live state rather than assumed, because the
 * usual cause of confusion is a mismatch between config and what is running.
 */
function printStatus() {
  const hooks = require("./hooks");
  const { playbackDisabled, detectPlayer: detect, CACHE_ROOT } = require("./player");
  const on = (s) => `\x1b[32m${s}\x1b[0m`;
  const off = (s) => `\x1b[90m${s}\x1b[0m`;

  console.log(`\n\x1b[1m\x1b[36mVibeAudio\x1b[0m v${pkg.version}\n`);

  const { muteState, muteRemainingText } = require("./player");
  const mute = muteState();
  if (mute !== null) {
    console.log(`\x1b[33m🔇 Muted ${muteRemainingText(mute)}\x1b[0m \x1b[90m(since ${mute.since})\x1b[0m\n`);
  } else if (playbackDisabled()) {
    console.log(`\x1b[33m⏸ Muted by VIBE_DISABLE=${process.env.VIBE_DISABLE}\x1b[0m — automatic playback is off (--preview still works).\n`);
  }

  // What will actually play, and which of the three possible sources decided
  // it - the usual confusion is a saved default quietly beaten by an export.
  const saved = loadConfig();
  const here = projectSettings(saved);
  const source = (env, key) =>
    process.env[env] ? off(`  from ${env}`)
      : here[key] !== undefined ? off("  saved for this project")
      : saved[key] !== undefined ? off("  saved")
      : off("  default");

  console.log(`\x1b[1mSound\x1b[0m`);
  console.log(`  genre     ${on(genreNow())}${source("VIBE_GENRE", "genre")}`);
  console.log(`  volume    ${on(`${Math.round(volumeNow() * 100)}%`)}${source("VIBE_VOLUME", "volume")}`);
  console.log(`            ${off("change either with: vibe --genre <name> --volume <n>")}`);

  // Audio backend
  const backend = detect();
  console.log(`\n\x1b[1mAudio\x1b[0m`);
  console.log(backend
    ? `  player    ${on(backend.cmd)}${backend.volume ? "" : off("  (no volume support — gain is baked into the file)")}`
    : `  player    \x1b[31mnone found — VibeAudio runs silently\x1b[0m`);
  console.log(`  cache     ${dirSize(CACHE_ROOT)}`);

  // Hooks, per agent that has them
  console.log(`\n\x1b[1mHooks\x1b[0m`);
  const detected = hooks.detectTargets();
  const hooked = new Set();
  for (const id of Object.keys(hooks.TARGETS)) {
    const t = hooks.TARGETS[id];
    const installed = readVibeHooks(t.file(), t);
    if (installed.length) hooked.add(id);

    if (!installed.length) {
      // "not on this machine" alone is a dead end for someone who has the tool
      // but has never launched it, so every line still says "not installed"
      // and only the reason for skipping it varies.
      const why = detected.includes(id)
        ? `${off("not installed")} — run: vibe --install-hooks`
        : `${off("not installed")} ${off("(not found on this machine)")}`;
      console.log(`  ${t.name.padEnd(20)}${why}`);
      continue;
    }

    console.log(`  ${t.name}`);
    for (const { event, command } of installed) {
      // A baked genre means an install from before settings moved into the
      // config file: worth showing, because it still overrides that file.
      const g = /--genre (\S+)/.exec(command);
      const vol = /--volume (\d+)/.exec(command);
      const parts = [];
      if (g) parts.push(`pinned ${g[1]} @ ${vol ? vol[1] : "?"}%`);
      if (/--reactive/.test(command)) parts.push("reactive");
      const extra = parts.length ? `  ${parts.join(", ")}` : "";
      console.log(`    ${on("✔")} ${extra ? event.padEnd(19) : event}${extra ? off(extra) : ""}`);
    }
    if (readVibeHooks(t.file(), t).some(({ command }) => /--genre /.test(command))) {
      console.log(`    \x1b[33m↑ pinned by an older install — vibe --install-hooks makes it follow Sound above\x1b[0m`);
    }
  }

  // Background player
  console.log(`\n\x1b[1mBackground player\x1b[0m`);
  const pid = readDaemonPid(hooks.PID_FILE);
  const playing = hooks.daemonPlaying();
  if (pid === null) {
    console.log(`  ${off("not running")}`);
  } else if (!playing) {
    console.log(`  ${off(`stale pid file (${pid} is not ours) — cleared on the next prompt`)}`);
  } else {
    // What it was started with, which is not necessarily what is saved: a
    // daemon keeps its settings until the next prompt replaces it, and
    // "I changed the genre and nothing happened" is that gap.
    const now = playing.genre
      ? ` ${on(playing.genre)}${playing.volume === null ? "" : on(` @ ${playing.volume}%`)}${playing.reactive ? off(", reactive") : ""}`
      : "";
    console.log(`  ${on("playing")}${now}${off(`   pid ${pid}`)}`);
    if (playing.genre && playing.genre !== genreNow()) {
      console.log(`  ${off(`your saved default is ${genreNow()} — this one keeps playing until the next prompt`)}`);
    }
    console.log(`  ${off("stop it with: vibe --stop")}`);
  }

  // Which tools are actually here, and what each one can use
  console.log(`\n\x1b[1mAI tools found\x1b[0m`);
  const found = detectAiTools(hooked);
  if (!found.length) {
    console.log(`  ${off("none on PATH — the wrapper still runs any command")}`);
  } else {
    for (const tool of found) {
      console.log(`  ${on("✔")} ${tool.name.padEnd(20)}${off(tool.integration)}`);
    }
  }
  console.log();
  printUpdateNotice();
}

/**
 * The effective genre and volume, resolved the same way parseArgs does it, so
 * --status reports what would actually play rather than a second opinion.
 */
function settingNow(key) {
  const config = loadConfig();
  const here = projectSettings(config);
  return here[key] !== undefined ? here[key] : config[key];
}

function genreNow() {
  return (process.env.VIBE_GENRE || settingNow("genre") || "lofi").toLowerCase();
}

function volumeNow() {
  return normalizeVolume(process.env.VIBE_VOLUME, normalizeVolume(settingNow("volume"), 0.40));
}

function dirSize(dir) {
  try {
    let total = 0;
    const walk = (d) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else total += fs.statSync(full).size;
      }
    };
    walk(dir);
    return `${(total / 1024 / 1024).toFixed(1)} MB in ${dir}`;
  } catch (e) {
    return "empty";
  }
}

function readVibeHooks(file, t = null) {
  const commands = t ? t.commands : (entry) => (entry.hooks || []).map((h) => h.command);
  const { VIBE_HOOK_FLAG } = require("./hooks");
  try {
    const settings = JSON.parse(fs.readFileSync(file, "utf8"));
    const out = [];
    for (const [event, entries] of Object.entries(settings.hooks || {})) {
      for (const entry of entries || []) {
        for (const command of commands(entry)) {
          if (VIBE_HOOK_FLAG.test(command || "")) out.push({ event, command });
        }
      }
    }
    return out;
  } catch (e) {
    return [];
  }
}

function readDaemonPid(file) {
  try {
    const pid = parseInt(fs.readFileSync(file, "utf8").trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch (e) {
    return null;
  }
}

/**
 * What is on this machine, and which integration each one can actually use -
 * so the answer to "will this work with my tool" is read off the user's own
 * PATH instead of a table in the README that ages.
 */
function detectAiTools(hooked = new Set()) {
  const viaHooks = (id) => (hooked.has(id) ? "hooks — installed" : "hooks — run: vibe --install-hooks");
  // Every hook target belongs here, or "AI tools found" contradicts the Hooks
  // section directly above it - which is what a Grok user saw: their hooks
  // listed as installed, and no tools found on the machine.
  const CANDIDATES = [
    { cmd: "claude", name: "Claude Code", integration: viaHooks("claude") },
    { cmd: "codex", name: "Codex", integration: viaHooks("codex") },
    { cmd: "cursor-agent", name: "Cursor", integration: viaHooks("cursor") },
    { cmd: "grok", name: "Grok", integration: viaHooks("grok") },
    { cmd: "gemini", name: "Gemini CLI", integration: viaHooks("gemini") },
    { cmd: "copilot", name: "GitHub Copilot CLI", integration: viaHooks("copilot") },
    { cmd: "qwen", name: "Qwen Code", integration: viaHooks("qwen") },
    { cmd: "aider", name: "Aider", integration: "wrapper — vibe aider" },
    { cmd: "ollama", name: "Ollama", integration: "wrapper — vibe ollama run <model>" }
  ];
  const { isInstalled } = require("./interactive");
  return CANDIDATES.filter((c) => isInstalled(c.cmd));
}

/**
 * `vibe --genre jazz` with no command after it. That used to open the launcher
 * menu, which then asked for a genre and used its own answer - the most
 * natural way to phrase the request did something else entirely, and the
 * README had to warn about it. It saves the default instead.
 */
function saveDefaults(typed, hereOnly = false) {
  const patch = {};
  if (typed.genre !== undefined) patch.genre = typed.genre;
  if (typed.volume !== undefined) patch.volume = Math.round(typed.volume * 100);
  if (typed.chimeVolume !== undefined) patch.chimeVolume = Math.round(typed.chimeVolume * 100);
  if (typed.grace !== undefined) patch.grace = typed.grace;

  const { CONFIG_FILE } = require("./player");
  if (hereOnly) saveProjectConfig(patch);
  else saveConfig(patch);

  const label = {
    genre: (v) => `genre ${v}`,
    volume: (v) => `volume ${v}%`,
    chimeVolume: (v) => `chime volume ${v}%`,
    grace: (v) => `grace ${v}ms`
  };
  const changed = Object.keys(patch).map((k) => label[k](patch[k])).join(", ");
  const where = hereOnly ? ` for ${process.cwd()}` : "";
  console.log(`\x1b[32m✔ Saved: ${changed}${where}\x1b[0m \x1b[90m(${CONFIG_FILE})\x1b[0m`);
  console.log(`  Applies to the wrapper, your agent hooks and MCP — on the next prompt.`);
  if (hereOnly) console.log(`  \x1b[90mThis directory and everything under it. Drop --here to change the default everywhere.\x1b[0m`);

  // Music already in the air is the one thing this does not reach, and
  // silence about it reads as the setting having done nothing at all.
  const playing = require("./hooks").daemonPlaying();
  if (playing && patch.genre && playing.genre && playing.genre !== patch.genre) {
    console.log(`  \x1b[90m${playing.genre} is still playing — vibe --stop cuts it short.\x1b[0m`);
  }

  // An install from before the settings moved out of the hook command line
  // still carries its own genre, and a flag beats this file. Saying nothing
  // would leave the user with a saved default that audibly does nothing.
  const pinned = pinnedHookSettings();
  if (pinned.length) {
    console.log(
      `\n\x1b[33m  ${pinned.join(", ")}: hooks installed by an older version pin their own settings.\x1b[0m\n` +
      `  Run \x1b[1mvibe --install-hooks\x1b[0m once to have them follow this file instead.`
    );
  }
  if (typed.genre !== undefined) console.log(`\n  Audition it: vibe --preview ${typed.genre}`);
  console.log();
}

/**
 * Hook targets whose installed entries still carry a baked --genre/--volume.
 */
/**
 * What an install from before the config file pinned, for the first of `ids`
 * that pinned anything.
 *
 * A reinstall is how a user moves off that older scheme, and it must not be
 * the moment their music changes: the settings frozen into those entries are
 * the ones they have actually been listening to, and the config file may hold
 * nothing but an untouched default. Adopted only for what the user did not
 * type on this command line - naming a genre still means that genre.
 */
function pinnedSettingsFor(ids) {
  const hooks = require("./hooks");
  const genres = new Set();
  const volumes = new Set();

  for (const id of ids) {
    const t = hooks.TARGETS[id];
    if (!t) continue;
    for (const { command } of readVibeHooks(t.file(), t)) {
      const genre = /--genre (\S+)/.exec(command);
      const volume = /--volume (\d+)/.exec(command);
      if (genre && isKnownGenre(genre[1])) genres.add(genre[1]);
      if (volume) volumes.add(normalizeVolume(volume[1], null));
    }
  }

  // Only when they agree. The saved config is one value for the machine, so
  // two agents pinned to different genres have no single answer to inherit -
  // and taking whichever was found first would let an untouched install for
  // some other tool silently overwrite the genre the user actually chose.
  return {
    genre: genres.size === 1 ? [...genres][0] : null,
    volume: volumes.size === 1 ? [...volumes][0] : null
  };
}

function pinnedHookSettings() {
  const hooks = require("./hooks");
  const names = [];
  for (const id of Object.keys(hooks.TARGETS)) {
    const t = hooks.TARGETS[id];
    if (readVibeHooks(t.file(), t).some(({ command }) => /--genre |--volume /.test(command))) {
      names.push(t.name);
    }
  }
  return names;
}

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

/**
 * Writes this project's music to a file, so the thing that is actually
 * distinctive about VibeAudio - that a repo has its own arrangement - is
 * something a user can hear outside their own terminal, and send to someone.
 *
 * Rendered at full scale rather than at the configured volume: a file is
 * played by something with its own volume control, and a quiet render is not
 * recoverable. WAV because it needs no encoder on any platform; it is large,
 * and the caller can compress it with whatever they already have.
 */
function renderToFile(target, genre) {
  if (!isKnownGenre(genre)) {
    console.error(`\x1b[31m[vibeaudio] Unknown genre '${genre}'.\x1b[0m Available: ${AVAILABLE_GENRES.join(", ")}, random`);
    process.exit(1);
  }

  const { renderPiece } = require("./render");
  const resolved = resolveGenre(genre);
  const seed = projectSeed();
  const file = path.resolve(target || `vibeaudio-${resolved}.wav`);

  process.stdout.write(`\x1b[36m♫ Rendering \x1b[1m${resolved}\x1b[0m\x1b[36m for ${path.basename(process.cwd())}…\x1b[0m`);
  const piece = renderPiece({ genre: resolved, seed });
  fs.writeFileSync(file, piece.wav);

  const seconds = (piece.durationMs / 1000).toFixed(0);
  const mb = (piece.wav.length / 1024 / 1024).toFixed(1);
  console.log(`\r\x1b[32m✔ Wrote ${file}\x1b[0m\x1b[K`);
  console.log(`  \x1b[90m${seconds}s, ${mb} MB — all three tiers and the success chime, seed ${seed >>> 0}.\x1b[0m`);
  console.log(`  \x1b[90mAnother project's sound: run it there, or vibe --seed <n> --render.\x1b[0m\n`);
}

function runHookAction(action, { genre, volume, chimeVolume, noChime, reactive, tools, dryRun, typed = {} }) {
  const hooks = require("./hooks");

  switch (action) {
    case "daemon":
      return hooks.runDaemon(genre, volume, { reactive });

    case "hook-start":
      // The payload names the session (so SessionEnd can tell this session's
      // music from another's) and the transcript (so an interrupt, which
      // fires no hook, can still stop it).
      hooks.readPayload((raw) => hooks.hookStart(genre, volume, { reactive, turn: hooks.newTurn(raw) }));
      return;

    case "hook-stop":
      // Cursor's stop payload says how the turn ended; the others say nothing
      // and fall back to success. Reading it is what lets the failure chime
      // ever play under hooks - it was hardcoded to success before.
      hooks.readPayload((raw) => {
        hooks.hookStop({
          outcome: hooks.outcomeFromPayload(raw),
          volume,
          chimeVolume,
          noChime,
          raw
        });
      });
      return;

    case "hook-tool":
      return hooks.hookTool();

    case "hook-wait":
      hooks.readPayload((raw) => hooks.hookWait(raw, { volume, chimeVolume, noChime }));
      return;

    case "hook-resume":
      hooks.readPayload((raw) => hooks.hookResume(raw, genre, volume, { reactive }));
      return;

    case "hook-end":
      hooks.readPayload((raw) => hooks.hookEnd(raw));
      return;

    case "install-hooks":
      return installHookTargets(resolveTargets(tools), genre, volume, reactive, dryRun, typed);

    case "uninstall-hooks":
      return uninstallHookTargets();
  }
}

/**
 * Which hook target a wrapped command belongs to, if any - `vibe codex` and
 * `vibe claude` are the cases where something other than the wrapper may
 * already be driving the music.
 */
function hookTargetFor(cmdArgs) {
  const hooks = require("./hooks");
  const base = path.basename(cmdArgs[0] || "");
  return Object.keys(hooks.TARGETS).find((id) => hooks.TARGETS[id].cmd === base) || null;
}

/**
 * An agent that fires our hooks itself would get a second stream layered over
 * the hook daemon's if we wrapped it - and the wrapper's stream is the wrong
 * one: it times the REPL's whole session rather than the model's thinking, so
 * it never stops while you read or type.
 */
function hooksAlreadyCover(cmdArgs, settingsFile = null) {
  const id = hookTargetFor(cmdArgs);
  if (!id) return false;

  try {
    const hooks = require("./hooks");
    const file = settingsFile || hooks.TARGETS[id].file();
    if (!fs.existsSync(file)) return false;

    const settings = JSON.parse(fs.readFileSync(file, "utf8"));
    return Object.values(settings.hooks || {}).some((entries) =>
      // Not `.some(hooks.isVibeHook)` - Array.some would pass the index as the
      // target id and every lookup would throw.
      (entries || []).some((entry) => hooks.isVibeHook(entry, id))
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

  // `claude -p` and `codex exec` exit when their work does, so the wrapper is
  // right there. An interactive session is the case where process lifetime
  // isn't thinking time.
  const interactiveAgent =
    hookTargetFor(cmdArgs) !== null &&
    !cmdArgs.slice(1).some((a) => a === "-p" || a === "--print" || a === "exec");

  if (hookDriven) {
    console.error(
      "\x1b[90m[vibeaudio] Hooks are installed for this agent — letting them drive the music, " +
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

    if (hud) hud.stop({ outcome, code, interrupted, chimed: shouldChime });
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
  const {
    genre,
    volume,
    chimeVolume,
    grace,
    noChime,
    noHud,
    preview,
    render,
    clearCache: shouldClear,
    status: showStatus,
    stop: shouldStop,
    mute: muteChange,
    muteMinutes,
    hookAction,
    mcp,
    reactive,
    dryRun,
    tools,
    typed,
    hereOnly,
    cmdArgs
  } = parseArgs(process.argv);

  // Parsed as a flag rather than matched anywhere in argv: the loop stops at
  // the first non-flag, so a `--mcp` belonging to the wrapped command
  // (`vibe npm test -- --mcp`) stays the child's and does not start a server.
  if (mcp) {
    const { startMcpServer } = require("./mcp");
    return startMcpServer();
  }

  if (hookAction) {
    try {
      return runHookAction(hookAction, { genre, volume, chimeVolume, noChime, reactive, tools, dryRun, typed });
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

  if (muteChange !== null) {
    const { setMuted, muteRemainingText, DEFAULT_MUTE_MINUTES } = require("./player");

    if (!muteChange) {
      setMuted(false);
      console.log(`\x1b[32m🔊 Unmuted.\x1b[0m Music returns on your next prompt.\n`);
      return;
    }

    const minutes = muteMinutes === null ? DEFAULT_MUTE_MINUTES : muteMinutes;
    const state = setMuted(true, minutes);
    // Muting has to silence what is playing right now, not just the next
    // prompt - the whole point is that a call is already ringing.
    const stopped = require("./hooks").stopDaemon();

    console.log(`\x1b[33m🔇 Muted ${muteRemainingText(state)}.\x1b[0m`);
    if (stopped) console.log(`  Stopped the player that was running.`);
    console.log(`  Hooks and settings are untouched. Ending it early: vibe --unmute`);
    if (minutes > 0) console.log(`  \x1b[90mLonger call? vibe --mute 120 — or vibe --mute 0 to stay off until you say otherwise.\x1b[0m`);
    console.log();
    return;
  }

  if (shouldStop) {
    const hooks = require("./hooks");
    const stopped = hooks.stopDaemon();
    console.log(
      stopped
        ? "\x1b[32m✔ Stopped the background player.\x1b[0m"
        : "\x1b[90mNothing was playing.\x1b[0m"
    );
    return;
  }

  if (showStatus) {
    return printStatus();
  }

  if (shouldClear) {
    console.log(`\x1b[32m[vibeaudio] Cleared cache at ${clearCache()}\x1b[0m`);
    return;
  }

  if (preview) {
    return previewGenre(preview, volume);
  }

  if (render !== null) {
    return renderToFile(render, genre);
  }

  // Settings typed with no command to run: save them, don't open the launcher.
  if (cmdArgs.length === 0 && Object.keys(typed).length > 0) {
    return saveDefaults(typed, hereOnly);
  }

  if (hereOnly) {
    console.error("\x1b[33m[vibeaudio] --here only applies when saving a setting; ignoring it.\x1b[0m");
  }

  if (cmdArgs.length === 0) {
    if (!process.stdin.isTTY) {
      printHelp();
      process.exit(1);
    }

    // Only the menu itself exits quietly - abandoning it is a normal way to
    // leave. Wrapping the launch too turned every real failure below into a
    // silent exit 0, which is the worst possible thing for a wrapper to do:
    // `vibe && deploy` would chain on a run that never happened.
    printUpdateNotice();

    let selection;
    try {
      selection = await promptInteractive({
        // Answered per target, once the menu knows which tool was picked -
        // hooksAlreadyCover takes an argv, and TARGETS holds each one's CLI.
        hooksInstalledFor: (id) => hooksAlreadyCover([require("./hooks").TARGETS[id].cmd])
      });
    } catch (e) {
      process.exit(0);
    }

    const chosenVol = selection.volume !== undefined ? selection.volume : volume;

    if (selection.installHooks) {
      // The install can refuse (npx checkout) or abort (malformed settings).
      // Either way, say so and still launch the tool the user asked for -
      // they came here to start an agent, not to configure one.
      try {
        installHookTargets([selection.hookTarget], selection.genre, chosenVol, selection.reactive, false,
          { genre: selection.genre, volume: chosenVol });
      } catch (err) {
        console.error(`\x1b[31m[vibeaudio] ${err.message}\x1b[0m`);
      }
    }

    return executeCommand(selection.cmd, selection.genre, chosenVol, chimeVolume, grace, noChime, noHud);
  }

  executeCommand(cmdArgs, genre, volume, chimeVolume, grace, noChime, noHud);
}

module.exports = { run, parseArgs, hooksAlreadyCover };
