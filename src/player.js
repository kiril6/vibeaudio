/**
 * Audio Cache & Cross-Platform Playback Manager
 * Supports Adaptive Time Escalation & Outcome-Aware Chimes
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, spawnSync } = require("child_process");

const { generateLofiLoop } = require("./synth/lofi");
const { generateSynthwaveLoop } = require("./synth/synthwave");
const { generateChiptuneLoop } = require("./synth/chiptune");
const { generateElectronicLoop } = require("./synth/electronic");
const { generateZenLoop } = require("./synth/zen");
const { generateJazzLoop } = require("./synth/jazz");
const { generateSuccessChime, generateFailureChime } = require("./synth/chime");
const { hashString } = require("./synth/generator");
const pkg = require("../package.json");

const CACHE_ROOT = path.join(os.homedir(), ".vibeaudio", "cache");
const CACHE_DIR = path.join(CACHE_ROOT, `v${pkg.version}`);
const AVAILABLE_GENRES = ["lofi", "synthwave", "8bit", "electronic", "jazz", "zen"];

// Next loop starts slightly before the current one ends, so the per-loop
// boundary fades crossfade instead of leaving a process-spawn gap.
const LOOP_OVERLAP_MS = 120;

const TIER_2_AFTER_MS = 15000;
const TIER_3_AFTER_MS = 45000;

/**
 * Playback backends, in preference order. `volume` marks whether the backend
 * can attenuate; the others play at system volume.
 */
const PLAYER_CANDIDATES = [
  { cmd: "afplay", volume: true, args: (file, vol) => ["-v", String(vol), file] },
  { cmd: "paplay", volume: true, args: (file, vol) => [`--volume=${Math.round(vol * 65536)}`, file] },
  {
    cmd: "ffplay",
    volume: true,
    args: (file, vol) => ["-nodisp", "-autoexit", "-loglevel", "quiet", "-volume", String(Math.round(vol * 100)), file]
  },
  { cmd: "aplay", volume: false, args: (file) => ["-q", file] }
];

let cachedPlayer;
let warnedNoPlayer = false;

function detectPlayer() {
  if (cachedPlayer !== undefined) return cachedPlayer;

  if (process.platform === "win32") {
    cachedPlayer = {
      cmd: "powershell",
      volume: false,
      args: (file) => [
        "-NoProfile",
        "-WindowStyle",
        "Hidden",
        "-Command",
        `(New-Object Media.SoundPlayer '${file.replace(/'/g, "''")}').PlaySync()`
      ]
    };
    return cachedPlayer;
  }

  cachedPlayer = PLAYER_CANDIDATES.find(
    (c) => spawnSync("which", [c.cmd], { stdio: "ignore" }).status === 0
  ) || null;

  return cachedPlayer;
}

function warnNoPlayer() {
  if (warnedNoPlayer) return;
  warnedNoPlayer = true;
  process.stderr.write(
    "\x1b[33m[vibeaudio] No supported audio player found — running silently.\x1b[0m\n" +
      "  macOS: afplay ships with the system.\n" +
      "  Linux: install one of pulseaudio-utils (paplay), ffmpeg (ffplay), or alsa-utils (aplay).\n"
  );
}

function ensureCacheDir() {
  if (fs.existsSync(CACHE_DIR)) return;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  pruneStaleCache();
}

/**
 * Caches are keyed by version, so a synth change reaches existing users.
 * Anything from another version is dead weight and regenerates on demand.
 */
function pruneStaleCache() {
  try {
    for (const entry of fs.readdirSync(CACHE_ROOT, { withFileTypes: true })) {
      const full = path.join(CACHE_ROOT, entry.name);
      if (entry.isDirectory() && /^v\d/.test(entry.name) && entry.name !== `v${pkg.version}`) {
        fs.rmSync(full, { recursive: true, force: true });
      } else if (entry.isFile() && entry.name.endsWith(".wav")) {
        fs.rmSync(full, { force: true });
      }
    }
  } catch (e) {
    // Pruning is best-effort; a stale cache is not worth failing a run over.
  }
}

