/** --status, --doctor, --report and --card output, and the update notice. */

const fs = require("fs");
const path = require("path");
const pkg = require("../package.json");
const chimefile = require("./chimefile");
const { normalizeVolume, loadConfig, musicEnabled, projectSettings } = require("./player");

/**
 * One place to answer "why am I hearing nothing / what is this configured to
 * do". Every line is read from live state rather than assumed, because the
 * usual cause of confusion is a mismatch between config and what is running.
 */
// What hooks.explainMusic() needs, read once: the same sources the sections of
// --status read, so the one-line answer cannot disagree with them.
function musicFacts() {
  const hooks = require("./hooks");
  const { muteState, envDisabled, onCall, detectPlayer: detect } = require("./player");
  const mute = muteState();
  const daemon = hooks.daemonPlaying();
  return {
    disabledByEnv: mute === null && envDisabled(),
    call: onCall() ? { apps: require("./callwatch").callState().apps } : null,
    mute: mute === null ? null : mute.until ? Math.max(1, Math.round((mute.until - Date.now()) / 60000)) : Infinity,
    backend: Boolean(detect()),
    daemon,
    genre: genreNow(),
    volume: daemon ? (daemon.follows ? Math.round(volumeNow() * 100) : daemon.volume) : null,
    music: musicEnabled(),
    musicSource: process.env.VIBE_MUSIC ? "env" : projectSettings(loadConfig()).music !== undefined ? "project" : "",
    sessions: hooks.agentState().sessions
  };
}

