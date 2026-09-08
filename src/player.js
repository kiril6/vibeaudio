/**
 * Audio Cache & Native macOS Playback Manager
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, spawnSync } = require("child_process");

const { generateLofiLoop } = require("./synth/lofi");
const { generateSynthwaveLoop } = require("./synth/synthwave");
const { generateChiptuneLoop } = require("./synth/chiptune");
const { generateChime } = require("./synth/chime");

const CACHE_DIR = path.join(os.homedir(), ".vibeaudio", "cache");

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function getAudioPath(genre) {
  ensureCacheDir();
  const normalizedGenre = (genre || "lofi").toLowerCase();
  const filePath = path.join(CACHE_DIR, `loop_${normalizedGenre}.wav`);

  if (!fs.existsSync(filePath)) {
    let buf;
    switch (normalizedGenre) {
      case "synthwave":
        buf = generateSynthwaveLoop();
        break;
      case "8bit":
      case "chiptune":
        buf = generateChiptuneLoop();
        break;
      case "lofi":
      default:
        buf = generateLofiLoop();
        break;
    }
    fs.writeFileSync(filePath, buf);
  }

  return filePath;
}

function getChimePath() {
  ensureCacheDir();
  const filePath = path.join(CACHE_DIR, "chime.wav");
  if (!fs.existsSync(filePath)) {
    const buf = generateChime();
    fs.writeFileSync(filePath, buf);
  }
  return filePath;
}

class AudioPlayer {
  constructor() {
    this.isPlaying = false;
    this.currentProc = null;
  }

  start(genre = "lofi", volume = 0.42) {
    if (this.isPlaying) return;
    this.isPlaying = true;

    const audioFile = getAudioPath(genre);
    const volStr = String(Math.max(0.05, Math.min(1.0, volume)));

    const loop = () => {
      if (!this.isPlaying) return;
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
        // Silently fail if afplay is not supported/found
        this.isPlaying = false;
      });
    };

    loop();
  }

  stop({ playChime = true, volume = 0.35 } = {}) {
    this.isPlaying = false;

    if (this.currentProc) {
      try {
        this.currentProc.kill("SIGTERM");
      } catch (e) {
        // Process already exited
      }
      this.currentProc = null;
    }

    if (playChime) {
      const chimeFile = getChimePath();
      const volStr = String(Math.max(0.05, Math.min(1.0, volume)));
      try {
        spawnSync("afplay", ["-v", volStr, chimeFile], { stdio: "ignore", timeout: 2500 });
      } catch (e) {
        // Ignore timeout or kill errors
      }
    }
  }
}

module.exports = {
  AudioPlayer,
  getAudioPath,
  getChimePath
};
