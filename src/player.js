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
const { generateDroneLoop } = require("./synth/drone");
const { generatePianoLoop } = require("./synth/piano");
const { generateJazzLoop } = require("./synth/jazz");
const { generateSuccessChime, generateFailureChime } = require("./synth/chime");
const { hashString } = require("./synth/generator");
const pkg = require("../package.json");

const CACHE_ROOT = path.join(os.homedir(), ".vibeaudio", "cache");

/**
 * The cache key has to change whenever the audio would, or existing users keep
 * hearing the previous render forever with nothing to tell them so.
 *
 * Keying it on the package version alone made that a thing someone had to
 * remember, and the record for that was 0 for 40: eight of the ten generators
 * changed across forty commits while the version sat still, so the fix that
 * makes synth changes reach users had never once fired. Hashing the sources
 * instead makes it an invariant - you cannot change a generator without
 * invalidating the cache, because the generator *is* the key.
 *
 * The version stays in the directory name for legibility; the hash is what
 * actually decides. Costs one read of ~50 kB at startup.
 */
function synthFingerprint(dir = path.join(__dirname, "synth")) {
  try {
    const parts = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".js"))
      .sort() // readdir order is not guaranteed; the key must be stable.
      .map((name) => `${name}\u0000${fs.readFileSync(path.join(dir, name), "utf8")}`);
    return hashString(parts.join("\u0000")).toString(16).padStart(8, "0");
  } catch (e) {
    // Unreadable sources are someone else's problem to report; falling back to
    // the version keeps the old behaviour rather than failing to play at all.
    return "nofp";
  }
}

const CACHE_DIR = path.join(CACHE_ROOT, `v${pkg.version}-${synthFingerprint()}`);
const AVAILABLE_GENRES = ["lofi", "synthwave", "8bit", "electronic", "jazz", "zen", "piano", "drone"];

/**
 * What `random` may land on. Drone is deliberately excluded: it is the "no
 * melody at all" option people choose on purpose, not a mood in the same
 * series as the others. Rolling it by chance reads as broken audio rather
 * than as variety, so it stays opt-in by name (or via the noise/focus alias).
 */
const SHUFFLE_GENRES = AVAILABLE_GENRES.filter((g) => g !== "drone");

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

let sweptLegacyLoops = false;

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    pruneStaleCache();
    return;
  }

  // Loops moved into per-seed subdirectories. Anything left at the top level
  // was written by an older layout of this same version and is now orphaned -
  // chimes legitimately live here, so only loop_*.wav is swept.
  if (sweptLegacyLoops) return;
  sweptLegacyLoops = true;
  try {
    for (const name of fs.readdirSync(CACHE_DIR)) {
      if (/^loop_.*\.wav$/.test(name)) fs.rmSync(path.join(CACHE_DIR, name), { force: true });
    }
  } catch (e) {
    // Best-effort housekeeping.
  }
}

/**
 * Caches are keyed by version plus a hash of the generators, so a synth change
 * reaches existing users. Anything from another key is dead weight and
 * regenerates on demand.
 */
