/** The run loop: wrapper (executeCommand), hook actions, previews, menu selection. */

const os = require("os");
const fs = require("fs");
const path = require("path");
const pkg = require("../package.json");
const { spawn, spawnSync } = require("child_process");

const { AudioPlayer, getAudioPath, clearCache, detectPlayer, bakedGain, resolveGenre, isKnownGenre, loadConfig, saveConfig, wavDurationMs, projectSeed, AVAILABLE_GENRES, muteOnCalls, onCall } = require("./player");

const { promptInteractive } = require("./interactive");

const { TerminalHud } = require("./hud");

const { DEFAULT_GRACE_PERIOD_MS, parseArgs, printHelp } = require("./cli-args");

const { resolveTargets, installHookTargets, uninstallHookTargets } = require("./cli-install");

const { musicFacts, printStatus, printReport, printCard, printDoctor, volumeNow, printUpdateNotice } = require("./cli-status");
const { saveDefaults } = require("./cli-settings");


function signalExitCode(signal) {
  return 128 + (os.constants.signals[signal] || 0);
}

function previewAudioFile(genre, volume, backend) {
  return getAudioPath(
    resolveGenre(genre),
    2,
    projectSeed(),
    bakedGain(backend, volume)
  );
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
  const audioFile = previewAudioFile(resolved, volume, backend);
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

function runHookAction(action, { music = true, genre, volume, chimeVolume, noChime, reactive, followVolume, plugin, hookEvent = null, tools, dryRun, typed = {} }) {
  const hooks = require("./hooks");

  if (plugin && action.startsWith("hook-")) {
    // One plugin, four agents (PLUGIN_AGENTS). Each check is against the
    // agent actually running this hook, never Claude Code's by default.
    const agent = hooks.pluginAgent();
    // The plugin's hooks and --install-hooks' hooks are the same events: with
    // both present every prompt would restart the music and every turn chime
    // twice. The installed ones win because they carry the user's --reactive.
    if (hooks.userHooksInstalled(null, agent)) return;
    // The plugin's file carries every agent's events; this one may not use
    // this event this way. Copilot fires PermissionRequest before every
    // permission check, dialog or not, so taking it as a wait there would
    // pause the music on every tool call.
    if (hookEvent && !hooks.expectedEvents(agent).includes(hookEvent)) return;
  }

  switch (action) {
    case "daemon":
      return hooks.runDaemon(genre, volume, { reactive, volumeSource: followVolume ? volumeNow : null });

    case "hook-start":
      // The payload names the session (so SessionEnd can tell this session's
      // music from another's) and the transcript (so an interrupt, which
      // fires no hook, can still stop it).
      hooks.readPayload((raw) => hooks.hookStart(genre, volume, { music, reactive, follow: typed.volume === undefined, turn: hooks.newTurn(raw) }));
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
          genre,
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
      hooks.readPayload((raw) => hooks.hookResume(raw, genre, volume, { music, reactive, follow: typed.volume === undefined, chimeVolume, noChime }));
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
    return Object.values(hooks.hooksOf(settings, hooks.TARGETS[id]) || {}).some((entries) =>
      // Not `.some(hooks.isVibeHook)` - Array.some would pass the index as the
      // target id and every lookup would throw.
      (entries || []).some((entry) => hooks.isVibeHook(entry, id))
    );
  } catch (e) {
    // Unreadable settings are the hook installer's problem to report, not ours.
    return false;
  }
}

/**
 * Windows needs a shell for .cmd/.bat wrappers and for bare commands that may
 * resolve to one (npm, npx, etc). Real executables and explicit paths should
 * be spawned directly: cmd.exe otherwise breaks paths containing spaces.
 */
function windowsCommandNeedsShell(command) {
  const ext = path.extname(command).toLowerCase();

  if (ext === ".cmd" || ext === ".bat") return true;
  if (ext) return false;

  return !/[\\/]/.test(command);
}

function openBrowser(url) {
  const { spawn } = require("child_process");
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]]
    : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref(); // no browser to open is not an error
  } catch (e) { /* same */ }
}

