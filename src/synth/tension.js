/**
 * The "stuck" layer: a soft heartbeat under the loop, played while an agent's
 * recent tool calls keep failing. More of the same music would say "working
 * hard", which is not the news; a pulse that was not there before changes the
 * music's character, and a heartbeat is the most widely read tension cue there
 * is. Pitched on the genre's tonic so it sits in the key rather than against it.
 *
 * Pure like every other synth module: a WAV buffer in, a new one out.
 */

const { noteToFreq, SAMPLE_RATE } = require("./generator");

const BEAT_S = 1.1; // About 55 bpm: a resting heart, not a racing one.
const DUB_DELAY_S = 0.24;
const EDGE_S = 0.15; // Clear of the loop's boundary fades, so seams stay clean.
const LEVEL = 0.22;

// Laptop speakers roll off below ~120 Hz, and a pulse nobody hears is no
// signal, so the tonic sits between 110 and 220 Hz with a second harmonic.
function pulseFreq(key) {
  const tonic = String(key || "A minor").split(" ")[0];
  let f = noteToFreq(`${tonic}3`);
  while (f > 220) f /= 2;
  while (f < 110) f *= 2;
  return f;
}

// One thump: a short pitch drop, like a soft kick, decaying in ~0.2s.
function thump(t, f) {
  if (t < 0 || t > 0.35) return 0;
  const phase = f * t + (f * 0.5 * 0.04) * (1 - Math.exp(-t / 0.04)); // f*1.5 falling to f
  const env = Math.min(1, t / 0.004) * Math.exp(-t / 0.075);
  return env * (Math.sin(2 * Math.PI * phase) + 0.45 * Math.sin(4 * Math.PI * phase));
}

/** Mixes the heartbeat into a canonical 16-bit WAV (mono or stereo) and returns a new buffer. */
function addTension(wav, key) {
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error("addTension expects a canonical 44-byte-header WAV");
  }
  const channels = wav.readUInt16LE(22);
  const rate = wav.readUInt32LE(24) || SAMPLE_RATE;
  const frames = Math.floor((wav.length - 44) / (2 * channels));
  const duration = frames / rate;
  const f = pulseFreq(key);

  // A whole number of beats per loop, so the pulse keeps time across loops.
  const beats = Math.max(1, Math.round((duration - 2 * EDGE_S) / BEAT_S));
  const period = (duration - 2 * EDGE_S) / beats;
  const out = Buffer.from(wav);

  for (let i = 0; i < frames; i++) {
    const t = i / rate - EDGE_S;
    if (t < 0 || t > duration - 2 * EDGE_S) continue;
    const local = t % period;
    const s = LEVEL * (thump(local, f) + 0.7 * thump(local - DUB_DELAY_S, f));
    if (s === 0) continue;
    for (let c = 0; c < channels; c++) {
      const offset = 44 + (i * channels + c) * 2;
      const mixed = Math.round(out.readInt16LE(offset) + s * 32767);
      out.writeInt16LE(Math.max(-32768, Math.min(32767, mixed)), offset);
    }
  }
  return out;
}

module.exports = { addTension, pulseFreq };
