/**
 * Audio Cache & Native macOS Playback Manager
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

const CACHE_DIR = path.join(os.homedir(), ".vibeaudio", "cache");
const AVAILABLE_GENRES = ["lofi", "synthwave", "8bit", "electronic", "jazz", "zen"];

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function getAudioPath(genre, tier = 2) {
  ensureCacheDir();
  let normalizedGenre = (genre || "lofi").toLowerCase();

  if (normalizedGenre === "random" || normalizedGenre === "shuffle") {
    normalizedGenre = AVAILABLE_GENRES[Math.floor(Math.random() * AVAILABLE_GENRES.length)];
  }

  const safeTier = Math.max(1, Math.min(3, tier));
  const filePath = path.join(CACHE_DIR, `loop_${normalizedGenre}_t${safeTier}.wav`);

  if (!fs.existsSync(filePath)) {
    let buf;
    switch (normalizedGenre) {
      case "synthwave":
        buf = generateSynthwaveLoop(6.8, safeTier);
        break;
      case "8bit":
      case "chiptune":
        buf = generateChiptuneLoop(7.5);
        break;
      case "electronic":
      case "downtempo":
        buf = generateElectronicLoop(6.4);
        break;
      case "jazz":
      case "bossa":
        buf = generateJazzLoop(6.26);
        break;
      case "zen":
      case "ambient":
        buf = generateZenLoop(7.2);
        break;
      case "lofi":
      default:
        buf = generateLofiLoop(6.4, safeTier);
        break;
    }
    fs.writeFileSync(filePath, buf);
  }

  return filePath;
}

function getChimePath(outcome = "success") {
  ensureCacheDir();
  const isFailure = outcome === "failure" || outcome === "error";
  const fileName = isFailure ? "chime_failure.wav" : "chime_success.wav";
  const filePath = path.join(CACHE_DIR, fileName);

  if (!fs.existsSync(filePath)) {
    const buf = isFailure ? generateFailureChime() : generateSuccessChime();
    fs.writeFileSync(filePath, buf);
  }
  return filePath;
}

class AudioPlayer {
  constructor() {
    this.isPlaying = false;
    this.currentProc = null;
    this.startTime = 0;
    this.genre = "lofi";
    this.currentTier = 1;
  }

  start(genre = "lofi", volume = 0.42) {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.startTime = Date.now();
    this.genre = (genre || "lofi").toLowerCase();

    const volStr = String(Math.max(0.05, Math.min(1.0, volume)));

    const loop = () => {
      if (!this.isPlaying) return;

      // Adaptive Time Escalation:
      // 0 - 15s  -> Tier 1 (Ambient intro / gentle pads)
      // 15 - 45s -> Tier 2 (Main progression & bassline)
      // 45s+     -> Tier 3 (Deep focus / peak energy)
      const elapsed = Date.now() - this.startTime;
      if (elapsed > 45000) {
        this.currentTier = 3;
      } else if (elapsed > 15000) {
        this.currentTier = 2;
      } else {
        this.currentTier = 1;
      }

      const audioFile = getAudioPath(this.genre, this.currentTier);

      this.currentProc = spawn("afplay", ["-v", volStr, audioFile], {
        stdio: "ignore",
        detached: false
      });

      this.currentProc.on("close", () => {
        if (this.isPlaying) {
          loop();
        }
      });

      this.currentProc.on("error", () => {
        this.isPlaying = false;
      });
    };

    loop();
  }

  stop({ playChime = true, outcome = "success", volume = 0.35 } = {}) {
    this.isPlaying = false;

    if (this.currentProc) {
      try {
        this.currentProc.kill("SIGTERM");
      } catch (e) {
        // Process already closed
      }
      this.currentProc = null;
    }

    if (playChime) {
      const chimeFile = getChimePath(outcome);
      const volStr = String(Math.max(0.05, Math.min(1.0, volume)));
      try {
        spawnSync("afplay", ["-v", volStr, chimeFile], { stdio: "ignore", timeout: 2500 });
      } catch (e) {
        // Ignore timeout
      }
    }
  }
}

module.exports = {
  AudioPlayer,
  getAudioPath,
  getChimePath,
  AVAILABLE_GENRES
};