function clearCache() {
  fs.rmSync(CACHE_ROOT, { recursive: true, force: true });
  return CACHE_ROOT;
}

const GENRE_ALIASES = {
  chiptune: "8bit",
  downtempo: "electronic",
  bossa: "jazz",
  ambient: "zen"
};

function isKnownGenre(genre) {
  const normalized = (genre || "").toLowerCase();
  return (
    normalized === "random" ||
    normalized === "shuffle" ||
    AVAILABLE_GENRES.includes(normalized) ||
    normalized in GENRE_ALIASES
  );
}

function resolveGenre(genre) {
  const normalized = (genre || "lofi").toLowerCase();
  if (normalized === "random" || normalized === "shuffle") {
    return AVAILABLE_GENRES[Math.floor(Math.random() * AVAILABLE_GENRES.length)];
  }
  return GENRE_ALIASES[normalized] || normalized;
}

function generateLoop(genre, tier, seed) {
  switch (genre) {
    case "synthwave":
      return generateSynthwaveLoop(6.8, tier, seed);
    case "8bit":
      return generateChiptuneLoop(7.5, tier, seed);
    case "electronic":
      return generateElectronicLoop(6.4, tier, seed);
    case "jazz":
      return generateJazzLoop(6.26, tier, seed);
    case "zen":
      return generateZenLoop(7.2, tier, seed);
    case "lofi":
    default:
      return generateLofiLoop(6.4, tier, seed);
  }
}

/**
 * Seed from the project directory, so a repo always sounds like itself.
 * Focus music should fade into the background, which familiarity helps and
 * per-run novelty actively hurts - so this deliberately does not vary per run.
 */
function projectSeed(cwd = process.cwd()) {
  if (process.env.VIBE_SEED) {
    const explicit = parseInt(process.env.VIBE_SEED, 10);
    if (!isNaN(explicit)) return explicit >>> 0;
  }
  return hashString(cwd);
}

function seedDir(seed) {
  return path.join(CACHE_DIR, `s${seed >>> 0}`);
}

/** Keep a small working set of projects cached; regenerating costs ~100ms. */
function pruneSeedDirs(keep = 3) {
  try {
    const dirs = fs
      .readdirSync(CACHE_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^s\d+$/.test(e.name))
      .map((e) => {
        const full = path.join(CACHE_DIR, e.name);
        return { full, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    for (const stale of dirs.slice(keep)) {
      fs.rmSync(stale.full, { recursive: true, force: true });
    }
  } catch (e) {
    // Best-effort housekeeping.
  }
}

function getAudioPath(genre, tier = 2, seed = projectSeed()) {
  ensureCacheDir();
  const normalizedGenre = resolveGenre(genre);
  const safeTier = Math.max(1, Math.min(3, tier));

  const dir = seedDir(seed);
  const filePath = path.join(dir, `loop_${normalizedGenre}_t${safeTier}.wav`);

  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, generateLoop(normalizedGenre, safeTier, seed >>> 0));
    pruneSeedDirs();
  }

  return filePath;
}

function getChimePath(outcome = "success") {
  ensureCacheDir();
  const isFailure = outcome === "failure" || outcome === "error";
  const filePath = path.join(CACHE_DIR, isFailure ? "chime_failure.wav" : "chime_success.wav");

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, isFailure ? generateFailureChime() : generateSuccessChime());
  }
  return filePath;
}

function wavDurationMs(filePath) {
  try {
    const fd = fs.openSync(filePath, "r");
    const header = Buffer.alloc(44);
    fs.readSync(fd, header, 0, 44, 0);
    fs.closeSync(fd);

    const byteRate = header.readUInt32LE(28);
    const dataSize = header.readUInt32LE(40);
    return byteRate > 0 ? (dataSize / byteRate) * 1000 : null;
  } catch (e) {
    return null;
  }
}

// Playback outlives the event loop unless killed, so an abrupt exit must not
// leave a detached player running.
const activePlayers = new Set();
let exitHookInstalled = false;

