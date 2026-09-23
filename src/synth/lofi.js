/**
 * Lo-Fi Focus Procedural Synth Engine
 * Warm Rhodes Electric Piano (Major 9th chords) + Soothing Kalimba & Stereo Delay
 */

const {
  SAMPLE_RATE,
  noteToFreq,
  makeRng,
  rotate,
  pick,
  ornamentRng,
  createWavBuffer
} = require("./generator");

// Hand-written variants, all diatonic to C major so any pairing stays
// consonant. The seed chooses one; it never invents harmony.
const PROGRESSIONS = [
  [["F2", "A3", "C4", "E4", "G4"], ["C2", "G3", "B3", "D4", "E4"]], // Fmaj9 -> Cmaj9
  [["D2", "F3", "A3", "C4", "E4"], ["G2", "B3", "D4", "F4", "A4"]], // Dm9  -> G11
  [["A2", "C3", "E3", "G3", "B3"], ["F2", "A3", "C4", "E4", "G4"]]  // Am9  -> Fmaj9
];

// Upper-register C-major tones for the kalimba to land on.
const DROP_NOTES = ["C5", "D5", "E5", "G5", "A5", "B5", "C6"];
const SHIMMER_NOTES = ["E6", "G6", "A6", "B6"];

function generateLofiLoop(durationSec = 6.4, tier = 2, seed = 0, bar = 0) {
  const rng = makeRng(seed);
  const progression = rotate(rng, PROGRESSIONS, bar);
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

  const chordVel = tier === 1 ? 0.16 : tier === 3 ? 0.22 : 0.19;
  const half = durationSec / 2;
  addRhodesChord(progression[0], 0.0, half, chordVel);
  addRhodesChord(progression[1], half, half, chordVel);

  // Drawn regardless of tier so every tier ornaments the same piece.
  const orn = ornamentRng(seed);
  const drops = [0.5, 1.2, 1.8, 2.5, 3.7, 4.4, 5.1, 5.8].map((time) => ({
    note: pick(orn, DROP_NOTES),
    time,
    pan: 0.3 + orn() * 0.4
  }));
  const shimmer = [0.8, 2.1, 3.9, 4.9].map((time) => ({
    note: pick(orn, SHIMMER_NOTES),
    time,
    pan: 0.3 + orn() * 0.4
  }));

  // Kalimba drops activate on Tier 2 and Tier 3
  if (tier >= 2) {
    for (const d of drops) {
      addKalimba(d.note, d.time, d.pan, 0.14);
    }
  }

  // Tier 3: Higher octave shimmer drops (richer energy for long prompts)
  if (tier >= 3) {
    for (const s of shimmer) {
      addKalimba(s.note, s.time, s.pan, 0.09);
    }
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
