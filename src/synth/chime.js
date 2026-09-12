/**
 * Delicate Glassy Resolution Completion Chime
 * Harmonic Bell Decay (C5, G5, C6, E6)
 */

const {
  SAMPLE_RATE,
  noteToFreq,
  sine,
  createWavBuffer
} = require("./generator");

function generateSuccessChime(durationSec = 1.6) {
  const totalSamples = Math.floor(SAMPLE_RATE * durationSec);
  const left = new Float64Array(totalSamples);
  const right = new Float64Array(totalSamples);

  const chimeNotes = [
    { note: "C5", delay: 0.00, pan: 0.4 },
    { note: "G5", delay: 0.09, pan: 0.6 },
    { note: "C6", delay: 0.18, pan: 0.45 },
    { note: "E6", delay: 0.27, pan: 0.55 }
  ];

  for (const c of chimeNotes) {
    const f = noteToFreq(c.note);
    const startIdx = Math.floor(c.delay * SAMPLE_RATE);
    const ringSamples = Math.floor(1.2 * SAMPLE_RATE);

    for (let i = 0; i < ringSamples; i++) {
      const idx = startIdx + i;
      if (idx >= totalSamples) break;
      const t = i / SAMPLE_RATE;
      const env = Math.exp(-t * 4.2);

      // Sine fundamental + soft sparkling 2nd & 3rd harmonics
      const sample = (
        sine(f * t) * 0.72 +
        sine(f * 2.0 * t) * 0.22 * Math.exp(-t * 8.0) +
        sine(f * 3.0 * t) * 0.06 * Math.exp(-t * 14.0)
      ) * env * 0.24;

      left[idx] += sample * (1.0 - c.pan);
      right[idx] += sample * c.pan;
    }
  }

  return createWavBuffer({ left, right, sampleRate: SAMPLE_RATE });
}

function generateFailureChime(durationSec = 1.8) {
  const totalSamples = Math.floor(SAMPLE_RATE * durationSec);
  const left = new Float64Array(totalSamples);
  const right = new Float64Array(totalSamples);

  // Soft, contemplative descending minor chord (A4 -> F4 -> D4)
  const minorNotes = [
    { note: "A4", delay: 0.00, pan: 0.4 },
    { note: "F4", delay: 0.12, pan: 0.6 },
    { note: "D4", delay: 0.24, pan: 0.5 }
  ];

  for (const c of minorNotes) {
    const f = noteToFreq(c.note);
    const startIdx = Math.floor(c.delay * SAMPLE_RATE);
    const ringSamples = Math.floor(1.4 * SAMPLE_RATE);

    for (let i = 0; i < ringSamples; i++) {
      const idx = startIdx + i;
      if (idx >= totalSamples) break;
      const t = i / SAMPLE_RATE;
      const env = Math.exp(-t * 3.2);

      // Warmer, darker harmonic structure
      const sample = (
        sine(f * t) * 0.75 +
        sine(f * 2.0 * t) * 0.18 * Math.exp(-t * 6.0) +
        sine(f * 0.5 * t) * 0.12 * Math.exp(-t * 2.0)
      ) * env * 0.23;

      left[idx] += sample * (1.0 - c.pan);
      right[idx] += sample * c.pan;
    }
  }

  return createWavBuffer({ left, right, sampleRate: SAMPLE_RATE });
}

/**
 * "Your turn": the agent is blocked on the user. It must not be mistaken for
 * either outcome - success resolves downward onto the tonic and failure
 * descends in minor, so this one rises by an open fifth and stops there,
 * unresolved, twice. A question rather than an answer.
 */
function generateAttentionChime(durationSec = 1.3) {
  const totalSamples = Math.floor(SAMPLE_RATE * durationSec);
  const left = new Float64Array(totalSamples);
  const right = new Float64Array(totalSamples);

  const askNotes = [
    { note: "E5", delay: 0.00, pan: 0.45 },
    { note: "B5", delay: 0.13, pan: 0.55 },
    { note: "E5", delay: 0.42, pan: 0.45 },
    { note: "B5", delay: 0.55, pan: 0.55 }
  ];

  for (const c of askNotes) {
    const f = noteToFreq(c.note);
    const startIdx = Math.floor(c.delay * SAMPLE_RATE);
    const ringSamples = Math.floor(0.7 * SAMPLE_RATE);

    for (let i = 0; i < ringSamples; i++) {
      const idx = startIdx + i;
      if (idx >= totalSamples) break;
      const t = i / SAMPLE_RATE;
      // Shorter ring than the outcome chimes: a tap on the shoulder, not a bell.
      const env = Math.exp(-t * 7.0);

      const sample = (
        sine(f * t) * 0.78 +
        sine(f * 2.0 * t) * 0.16 * Math.exp(-t * 12.0)
      ) * env * 0.28;

      left[idx] += sample * (1.0 - c.pan);
      right[idx] += sample * c.pan;
    }
  }

  return createWavBuffer({ left, right, sampleRate: SAMPLE_RATE });
}

module.exports = {
  generateChime: generateSuccessChime,
  generateSuccessChime,
  generateFailureChime,
  generateAttentionChime
};