function printStatus() {
  const hooks = require("./hooks");
  const { detectPlayer: detect, CACHE_ROOT } = require("./player");
  const on = (s) => `\x1b[32m${s}\x1b[0m`;
  const off = (s) => `\x1b[90m${s}\x1b[0m`;

  console.log(`\n\x1b[1m\x1b[36mVibeAudio\x1b[0m v${pkg.version}\n`);

  // The answer first (#76): everything below is the detail behind it.
  const now = hooks.explainMusic(musicFacts());
  console.log(`\x1b[1mNow\x1b[0m  ${now.playing ? on(now.text) : `\x1b[33m${now.text}\x1b[0m`}\n`);

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
  console.log(`  music     ${musicEnabled() ? on("on") : "\x1b[33moff\x1b[0m"}${source("VIBE_MUSIC", "music")}${musicEnabled() ? "" : off("  signals only — vibe --music on")}`);
  for (const { kind, setting, error } of customChimeReport()) {
    console.log(`  ${`${kind} chime`.padEnd(15)}${error ? `\x1b[33m${setting}: ${error}\x1b[0m${off("  built-in plays instead")}` : on(setting)}`);
  }
  console.log(`  genre     ${on(genreNow())}${source("VIBE_GENRE", "genre")}`);
  console.log(`  volume    ${on(`${Math.round(volumeNow() * 100)}%`)}${source("VIBE_VOLUME", "volume")}`);
  console.log(`            ${off("change either with: vibe --genre <name> --volume <n>")}`);
  console.log(`  notify    ${hooks.notifyEnabled() ? on("on") : off("off")}${off("  desktop banner naming the project — vibe --notify / --no-notify")}`);
  console.log(`  calls     ${require("./player").muteOnCalls() ? on("mute on a call") : off("off")}${off("  go quiet while the microphone is in use, resume after — vibe --mute-on-calls / --no-mute-on-calls")}`);
  const speech = require("./speech");
  const speakNow = speech.speakMode(process.env, loadConfig());
  console.log(`  speak     ${speakNow === "off" ? off("off") : on(speakNow)}${off(speakNow === "off" ? "  a voice names the project after the chime — vibe --speak / --speak-always" : speakNow === "auto" ? "  only with two or more sessions — vibe --speak-always / --no-speak" : "  every time — vibe --no-speak")}${speakNow !== "off" && !speech.voiceAvailable() ? "  \x1b[33mno voice found on this machine\x1b[0m" : ""}`);
  console.log(`  announce  ${hooks.announceEnabled() ? on("on") : "\x1b[33moff\x1b[0m"}${off(hooks.announceEnabled() ? "  vibe --announce <text> for scripts and CI — vibe --announcements off to disable" : "  vibe --announce does nothing — vibe --announcements on")}`);

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
    const absent = hooks.expectedEvents(id).filter((e) => !installed.some(({ event }) => event === e));
    if (absent.length) {
      console.log(`    \x1b[33m+ ${absent.join(", ")} added since this install — vibe --install-hooks picks them up\x1b[0m`);
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
    const level = playing.follows ? Math.round(volumeNow() * 100) : playing.volume; // A following daemon plays what is saved.
    const now = playing.genre
      ? ` ${on(playing.genre)}${level === null ? "" : on(` @ ${level}%`)}${playing.reactive ? off(", reactive") : ""}`
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
  printUpdateNotice({ hooks: false });
}

/**
 * --status reads the setup back; this judges it. Each check is pass ("ok"),
 * worth knowing ("warn" - deliberate or self-healing states) or broken
 * ("fail"), and anything but "ok" carries the exact command that fixes it.
 * Only "fail" makes the exit code non-zero: a mute someone set on purpose is
 * not a reason for `vibe --doctor && ...` to stop a script.
 */
function doctorChecks() {
  const hooks = require("./hooks");
  const { detectPlayer: detect, muteState, muteRemainingText, envDisabled, CACHE_ROOT, CONFIG_FILE } = require("./player");
  const checks = [];
  const add = (level, label, detail = "", fix = "") => checks.push({ level, label, detail, fix });

  const backend = detect();
  if (backend) {
    add("ok", "Audio player", `${backend.cmd}${backend.volume ? "" : " (no volume flag — gain is baked into the file)"}`);
  } else {
    add("fail", "Audio player", "none found — VibeAudio runs silently",
      process.platform === "linux" ? "install one of: pulseaudio-utils (paplay), ffmpeg (ffplay), alsa-utils (aplay)"
        : process.platform === "win32" ? "PowerShell's SoundPlayer should be present — check that powershell is on PATH"
        : "afplay ships with macOS — check that /usr/bin is on PATH");
  }

  // loadConfig() swallows a parse error on purpose so playback never stops,
  // which is exactly why a typo here is silent and needs a check of its own.
  let configProblem = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) configProblem = "not a JSON object";
  } catch (e) {
    if (e.code !== "ENOENT") configProblem = e.message;
  }
  if (configProblem) {
    add("fail", "Saved settings", `${CONFIG_FILE}: ${configProblem} — ignored, defaults are in use`,
      `fix or delete ${CONFIG_FILE}, then: vibe --genre <name> --volume <n>`);
  } else {
    add("ok", "Saved settings", "config.json parses (or none saved)");
  }

  // afplay plays on the default output device, which moves when a monitor or
  // headphones connect - and an external display often has no system volume at
  // all, or speakers far quieter than the laptop's. Say where sound is going.
  const out = require("./output").macOutput();
  if (out) {
    const where = out.device ? `${out.device.name}${out.device.transport ? ` (${out.device.transport})` : ""}` : "the default output";
    if (out.muted) {
      add("warn", "Sound output", `${where} is muted in macOS — nothing will be heard`, "unmute it in the menu bar, or: osascript -e 'set volume output muted false'");
    } else if (out.volume === null) {
      add("warn", "Sound output", `${where} has no system volume control, so VibeAudio's own volume is the only one — and its speakers may be quiet`,
        "raise it with: vibe --volume 60 (and check the monitor's own speaker volume)");
    } else if (out.volume < 10) {
      add("warn", "Sound output", `${where}, system volume ${out.volume}%`, "raise the macOS volume");
    } else {
      add("ok", "Sound output", `${where}, system volume ${out.volume}%`);
    }
  }

  const detected = hooks.detectTargets();
  for (const id of Object.keys(hooks.TARGETS)) {
    const t = hooks.TARGETS[id];
    const installed = readVibeHooks(t.file(), t);
    const label = `${t.name} hooks`;
    if (!installed.length) {
      if (detected.includes(id)) add("warn", label, "agent found, hooks not installed", "vibe --install-hooks");
      continue;
    }

    // Hooks hold absolute paths to node and to this CLI; an evicted npx cache
    // or an uninstalled node leaves the agent firing a command that fails.
    const missing = new Set();
    for (const { command } of installed) {
      const tokens = [...command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
      for (const p of tokens.slice(0, 2)) if (!fs.existsSync(p)) missing.add(p);
    }
    const absent = hooks.expectedEvents(id).filter((e) => !installed.some(({ event }) => event === e));
    if (missing.size) {
      add("fail", label, `points at a file that no longer exists: ${[...missing].join(", ")}`, "vibe --install-hooks");
    } else if (absent.length) {
      add("warn", label, `installed by an older version, missing ${absent.join(", ")}`, "vibe --install-hooks");
    } else if (installed.some(({ command }) => /--genre /.test(command))) {
      add("warn", label, "pinned to a genre/volume by an older install, which overrides your saved settings", "vibe --install-hooks");
    } else {
      add("ok", label, `${installed.length} entries`);
    }

    // Codex runs a hook only after the user approves it, and records that in
    // config.toml under "<file>:<event>:<group>:<index>".
    if (id === "codex") {
      let toml = "";
      try { toml = fs.readFileSync(path.join(hooks.codexHome(), "config.toml"), "utf8"); } catch (e) { /* none yet */ }
      const pending = [];
      try {
        const file = t.file();
        // Codex canonicalizes CODEX_HOME before keying (find_codex_home()), so
        // a symlinked one - /tmp on macOS - is recorded under its real path.
        let real = file;
        try { real = fs.realpathSync(file); } catch (e) { /* checked below */ }
        for (const [event, entries] of Object.entries(JSON.parse(fs.readFileSync(file, "utf8")).hooks || {})) {
          (entries || []).forEach((entry, g) => {
            t.commands(entry).forEach((command, i) => {
              const suffix = `:${event.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase()}:${g}:${i}`;
              const trusted = [file, real].some((f) => toml.includes(`"${f}${suffix}"`));
              if (hooks.VIBE_HOOK_FLAG.test(command || "") && !trusted) pending.push(event);
            });
          });
        }
      } catch (e) { /* unreadable: the hooks check above already said so */ }
      if (pending.length) {
        add("warn", "Codex hook trust", `${pending.length} hooks not yet approved (${[...new Set(pending)].join(", ")}) — Codex will not run them`,
          "start codex and approve each VibeAudio hook once");
      }
    }
  }

  const mute = muteState();
  if (mute !== null) add("warn", "Mute", `muted ${muteRemainingText(mute)}`, "vibe --unmute");
  if (envDisabled()) add("warn", "VIBE_DISABLE", `set to "${process.env.VIBE_DISABLE}" — automatic playback is off`, "unset VIBE_DISABLE");
  if (mute === null && !envDisabled()) add("ok", "Mute", "not muted");
  for (const { kind, setting, error } of customChimeReport()) {
    if (error) add("warn", `Custom ${kind} chime`, `${setting}: ${error}, so the built-in chime plays instead`, `vibe --${kind}-chime default`);
    else add("ok", `Custom ${kind} chime`, setting);
  }
  if (!musicEnabled()) add("ok", "Music", "off — chimes and banners only, by your setting (vibe --music on)");
  if (require("./player").muteOnCalls()) {
    // Ask once rather than guess: a probe that cannot tell leaves the music alone, so it fails silently otherwise.
    const read = require("./callwatch").probe();
    if (read === null) {
      add("warn", "Mute on calls", "on, but this machine could not say whether the microphone is in use, so music never pauses",
        process.platform === "linux" ? "install pulseaudio-utils (pactl); PipeWire works through pipewire-pulse"
          : process.platform === "darwin" ? "check that osascript runs; on a headset it needs macOS 14.2 or later, where the mic flag cannot be told from our own music"
          : "check that reg runs");
    } else add("ok", "Mute on calls", `on — microphone ${read.inUse ? `in use now${read.apps.length ? ` by ${read.apps.join(", ")}` : ""}` : "idle"}`);
  }
  if (hooks.notifyEnabled()) {
    if (process.platform === "darwin") add("ok", "Desktop banners", "on, through osascript");
    else if (process.platform === "linux") {
      if (require("./interactive").isInstalled("notify-send")) add("ok", "Desktop banners", "on, through notify-send");
      else add("warn", "Desktop banners", "on, but notify-send was not found, so no banner appears", "install libnotify (notify-send) and a notification daemon");
    } else add("warn", "Desktop banners", "on, but this platform has no banner backend yet, so none appears", "vibe --no-notify");
  }
  {
    const speech = require("./speech");
    const mode = speech.speakMode(process.env, loadConfig());
    if (mode !== "off") {
      if (speech.voiceAvailable()) add("ok", "Spoken announcements", `${mode} — a voice is available`);
      else add("warn", "Spoken announcements", `${mode}, but no voice was found, so nothing is said`,
        process.platform === "linux" ? "install spd-say, espeak-ng or espeak" : "this system has no speech command on PATH");
    }
  }

  const pid = readDaemonPid(hooks.PID_FILE);
  if (pid === null) add("ok", "Background player", "not running");
  else if (!hooks.daemonPlaying()) add("warn", "Background player", `stale pid file (${pid} is not ours) — harmless, cleared on the next prompt`, "vibe --stop");
  else add("ok", "Background player", `playing, pid ${pid}`);

  try {
    fs.mkdirSync(CACHE_ROOT, { recursive: true });
    fs.accessSync(CACHE_ROOT, fs.constants.W_OK);
    add("ok", "Audio cache", `writable (${CACHE_ROOT})`);
  } catch (e) {
    add("fail", "Audio cache", `${CACHE_ROOT} is not writable: ${e.code || e.message}`, `check permissions on ${path.dirname(CACHE_ROOT)}`);
  }

  return checks;
}

/**
 * The summary of ~/.vibeaudio/history.jsonl. "You waited" is the agent's own
 * working time - a turn's length minus the stretches it spent blocked on a
 * dialog of yours - because the two are different complaints: one is the
 * agent being slow, the other is you being away. "Back to it" is the other
 * direction: how long a finished turn waited for your next prompt, with gaps
 * over RETURN_WINDOW_MS read as breaks and left out.
 */
function printReport(days, now = Date.now()) {
  const { readTurns, returnTimes, formatDuration, working, summarize, dayTotals } = require("./history");
  const turns = readTurns(days, now);
  const dim = (s) => `\x1b[90m${s}\x1b[0m`;
  const bold = (s) => `\x1b[1m${s}\x1b[0m`;
  console.log(`\n\x1b[1m\x1b[36mVibeAudio\x1b[0m report — last ${days === 1 ? "day" : `${days} days`}\n`);

  if (!turns.length) {
    console.log(`  No turns recorded yet.`);
    console.log(dim(`  Turns are logged when your agent's hooks fire (vibe --install-hooks). A command wrapped as \`vibe <command>\` is not.`));
    console.log(dim(`  The log stays on this machine; VIBE_NO_HISTORY=1 turns it off.`));
    console.log();
    return;
  }

  const { failed, waited: waitedOnAgents, blocked, median, longest } = summarize(turns);

  // Two projects called `api` under different parents stay apart.
  const names = new Map();
  for (const t of turns) {
    const parts = String(t.project || "?").split(/[\\/]/).filter(Boolean);
    const clash = [...names.entries()].some(([p, n]) => p !== t.project && n === parts.slice(-1)[0]);
    names.set(t.project, clash ? parts.slice(-2).join("/") : parts.slice(-1)[0] || "?");
  }
  const label = (t) => names.get(t.project);

  const row = (k, v, extra = "") => console.log(`  ${k.padEnd(18)}${bold(v)}${extra ? dim(`  ${extra}`) : ""}`);
  row("Turns", String(turns.length), failed ? `${failed} failed` : "");
  row("You waited", formatDuration(waitedOnAgents), `on agents, ${formatDuration(waitedOnAgents / turns.length)} per turn`);
  if (blocked >= 1000) row("Agents waited", formatDuration(blocked), "on you — permission dialogs and questions");
  row("Typical turn", formatDuration(median), "median");
  row("Longest turn", formatDuration(longest.ms), label(longest));

  // How fast you came back once a turn was done - the human half of the loop.
  const middle = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const gaps = returnTimes(turns);
  if (gaps.length) {
    row("Back to it", formatDuration(middle(gaps.map((g) => g.ms))), `median from done to your next prompt, ${gaps.length} ${gaps.length === 1 ? "time" : "times"}`);
    // Only once both sides have enough to mean something; three turns is an anecdote.
    const withChime = gaps.filter((g) => g.chimed === true).map((g) => g.ms);
    const without = gaps.filter((g) => g.chimed === false).map((g) => g.ms);
    if (withChime.length >= 5 && without.length >= 5) {
      row("", `${formatDuration(middle(withChime))} with a chime`, `${formatDuration(middle(without))} without (muted or --no-chime)`);
    }
  }

  const byProject = new Map();
  for (const t of turns) {
    const p = byProject.get(label(t)) || { ms: 0, n: 0 };
    p.ms += working(t);
    p.n += 1;
    byProject.set(label(t), p);
  }
  const top = [...byProject.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 5);
  const widest = top[0][1].ms || 1;
  console.log(`\n${bold("Where the time went")}`);
  for (const [name, p] of top) {
    console.log(`  ${name.slice(0, 18).padEnd(19)}${formatDuration(p.ms).padStart(8)}  ${"█".repeat(Math.max(1, Math.round((p.ms / widest) * 14))).padEnd(14)} ${dim(`${p.n} ${p.n === 1 ? "turn" : "turns"}`)}`);
  }

  if (days <= 14) {
    console.log(`\n${bold("By day")}`);
    const rows = dayTotals(turns, days, now);
    const maxDay = Math.max(...rows.map((r) => r.ms)) || 1;
    for (const { date, ms } of rows) {
      const name = `${date.toLocaleDateString("en-US", { weekday: "short" })} ${date.getDate()}`;
      console.log(`  ${name.padEnd(8)}${(ms ? formatDuration(ms) : "—").padStart(8)}  ${"█".repeat(ms ? Math.max(1, Math.round((ms / maxDay) * 14)) : 0)}`);
    }
  }
  console.log();
}

/** `--report --card`: the report as an image, written locally and never uploaded. */
function printCard(days, out) {
  const { readTurns } = require("./history");
  const turns = readTurns(days, Date.now());
  if (!turns.length) {
    console.log(`\n  No turns recorded in the last ${days === 1 ? "day" : `${days} days`}, so there is nothing to draw yet.`);
    console.log(`\x1b[90m  Turns are logged when your agent's hooks fire (vibe --install-hooks).\x1b[0m\n`);
    return;
  }
  const { writeCard } = require("./card");
  let written;
  try {
    written = writeCard(turns, days, { out });
  } catch (e) {
    console.error(`\x1b[31m[vibeaudio] Could not write the card: ${e.message}\x1b[0m`);
    process.exit(1);
  }
  const { formatDuration, summarize } = require("./history");
  const shown = written.pngPath || written.svgPath;
  console.log(`\n  Card saved: \x1b[1m${shown}\x1b[0m`);
  if (!written.pngPath) console.log(`\x1b[90m  PNG needs macOS; the SVG opens in any browser.\x1b[0m`);
  console.log(`\x1b[90m  Totals only - no project names. It stays on this machine; attach it to a post yourself.\x1b[0m`);
  console.log(`\n  ${formatDuration(summarize(turns).waited)} with my AI agents working, with focus music from VibeAudio: https://kiril6.github.io/vibeaudio  (npm i -g vibeaudio && vibe --install-hooks)\n`);
}

function printDoctor() {
  const mark = { ok: "\x1b[32m✔\x1b[0m", warn: "\x1b[33m!\x1b[0m", fail: "\x1b[31m✘\x1b[0m" };
  const checks = doctorChecks();
  console.log(`\n\x1b[1m\x1b[36mVibeAudio\x1b[0m v${pkg.version} doctor\n`);
  for (const c of checks) {
    console.log(`  ${mark[c.level]} ${c.label.padEnd(26)}\x1b[90m${c.detail}\x1b[0m`);
    if (c.fix) console.log(`      fix: ${c.fix}`);
  }
  const failed = checks.filter((c) => c.level === "fail").length;
  const warned = checks.filter((c) => c.level === "warn").length;
  console.log(failed ? `\n\x1b[31m${failed} problem${failed > 1 ? "s" : ""}\x1b[0m${warned ? `, ${warned} to look at` : ""}.\n`
    : `\n\x1b[32mNo problems\x1b[0m${warned ? `, ${warned} to look at` : ""}.\n`);
  if (failed) process.exitCode = 1;
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
    for (const [event, entries] of Object.entries(require("./hooks").hooksOf(settings, t) || {})) {
      for (const entry of Array.isArray(entries) ? entries : []) {
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
    { cmd: "windsurf", name: "Windsurf", integration: viaHooks("windsurf") },
    { cmd: "aider", name: "Aider", integration: "wrapper — vibe aider" },
    { cmd: "ollama", name: "Ollama", integration: "wrapper — vibe ollama run <model>" }
  ];
  const { isInstalled } = require("./interactive");
  return CANDIDATES.filter((c) => isInstalled(c.cmd));
}


/**
 * Names of the agents whose installed hooks lack an event this version writes.
 * A hook file outlives upgrades, so these people hear nothing from the new
 * event until they reinstall (#86). Offline: reads the hook files only.
 */
function staleHookAgents() {
  const hooks = require("./hooks");
  return Object.keys(hooks.TARGETS).flatMap((id) => {
    const t = hooks.TARGETS[id];
    const installed = readVibeHooks(t.file(), t);
    if (!installed.length) return [];
    return hooks.expectedEvents(id).some((e) => !installed.some(({ event }) => event === e)) ? [t.name] : [];
  });
}

// Only where a person is reading: help, status and the menu. See update.js.
// `status` prints the per-agent detail itself, so it skips the hooks line.
function printUpdateNotice({ hooks = true } = {}) {
  if (!process.stdout.isTTY) return;
  const { ephemeralInstallReason } = require("./hooks");
  const line = require("./update").updateNotice({ ephemeral: Boolean(ephemeralInstallReason()) });
  if (line) console.log(`${line}\n`);
  if (!hooks || require("./update").checkDisabled()) return;
  const stale = staleHookAgents();
  if (stale.length) console.log(`\x1b[33mNew hook events since you installed for ${stale.join(", ")}: run vibe --install-hooks to pick them up.\x1b[0m\n`);
}

/**
 * The chimes the user replaced, and whether each file is usable. A bad one is
 * not an error at playback - the built-in plays - so this is where it shows.
 */
function customChimeReport() {
  const { customChimeSetting } = require("./player");
  return chimefile.KINDS.flatMap((kind) => {
    const setting = customChimeSetting(kind);
    if (!setting) return [];
    const file = chimefile.expandChimePath(setting);
    const error = file ? chimefile.readChimeWav(file).error : "needs an absolute path";
    return [{ kind, setting, error }];
  });
}

module.exports = { musicFacts, printStatus, doctorChecks, printReport, printCard, printDoctor, settingNow, genreNow, volumeNow, dirSize, readVibeHooks, readDaemonPid, detectAiTools, staleHookAgents, printUpdateNotice, customChimeReport };