function executeCommand(cmdArgs, genre, volume, chimeVolume, grace = DEFAULT_GRACE_PERIOD_MS, noChime, noHud = false, music = true) {
  const player = new AudioPlayer();
  const hookDriven = hooksAlreadyCover(cmdArgs);
  const hud = !noHud && !hookDriven && music ? new TerminalHud(genre) : null;
  const startTime = Date.now();
  let musicStarted = false;
  let finished = false;
  // --mute-on-calls: the wrapper has no daemon to wait out a call, so it polls
  // itself. Only a pause *we* made is undone, never a mute.
  let pausedForCall = false;
  let callPoll = null;
  const watchCall = () => {
    const call = onCall();
    if (call && !pausedForCall) {
      pausedForCall = true;
      player.stop({ playChime: false });
    } else if (!call && pausedForCall) {
      pausedForCall = false;
      player.start(genre, volume);
    }
  };

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
    musicStarted = true; // Set with music off too: the chime marks the end of a run that outlasted the grace window.
    if (music) {
      pausedForCall = onCall();
      if (!pausedForCall) player.start(genre, volume);
      if (muteOnCalls()) {
        callPoll = setInterval(watchCall, 1000);
        callPoll.unref();
      }
    }
    if (hud) hud.start();
  }, grace);

  const command = cmdArgs[0];
  const commandArgs = cmdArgs.slice(1);

  const child = spawn(command, commandArgs, {
    stdio: "inherit",
    shell: process.platform === "win32" && windowsCommandNeedsShell(command)
  });

  // Runs exactly once: both the signal path and the close path lead here.
  const cleanup = (code, signal = null) => {
    if (finished) return;
    finished = true;
    clearTimeout(graceTimer);
    clearInterval(callPoll);

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
    clearInterval(callPoll);
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

/**
 * Acts on what the menu returned, and says whether to launch the tool.
 *
 * Choosing hooks is setup: it installs them and stops. Nothing is started, so
 * someone running several agents can set one up now and open it when they
 * like - the music plays from their first prompt either way. Only "just launch
 * it" and "this session only" go on to start the tool. A failed install is an
 * error with a non-zero exit, not a launch without the hooks that were asked for.
 */
function applyMenuSelection(selection, volume) {
  if (!selection.installHooks) return true;
  const hooks = require("./hooks");
  try {
    installHookTargets([selection.hookTarget], selection.genre, volume, selection.reactive, false,
      { genre: selection.genre, volume });
  } catch (err) {
    console.error(`\x1b[31m[vibeaudio] ${err.message}\x1b[0m`);
    process.exit(1);
  }
  const saved = loadConfig();
  // Everything VibeAudio is hooked into on this machine, not just this run's
  // pick: with several agents, "which ones are set up?" is the question, and
  // which one to open first is the user's call.
  const hooked = Object.entries(hooks.TARGETS).filter(([id]) => hooks.userHooksInstalled(null, id));
  const names = hooked.map(([, t]) => t.name).join(", ");
  const cmds = hooked.map(([, t]) => t.cmd).join(", ");
  console.log(
    `\n\x1b[32m✔ VibeAudio v${pkg.version} is hooked into: ${names} (${saved.genre} @ ${saved.volume}%).\x1b[0m ` +
    `Nothing was started: open ${hooked.length > 1 ? "any of them" : "it"} whenever you like (\x1b[1m${cmds}\x1b[0m), and the music plays from your first prompt.\n` +
    `  \x1b[90mMore agents? Run vibe again for each, or vibe --install-hooks to set up every one it finds.\x1b[0m\n` +
    `  \x1b[90mStay current: run npm i -g ${pkg.name} now and then (hooks keep working); vibe --status tells you when a newer version is out.\x1b[0m\n` +
    `  \x1b[90mOptional: vibe --speak adds a spoken line naming the project after the chime (vibe --no-speak turns it off).\x1b[0m\n` +
    `  \x1b[90mAll commands and options: vibe --help\x1b[0m\n`
  );
  printUpdateNotice();
  return false;
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
    state: showState,
    statusline: showStatusline,
    why: showWhy,
    music,
    events: followEvents,
    doctor: showDoctor,
    notify: notifyChange,
    muteOnCalls: callsChange,
    speak: speakChange,
    announcements: announcementsChange,
    report: reportDays,
    card: cardFlag,
    cardOut,
    stop: shouldStop,
    mute: muteChange,
    muteMinutes,
    hookAction,
    mcp,
    reactive,
    followVolume,
    plugin,
    hookEvent,
    dashboard,
    announce: announceReq,
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
      return runHookAction(hookAction, { music, genre, volume, chimeVolume, noChime, reactive, followVolume, plugin, hookEvent, tools, dryRun, typed });
    } catch (e) {
      // Settings problems are the user's to fix — report them, don't stack-trace.
      console.error(`\x1b[31m[vibeaudio] ${e.message}\x1b[0m`);
      process.exit(1);
    }
  }

  // These act on their own and then exit. With a command after them the command
  // used to be dropped without a word and the exit code was 0, so
  // `vibe --notify npm test && deploy` deployed without running the tests.
  {
    const own = muteChange !== null ? (muteChange ? "--mute" : "--unmute")
      : notifyChange !== null ? (notifyChange ? "--notify" : "--no-notify")
      : callsChange !== null ? (callsChange ? "--mute-on-calls" : "--no-mute-on-calls")
      : speakChange !== null ? (speakChange === "off" ? "--no-speak" : speakChange === "always" ? "--speak-always" : "--speak")
      : announcementsChange !== null ? "--announcements"
      : announceReq.text !== null ? "--announce"
      : cardFlag ? "--card"
      : null;
    if (own && cmdArgs.length > 0) {
      console.error(`\x1b[31m[vibeaudio] ${own} does not wrap a command, so '${cmdArgs.join(" ")}' was not run.\x1b[0m ` +
        (own === "--announce" ? `Put it after the command instead: ${cmdArgs.join(" ")}; vibe --announce "..." --exit-code $?` : `Run ${own} on its own, then the command.`));
      process.exit(1);
    }
  }

  if (announceReq.text === null && (announceReq.outcome !== null || announceReq.exitCode !== null)) {
    console.error("\x1b[31m[vibeaudio] --outcome and --exit-code go with --announce <text>.\x1b[0m");
    process.exit(1);
  }
  if (announceReq.text !== null) {
    if (!announceReq.text.trim()) {
      console.error("\x1b[31m[vibeaudio] --announce needs some text.\x1b[0m Run vibe --help for the options.");
      process.exit(1);
    }
    if (announceReq.outcome !== null && announceReq.exitCode !== null) {
      console.error("\x1b[31m[vibeaudio] Give --outcome or --exit-code, not both.\x1b[0m");
      process.exit(1);
    }
    const outcome = announceReq.outcome || (announceReq.exitCode === null || announceReq.exitCode === 0 ? "success" : "failure");
    // Exit 0 whatever happens: `cmd; vibe --announce ...` must not turn a pipeline red.
    require("./hooks").announce(announceReq.text, { outcome, volume, chimeVolume, noChime, genre });
    return;
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
      // A turn already running gets its music back now; only an idle machine waits for a prompt.
      const resumed = require("./hooks").resumeAfterUnmute(genre, volume, { music, follow: typed.volume === undefined });
      console.log(`\x1b[32m🔊 Unmuted.\x1b[0m ${resumed ? "Music is back." : "Music returns on your next prompt."}\n`);
      return;
    }

    const minutes = muteMinutes === null ? DEFAULT_MUTE_MINUTES : muteMinutes;
    const state = setMuted(true, minutes);
    // Muting has to silence what is playing right now, not just the next
    // prompt - the whole point is that a call is already ringing. The turns
    // in flight are kept: they still finish, log and show in --state.
    const stopped = require("./hooks").stopDaemon({ keepSessions: true });

    console.log(`\x1b[33m🔇 Muted ${muteRemainingText(state)}.\x1b[0m`);
    if (stopped) console.log(`  Stopped the player that was running.`);
    console.log(`  Hooks and settings are untouched. Ending it early: vibe --unmute`);
    if (minutes > 0) console.log(`  \x1b[90mLonger call? vibe --mute 120 — or vibe --mute 0 to stay off until you say otherwise.\x1b[0m`);
    console.log();
    return;
  }

  if (callsChange !== null) {
    saveConfig({ muteOnCalls: callsChange });
    console.log(callsChange
      ? "\x1b[32m✔ Quiet on calls.\x1b[0m Music, chimes and speech pause while any app uses the microphone, and music resumes when the call ends."
      : "\x1b[90mCalls no longer pause anything.\x1b[0m");
    return;
  }

  if (notifyChange !== null) {
    saveConfig({ notify: notifyChange });
    console.log(notifyChange
      ? "\x1b[32m✔ Notifications on.\x1b[0m A banner names the project when a turn finishes, fails or needs you."
      : "\x1b[90mNotifications off.\x1b[0m");
    return;
  }

  if (speakChange !== null) {
    saveConfig({ speak: speakChange });
    console.log(speakChange === "off"
      ? "\x1b[90mSpoken announcements off.\x1b[0m"
      : `\x1b[32m✔ Spoken announcements on${speakChange === "always" ? " (every time)" : " (when two or more sessions are going)"}.\x1b[0m After the chime, a voice says which project finished, failed or needs you.`);
    if (speakChange !== "off" && !require("./speech").voiceAvailable()) {
      console.log("  \x1b[33mNo voice found on this machine\x1b[0m, so nothing will be said. Linux needs spd-say, espeak-ng or espeak.");
    }
    return;
  }

  if (announcementsChange !== null) {
    saveConfig({ announce: announcementsChange });
    console.log(announcementsChange
      ? "\x1b[32m✔ vibe --announce is on.\x1b[0m"
      : "\x1b[90mvibe --announce is off: it now does nothing, and exits 0.\x1b[0m");
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

  if (showDoctor) {
    return printDoctor();
  }

  // Machine-readable, for lights, menu bars and status lines: see "Build on it" in the README.
  if (showState) {
    console.log(JSON.stringify(require("./hooks").agentState()));
    return;
  }

  // Idle prints nothing, not even a newline, so a prompt segment disappears.
  if (showStatusline) {
    const hooks = require("./hooks");
    const line = hooks.formatStatusline(hooks.agentState());
    if (line) console.log(line);
    return;
  }

  // --status's first line without the rest, plain: for the mod's pane and band (#60), a prompt segment, a script.
  if (showWhy) {
    const hooks = require("./hooks");
    console.log(hooks.explainMusic(musicFacts()).text);
    return;
  }

  if (dashboard) {
    const { startDashboard } = require("./dashboard");
    let server;
    try {
      server = await startDashboard({ port: dashboard.port });
    } catch (e) {
      console.error(`\x1b[31m[vibeaudio] Could not start the dashboard: ${e.code === "EADDRINUSE" ? `port ${dashboard.port} is in use` : e.message}.\x1b[0m`);
      process.exit(1);
    }
    const url = `http://127.0.0.1:${server.address().port}/`;
    console.log(`\x1b[1mVibeAudio dashboard\x1b[0m  ${url}  \x1b[90m(read-only, this machine only; Ctrl+C to stop)\x1b[0m`);
    if (dashboard.open) openBrowser(url);
    return; // the listening server keeps the process alive
  }

  if (followEvents) {
    process.stdout.on("error", () => process.exit(0)); // `vibe --events | head` closing the pipe is not an error.
    require("./hooks").followEvents();
    return;
  }

  if (cardOut !== null && !cardFlag) {
    console.error("\x1b[31m[vibeaudio] --out goes with --card.\x1b[0m");
    process.exit(1);
  }
  if (cardFlag) return printCard(reportDays ?? 7, cardOut);

  if (reportDays !== null) {
    return printReport(reportDays);
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
    return saveDefaults(typed, hereOnly, { genre, volume, music, follow: typed.volume === undefined });
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

    if (selection.settings) return; // the toggles were saved on the way out of that screen

    const chosenVol = selection.volume !== undefined ? selection.volume : volume;
    if (!applyMenuSelection(selection, chosenVol)) return;

    return executeCommand(selection.cmd, selection.genre, chosenVol, chimeVolume, grace, noChime, noHud, music);
  }

  executeCommand(cmdArgs, genre, volume, chimeVolume, grace, noChime, noHud, music);
}


module.exports = { signalExitCode, previewAudioFile, previewGenre, renderToFile, runHookAction, hookTargetFor, hooksAlreadyCover, windowsCommandNeedsShell, openBrowser, executeCommand, applyMenuSelection, run };
