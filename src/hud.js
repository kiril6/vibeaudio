/**
 * ASCII Waveform HUD & Terminal Tab Animation
 * Zero dependencies - Pure ANSI escape codes
 */

const WAVES = [
  " ▂▃▅▆▅▃ ",
  "▂▃▅▆▇▆▅▂",
  "▃▅▆▇█▇▆▃",
  "▅▆▇███▇▅",
  "▆▇█▇▆▅▃▂",
  "▇█▇▆▅▃▂ "
];

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

class TerminalHud {
  constructor(genre = "lofi") {
    this.genre = genre;
    this.timer = null;
    this.startTime = 0;
    this.frameIdx = 0;
  }

  start() {
    this.startTime = Date.now();

    // Initial banner
    if (process.stdout.isTTY) {
      process.stdout.write(`\x1b[90m[ 🎧 VibeAudio: \x1b[36m${this.genre}\x1b[90m • Adaptive Procedural Audio Active ]\x1b[0m\n`);
    }

    // Animate terminal window/tab title every 120ms
    this.timer = setInterval(() => {
      this.frameIdx = (this.frameIdx + 1) % WAVES.length;
      const wave = WAVES[this.frameIdx];
      const elapsed = Date.now() - this.startTime;
      const timeStr = formatTime(elapsed);

      // Set terminal window & tab title (works in Mac Terminal, iTerm2, VS Code, Warp)
      if (process.stdout.isTTY) {
        process.stdout.write(`\x1b]0;[ ♫ ${wave} ${this.genre} (${timeStr}) ]\x07`);
      }
    }, 120);
  }

  stop({ outcome = "success", code = 0 } = {}) {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    const elapsed = Date.now() - this.startTime;
    const timeStr = (elapsed / 1000).toFixed(1);

    // Reset terminal window/tab title
    if (process.stdout.isTTY) {
      process.stdout.write(`\x1b]0;\x07`);
    }

    // Print outcome resolution indicator
    if (process.stdout.isTTY && elapsed > 1500) {
      if (code === 0) {
        process.stdout.write(`\n\x1b[32m✔ [VibeAudio] Done in ${timeStr}s • Ascending resolution chime\x1b[0m\n`);
      } else {
        process.stdout.write(`\n\x1b[33m✖ [VibeAudio] Command exited with code ${code} in ${timeStr}s • Descending minor tone\x1b[0m\n`);
      }
    }
  }
}

module.exports = { TerminalHud };
