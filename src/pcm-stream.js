"use strict";

const { spawn } = require("child_process");

const CHUNK_MS = 50; // Granularity of a write: the gain ramp and a volume change land within one.
const LEAD_MS = 1500; // Ask for the next bar when this little is queued.
const FADE_IN_S = 0.5;
const VOLUME_RAMP_S = 0.3;

/**
 * One long-lived player process fed raw PCM (#16), where the other path spawns
 * a player per loop file. The gain ramp is done here, so a start fades in and a
 * volume change reaches music already playing; the backends run at full volume.
 * Bars are joined by overlapping the tail of one with the head of the next, which
 * is what the 120 ms re-spawn overlap did between processes: the files carry
 * boundary fades, so summing them is a crossfade.
 *
 * Pacing is the pipe's: write() returns false once the pipe is full and `drain`
 * resumes, so nothing runs ahead of the speakers by more than the buffers.
 */
class PcmStream {
  constructor(backend, { volume, overlapMs, onLow, onDead }) {
    this.backend = backend;
    this.target = volume;
    this.gain = 0; // Fades in from silence.
    this.slew = volume / FADE_IN_S; // Gain change allowed per second.
    this.overlapMs = overlapMs;
    this.onLow = onLow;
    this.onDead = onDead;
    this.proc = null;
    this.fmt = null;
    this.queue = []; // Int16Array chunks not yet written.
    this.queuedFrames = 0;
    this.tail = null; // Last overlap of the previous bar, held for the crossfade.
    this.waiting = false; // Waiting on `drain`.
    this.asked = false;
    this.dead = false;
  }

  /** Queues one canonical-header WAV. Returns false if the stream cannot play it. */
  append(wav) {
    if (this.dead || wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF") return false;
    const channels = wav.readUInt16LE(22);
    const rate = wav.readUInt32LE(24);
    const fmt = `${rate}/${channels}`;
    if (this.fmt && this.fmt !== fmt) return false; // Never happens with our generators; fall back rather than glitch.
    if (!this.proc && !this.spawnProc(rate, channels)) return false;
    this.fmt = fmt;
    this.rate = rate;
    this.channels = channels;

    const bytes = wav.length - 44;
    const pcm = new Int16Array(bytes >> 1);
    for (let i = 0; i < pcm.length; i++) pcm[i] = wav.readInt16LE(44 + i * 2);

    const keep = Math.min(pcm.length, Math.round((this.overlapMs / 1000) * rate) * channels);
    if (this.tail) {
      const n = Math.min(this.tail.length, pcm.length);
      for (let i = 0; i < n; i++) pcm[i] = Math.max(-32768, Math.min(32767, pcm[i] + this.tail[i]));
    }
    const body = pcm.subarray(0, pcm.length - keep);
    this.tail = pcm.slice(pcm.length - keep);
    this.queue.push(body);
    this.queuedFrames += body.length / channels;
    this.asked = false;
    this.pump();
    return true;
  }

  spawnProc(rate, channels) {
    try {
      const proc = spawn(this.backend.cmd, this.backend.stream(rate, channels), { stdio: ["pipe", "ignore", "ignore"] });
      proc.stdin.on("error", () => {}); // EPIPE once it is gone.
      const gone = () => {
        if (this.proc !== proc) return;
        this.proc = null;
        this.dead = true;
        this.onDead();
      };
      proc.on("error", gone);
      proc.on("exit", gone);
      this.proc = proc;
      return true;
    } catch (e) {
      return false;
    }
  }

  setVolume(volume) {
    this.target = volume;
    this.slew = Math.max(Math.abs(volume - this.gain), 0.05) / VOLUME_RAMP_S;
  }

  pump() {
    if (this.waiting || !this.proc) return;
    const stdin = this.proc.stdin;
    const chunkSamples = Math.round((CHUNK_MS / 1000) * this.rate) * this.channels;
    while (this.queue.length) {
      const head = this.queue[0];
      const n = Math.min(chunkSamples, head.length);
      const out = Buffer.alloc(n * 2);
      const step = this.slew / this.rate;
      for (let i = 0; i < n; i += this.channels) {
        const diff = this.target - this.gain;
        this.gain += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
        for (let c = 0; c < this.channels; c++) out.writeInt16LE(Math.round(head[i + c] * this.gain), (i + c) * 2);
      }
      if (n === head.length) this.queue.shift();
      else this.queue[0] = head.subarray(n);
      this.queuedFrames -= n / this.channels;
      if (!stdin.write(out)) {
        this.waiting = true;
        stdin.once("drain", () => {
          this.waiting = false;
          this.pump();
        });
        break;
      }
    }
    if (!this.asked && (this.queuedFrames / this.rate) * 1000 < LEAD_MS) {
      this.asked = true;
      this.onLow();
    }
  }

  kill() {
    this.dead = true;
    const proc = this.proc;
    this.proc = null;
    this.queue = [];
    if (!proc) return;
    try {
      proc.stdin.destroy();
      proc.kill("SIGTERM");
    } catch (e) {
      // Already gone.
    }
  }
}

module.exports = { PcmStream };
