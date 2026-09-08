/**
 * Lo-Fi Focus Procedural Synth Engine
 * Warm Rhodes Electric Piano (Major 9th chords) + Soothing Kalimba & Stereo Delay
 */

const {
  SAMPLE_RATE,
  noteToFreq,
  createWavBuffer
} = require("./generator");

function generateLofiLoop(durationSec = 6.4) {
  const totalSamples = Math.floor(SAMPLE_RATE * durationSec);
  const left = new Float64Array(totalSamples);
  const right = new Float64Array(totalSamples);

  // Rhodes chord renderer with soft tremolo & harmonic overtones
  function addRhodesChord(chordNotes, startSec, durSec, vel = 0.18) {
    const startIdx = Math.floor(startSec * SAMPLE_RATE);
    const numSamples = Math.floor(durSec * SAMPLE_RATE);

    for (const note of chordNotes) {
      const f = noteToFreq(note);
      for (let i = 0; i < numSamples; i++) {
        const idx = startIdx + i;
        if (idx >= totalSamples) break;
        const t = i / SAMPLE_RATE;

        const attack = Math.min(1.0, t * 35.0);
        const body = Math.exp(-t * 0.95);
        const tine = Math.exp(-t * 8.5);

        // Gentle stereo tremolo (3.5 Hz)
        const tremL = 1.0 + 0.15 * Math.sin(2 * Math.PI * 3.5 * t);
        const tremR = 1.0 + 0.15 * Math.cos(2 * Math.PI * 3.5 * t);

        const sample = (
          Math.sin(2 * Math.PI * f * t) * 0.74 +
          Math.sin(2 * Math.PI * 2.0 * f * t) * 0.22 * body +
          Math.sin(2 * Math.PI * 3.0 * f * t) * 0.08 * tine
        ) * attack * body * vel;

        left[idx] += sample * tremL;
        right[idx] += sample * tremR;
      }
    }
  }

  // Wooden Kalimba bell note renderer
  function addKalimba(note, startSec, pan = 0.5, vel = 0.14) {
    const f = noteToFreq(note);
    const startIdx = Math.floor(startSec * SAMPLE_RATE);
    const numSamples = Math.floor(1.6 * SAMPLE_RATE);

    for (let i = 0; i < numSamples; i++) {
      const idx = startIdx + i;
      if (idx >= totalSamples) break;
      const t = i / SAMPLE_RATE;
      const env = Math.exp(-t * 3.6);
      const strike = Math.exp(-t * 18.0);

      const sample = (
        Math.sin(2 * Math.PI * f * t) * 0.85 +
        Math.sin(2 * Math.PI * 2.76 * f * t) * 0.15 * strike
      ) * env * vel;

      left[idx] += sample * (1.0 - pan);
      right[idx] += sample * pan;
    }
  }

  // Chords: Fmaj9 -> Cmaj9
  addRhodesChord(["F2", "A3", "C4", "E4", "G4"], 0.0, 3.2, 0.19);
  addRhodesChord(["C2", "G3", "B3", "D4", "E4"], 3.2, 3.2, 0.19);

  // Soothing Kalimba drops
  const drops = [
    { note: "E5", time: 0.5, pan: 0.3 },
    { note: "G5", time: 1.2, pan: 0.7 },
    { note: "C6", time: 1.8, pan: 0.4 },
    { note: "B5", time: 2.5, pan: 0.65 },
    { note: "E5", time: 3.7, pan: 0.35 },
    { note: "D5", time: 4.4, pan: 0.65 },
    { note: "G5", time: 5.1, pan: 0.45 },
    { note: "C6", time: 5.8, pan: 0.55 }
  ];

  for (const d of drops) {
    addKalimba(d.note, d.time, d.pan, 0.14);
  }

  // Warm stereo delay feedback
  const delayL = Math.floor(0.24 * SAMPLE_RATE);
  const delayR = Math.floor(0.32 * SAMPLE_RATE);
  const feedback = 0.28;

  for (let i = 0; i < totalSamples; i++) {
    if (i >= delayL) {
      left[i] += left[i - delayL] * feedback;
    }
    if (i >= delayR) {
      right[i] += right[i - delayR] * feedback;
    }
  }

  // Soft master boundary fades for seamless looping
  const fadeLen = Math.floor(0.08 * SAMPLE_RATE);
  for (let i = 0; i < fadeLen; i++) {
    const s = i / fadeLen;
    left[i] *= s;
    right[i] *= s;
    left[totalSamples - 1 - i] *= s;
    right[totalSamples - 1 - i] *= s;
  }

  return createWavBuffer({ left, right, sampleRate: SAMPLE_RATE });
}

module.exports = { generateLofiLoop };