function pruneStaleCache() {
  try {
    for (const entry of fs.readdirSync(CACHE_ROOT, { withFileTypes: true })) {
      const full = path.join(CACHE_ROOT, entry.name);
      if (entry.isDirectory() && /^v\d/.test(entry.name) && entry.name !== path.basename(CACHE_DIR)) {
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
  ambient: "zen",
  noise: "drone",
  focus: "drone",
  sparse: "piano",
  satie: "piano"
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

/**
 * Volume reaches us as a string from env vars and CLI flags, and as a number
 * from MCP tool arguments. One parser for all three: without it each caller
 * writes its own clamp, and the one that forgets the NaN guard hands the
 * player `NaN` for VIBE_VOLUME=loud.
 */
function normalizeVolume(raw, fallback = 0.4) {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(5, Math.min(100, parsed)) / 100.0;
}

function resolveGenre(genre) {
  const normalized = (genre || "lofi").toLowerCase();
  if (normalized === "random" || normalized === "shuffle") {
    return SHUFFLE_GENRES[Math.floor(Math.random() * SHUFFLE_GENRES.length)];
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
    case "drone":
      return generateDroneLoop(7.0, tier, seed);
    case "piano":
      return generatePianoLoop(7.6, tier, seed);
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

/**
 * `aplay` and PowerShell's SoundPlayer expose no volume parameter, so on those
 * backends --volume used to be silently ignored. Scaling the PCM ourselves
 * gives every platform working volume control; the file is cached under its
 * own gain so a 15% render is never served to someone asking for 40%.
 *
 * Returns 1 when the backend can attenuate on its own - that path keeps the
 * existing cache files and stays bit-identical.
 */
/**
 * A global mute. Hooks and config stay exactly as they are - this is for a
 * screen share or a meeting, where uninstalling and reinstalling hooks is too
 * much ceremony for ten minutes of quiet.
 *
 * Read at playback time rather than cached, so exporting it takes effect on
 * the next prompt. It deliberately does not gag `--preview`: that path spawns
 * the player directly and is an explicit request to hear something.
 */
function playbackDisabled() {
  const raw = (process.env.VIBE_DISABLE || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function bakedGain(backend, volume) {
  if (!backend || backend.volume) return 1;
  return Math.max(0.05, Math.min(1, volume));
}

function gainSuffix(gain) {
  return gain === 1 ? "" : `_g${Math.round(gain * 100)}`;
}

/**
 * Scales 16-bit PCM in place, skipping the 44-byte canonical header our
 * generators write.
 *
 * ponytail: re-quantises rather than scaling the Float samples before they
 * reach 16-bit. Measured SNR at the lowest preset (15%) is 65dB, with error
 * capped at half an LSB - inaudible under background music. Thread the gain
 * into createWavBuffer if that ever stops being true.
 */
function applyGain(wav, gain) {
  if (gain === 1) return wav;
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error("applyGain expects a canonical 44-byte-header WAV");
  }
  for (let offset = 44; offset + 1 < wav.length; offset += 2) {
    const scaled = Math.round(wav.readInt16LE(offset) * gain);
    wav.writeInt16LE(Math.max(-32768, Math.min(32767, scaled)), offset);
  }
  return wav;
}

function getAudioPath(genre, tier = 2, seed = projectSeed(), gain = 1) {
  ensureCacheDir();
  const normalizedGenre = resolveGenre(genre);
  const safeTier = Math.max(1, Math.min(3, tier));

  const dir = seedDir(seed);
  const filePath = path.join(dir, `loop_${normalizedGenre}_t${safeTier}${gainSuffix(gain)}.wav`);

  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, applyGain(generateLoop(normalizedGenre, safeTier, seed >>> 0), gain));
    pruneSeedDirs();
  }

  return filePath;
}

function getChimePath(outcome = "success", gain = 1) {
  ensureCacheDir();
  const isFailure = outcome === "failure" || outcome === "error";
  const name = `chime_${isFailure ? "failure" : "success"}${gainSuffix(gain)}.wav`;
  const filePath = path.join(CACHE_DIR, name);

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, applyGain(isFailure ? generateFailureChime() : generateSuccessChime(), gain));
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
    this.intensity = null;
    this.currentTier = 1;
    this.nextTimer = null;
    this.watchdog = null;
  }

  /**
   * Returns true if playback actually started. Restarts when called with
   * different settings while playing, so a genre switch is not silently dropped.
   */
  start(genre = "lofi", volume = 0.42, { maxDurationMs = null, intensity = null } = {}) {
    const resolved = resolveGenre(genre);
    const targetVolume = Math.max(0.05, Math.min(1.0, volume));

    if (this.isPlaying) {
      if (resolved === this.genre && targetVolume === this.volume) return false;
      this.stop({ playChime: false });
    }

    if (playbackDisabled()) return false;

    if (!detectPlayer()) {
      warnNoPlayer();
      return false;
    }

    this.isPlaying = true;
    this.startTime = Date.now();
    this.genre = resolved;
    this.volume = targetVolume;
    this.seed = projectSeed();
    this.intensity = intensity;

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
    // An intensity source (reactive mode) overrides this when it has a signal.
    const elapsed = Date.now() - this.startTime;
    const byTime = elapsed > TIER_3_AFTER_MS ? 3 : elapsed > TIER_2_AFTER_MS ? 2 : 1;
    this.currentTier = (this.intensity && this.intensity()) || byTime;

    // Either the backend attenuates, or the file is rendered pre-attenuated -
    // never both, or the volume would be applied twice.
    const backend = detectPlayer();
    const gain = bakedGain(backend, this.volume);
    const audioFile = getAudioPath(this.genre, this.currentTier, this.seed, gain);
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

    if (playChime && !playbackDisabled()) {
      const backend = detectPlayer();
      if (!backend) return wasPlaying;

      const targetVol = chimeVolume !== null ? chimeVolume : Math.min(0.65, Math.max(0.35, volume * 1.1));
      const clamped = Math.max(0.05, Math.min(1.0, targetVol));
      const chimeFile = getChimePath(outcome, bakedGain(backend, clamped));

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
  bakedGain,
  applyGain,
  playbackDisabled,
  resolveGenre,
  isKnownGenre,
  normalizeVolume,
  projectSeed,
  wavDurationMs,
  AVAILABLE_GENRES,
  SHUFFLE_GENRES,
  synthFingerprint,
  CACHE_ROOT,
  CACHE_DIR
};