function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on("exit", () => {
    for (const player of activePlayers) player.killProcs();
  });
}

class AudioPlayer {
  constructor() {
    this.isPlaying = false;
    this.procs = new Set();
    this.startTime = 0;
    this.genre = "lofi";
    this.volume = 0.42;
    this.seed = projectSeed();
    this.currentTier = 1;
    this.nextTimer = null;
    this.watchdog = null;
  }

  /**
   * Returns true if playback actually started. Restarts when called with
   * different settings while playing, so a genre switch is not silently dropped.
   */
  start(genre = "lofi", volume = 0.42, { maxDurationMs = null } = {}) {
    const resolved = resolveGenre(genre);
    const targetVolume = Math.max(0.05, Math.min(1.0, volume));

    if (this.isPlaying) {
      if (resolved === this.genre && targetVolume === this.volume) return false;
      this.stop({ playChime: false });
    }

    if (!detectPlayer()) {
      warnNoPlayer();
      return false;
    }

    this.isPlaying = true;
    this.startTime = Date.now();
    this.genre = resolved;
    this.volume = targetVolume;
    this.seed = projectSeed();

    installExitHook();
    activePlayers.add(this);

    if (maxDurationMs) {
      this.watchdog = setTimeout(() => this.stop({ playChime: false }), maxDurationMs);
      if (this.watchdog.unref) this.watchdog.unref();
    }

    this.playLoop();
    return true;
  }

  playLoop() {
    if (!this.isPlaying) return;

    // Adaptive Time Escalation:
    // 0 - 15s  -> Tier 1 (Ambient intro / gentle pads)
    // 15 - 45s -> Tier 2 (Main progression & bassline)
    // 45s+     -> Tier 3 (Deep focus / peak energy)
    const elapsed = Date.now() - this.startTime;
    this.currentTier = elapsed > TIER_3_AFTER_MS ? 3 : elapsed > TIER_2_AFTER_MS ? 2 : 1;

    const audioFile = getAudioPath(this.genre, this.currentTier, this.seed);
    const backend = detectPlayer();
    const proc = spawn(backend.cmd, backend.args(audioFile, this.volume), { stdio: "ignore" });

    this.procs.add(proc);
    proc.on("close", () => this.procs.delete(proc));
    proc.on("error", () => {
      this.procs.delete(proc);
      this.isPlaying = false;
      warnNoPlayer();
    });

    const durationMs = wavDurationMs(audioFile) || 6500;
    this.nextTimer = setTimeout(() => this.playLoop(), Math.max(250, durationMs - LOOP_OVERLAP_MS));
  }

  killProcs() {
    for (const proc of this.procs) {
      try {
        proc.kill("SIGTERM");
      } catch (e) {
        // Process already closed
      }
    }
    this.procs.clear();
  }

  stop({ playChime = true, outcome = "success", volume = 0.35, chimeVolume = null } = {}) {
    const wasPlaying = this.isPlaying;
    this.isPlaying = false;

    if (this.nextTimer) {
      clearTimeout(this.nextTimer);
      this.nextTimer = null;
    }
    if (this.watchdog) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }

    this.killProcs();
    activePlayers.delete(this);

    if (playChime) {
      const backend = detectPlayer();
      if (!backend) return wasPlaying;

      const chimeFile = getChimePath(outcome);
      const targetVol = chimeVolume !== null ? chimeVolume : Math.min(0.65, Math.max(0.35, volume * 1.1));
      const clamped = Math.max(0.05, Math.min(1.0, targetVol));

      try {
        spawnSync(backend.cmd, backend.args(chimeFile, clamped), { stdio: "ignore", timeout: 2500 });
      } catch (e) {
        // Ignore timeout
      }
    }

    return wasPlaying;
  }
}

module.exports = {
  AudioPlayer,
  getAudioPath,
  getChimePath,
  clearCache,
  detectPlayer,
  resolveGenre,
  isKnownGenre,
  projectSeed,
  wavDurationMs,
  AVAILABLE_GENRES,
  CACHE_ROOT,
  CACHE_DIR
};
