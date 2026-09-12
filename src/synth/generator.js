/**
 * Core Audio Synthesis & WAV Encoder Utilities
 * Zero dependencies - Pure Node.js Buffers and Math
 */

const SAMPLE_RATE = 44100;

const NOTE_INDICES = {
  C: 0, "C#": 1, DB: 1,
  D: 2, "D#": 3, EB: 3,
  E: 4,
  F: 5, "F#": 6, GB: 6,
  G: 7, "G#": 8, AB: 8,
  A: 9, "A#": 10, BB: 10,
  B: 11
};

/**
 * Converts note string (e.g. "C4", "A#3", "Eb5") to frequency in Hz.
 */
function noteToFreq(noteStr) {
  const clean = noteStr.trim().toUpperCase();
  const name = clean.slice(0, -1);
  const octave = parseInt(clean.slice(-1), 10);
  const semitone = NOTE_INDICES[name];
  if (semitone === undefined || isNaN(octave)) {
    throw new Error(`Invalid note name: ${noteStr}`);
  }
  const midi = semitone + (octave + 1) * 12;
  return 440.0 * Math.pow(2.0, (midi - 69) / 12.0);
}

/**
 * Deterministic PRNG (mulberry32). Same seed always yields the same music,
 * which is what makes a project's sound stable across sessions and keeps the
 * audio cache valid.
 */
function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a: turns a project path into a stable 32-bit seed. */
function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function pick(rng, options) {
  return options[Math.floor(rng() * options.length) % options.length];
}

/**
 * Ornament placement draws from its own stream so that gating a layer by tier
 * can't shift the choices made by other layers - tier 1 and tier 3 stay the
 * same piece, one just has more of it.
 */
function ornamentRng(seed) {
  return makeRng((seed ^ 0x9e3779b9) >>> 0);
}

/**
 * Waveform Oscillators
 */
function sine(phase) {
  return Math.sin(2.0 * Math.PI * phase);
}

function triangle(phase) {
  const p = ((phase % 1.0) + 1.0) % 1.0;
  return 4.0 * Math.abs(p - 0.5) - 1.0;
}

/**
 * A saturated two-harmonic pulse: fundamental plus its octave, driven into
 * tanh so the tops square off.
 *
 * It took a `duty` argument for a long time and never read it. Five call sites
 * passed 0.3, 0.32, 0.35, 0.4 and 0.5, so chiptune's bass and its lead were
 * asking for different widths and getting one waveform - pulse-width
 * variation, the thing that makes a chiptune sound like a chiptune, was never
 * wired up. The parameter is gone rather than implemented because implementing
 * it changes how 8bit and electronic sound, and a level and voicing tuned by
 * ear has to be re-checked by ear. If you want real PWM, add it here
 * deliberately (compare `p` against the duty instead of summing harmonics),
 * then re-level both genres against the house RMS and listen to every tier.
 */
function softPulse(phase) {
  const p = ((phase % 1.0) + 1.0) % 1.0;
  const s = Math.sin(2.0 * Math.PI * p) + 0.35 * Math.sin(4.0 * Math.PI * p);
  return Math.tanh(s * 2.8);
}

function analogSaw(phase) {
  const p = 2.0 * Math.PI * (((phase % 1.0) + 1.0) % 1.0);
  return (
    Math.sin(p) * 0.70 +
    Math.sin(2.0 * p) * 0.35 +
    Math.sin(3.0 * p) * 0.18 +
    Math.sin(4.0 * p) * 0.08
  );
}

/**
 * Encodes audio buffers (Float Arrays in [-1.0, 1.0]) into a valid 16-bit PCM WAV Buffer.
 * Supports mono (single array) or stereo (array of [left, right] or { left: [], right: [] }).
 */
function createWavBuffer({ left, right = null, sampleRate = SAMPLE_RATE }) {
  const isStereo = right != null && right.length > 0;
  const numChannels = isStereo ? 2 : 1;
  const numSamples = left.length;
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const bufferSize = 44 + dataSize;

  const buf = Buffer.alloc(bufferSize);

  // RIFF Header
  buf.write("RIFF", 0);
  buf.writeUInt32LE(bufferSize - 8, 4);
  buf.write("WAVE", 8);

  // fmt subchunk
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);           // Subchunk1Size for PCM
  buf.writeUInt16LE(1, 20);            // AudioFormat 1 = PCM
  buf.writeUInt16LE(numChannels, 22);  // NumChannels
  buf.writeUInt32LE(sampleRate, 24);   // SampleRate
  buf.writeUInt32LE(byteRate, 28);     // ByteRate
  buf.writeUInt16LE(blockAlign, 32);   // BlockAlign
  buf.writeUInt16LE(16, 34);           // BitsPerSample (16-bit)

  // data subchunk
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    // Clamp sample between -1.0 and 1.0
    const valL = Math.max(-1.0, Math.min(1.0, left[i]));
    const intL = valL < 0 ? Math.floor(valL * 32768) : Math.floor(valL * 32767);
    buf.writeInt16LE(intL, offset);
    offset += 2;

    if (isStereo) {
      const valR = Math.max(-1.0, Math.min(1.0, right[i]));
      const intR = valR < 0 ? Math.floor(valR * 32768) : Math.floor(valR * 32767);
      buf.writeInt16LE(intR, offset);
      offset += 2;
    }
  }

  return buf;
}

module.exports = {
  SAMPLE_RATE,
  makeRng,
  hashString,
  pick,
  ornamentRng,
  noteToFreq,
  sine,
  triangle,
  softPulse,
  analogSaw,
  createWavBuffer
};
