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
    this.started = false;
    this.stopped = false;
  }

  start() {
    this.startTime = Date.now();
    this.started = true;

    // The wrapped tool may own the screen by now (full-screen TUIs like claude
    // or aider), so the title bar is the only safe place to draw.
    this.timer = setInterval(() => {
      this.frameIdx = (this.frameIdx + 1) % WAVES.length;
      const wave = WAVES[this.frameIdx];
      const timeStr = formatTime(Date.now() - this.startTime);

      // Set terminal window & tab title (works in Mac Terminal, iTerm2, VS Code, Warp)
      if (process.stdout.isTTY) {
        process.stdout.write(`\x1b]0;[ ♫ ${wave} ${this.genre} (${timeStr}) ]\x07`);
      }
    }, 120);
  }

  // `chimed` is what actually played, not what the outcome was: --no-chime and
  // a mute both leave the sound off, and announcing a chime nobody heard sends
  // the user looking for a broken speaker.
  stop({ outcome = "success", code = 0, interrupted = false, chimed = true } = {}) {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    // Nothing was ever drawn (fast command), or cleanup ran twice.
    if (!this.started || this.stopped) return;
    this.stopped = true;

    const timeStr = ((Date.now() - this.startTime) / 1000).toFixed(1);

    // Reset terminal window/tab title
    if (process.stdout.isTTY) {
      process.stdout.write(`\x1b]0;\x07`);
    }

    if (!process.stdout.isTTY) return;

    if (interrupted) {
      process.stdout.write(`\n\x1b[90m■ [VibeAudio] Interrupted after ${timeStr}s\x1b[0m\n`);
    } else if (code === 0) {
      const tail = chimed ? " • Ascending resolution chime" : "";
      process.stdout.write(`\n\x1b[32m✔ [VibeAudio] Done in ${timeStr}s${tail}\x1b[0m\n`);
    } else {
      const tail = chimed ? " • Descending minor tone" : "";
      process.stdout.write(`\n\x1b[33m✖ [VibeAudio] Command exited with code ${code} in ${timeStr}s${tail}\x1b[0m\n`);
    }
  }
}

module.exports = { TerminalHud };
