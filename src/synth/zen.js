/**
 * Zen Ambient / Deep Meditation Procedural Synth Engine
 * Singing Bowls + Celestial Morphing Pads + Zero Rhythm / Floating Harmony
 */

const {
  SAMPLE_RATE,
  noteToFreq,
  sine,
  makeRng,
  rotate,
  pick,
  ornamentRng,
  createWavBuffer
} = require("./generator");

// Curated pad pairs, all within D major so any choice stays consonant with
// the bowls below.
const PAD_PAIRS = [
  [["D3", "A3", "F#4", "B4"], ["G2", "D3", "B3", "E4"]],
  [["A2", "E3", "C#4", "F#4"], ["D3", "A3", "F#4", "B4"]],
  [["B2", "F#3", "D4", "A4"], ["G2", "D3", "B3", "E4"]]
];

// D major pentatonic - the safest set to strike a bowl on over any pad above.
const BOWL_NOTES = ["D4", "E4", "F#4", "A4", "B4", "D5"];

function generateZenLoop(durationSec = 7.2, tier = 2, seed = 0, bar = 0) {
  const rng = makeRng(seed);
  const pads = rotate(rng, PAD_PAIRS, bar);

  const totalSamples = Math.floor(SAMPLE_RATE * durationSec);
  const left = new Float64Array(totalSamples);
  const right = new Float64Array(totalSamples);
  const padVel = tier === 1 ? 0.10 : tier === 3 ? 0.14 : 0.12;

  // 1. Slow Celestial Morphing Ambient Pads (D Major / Pentatonic)
  const padChords = [
    { notes: pads[0], start: 0.0, dur: 4.0 },
    { notes: pads[1], start: 3.6, dur: 4.0 }
  ];

  for (const chord of padChords) {
    const startIdx = Math.floor(chord.start * SAMPLE_RATE);
    const numSamples = Math.floor(chord.dur * SAMPLE_RATE);

    for (const note of chord.notes) {
      const f = noteToFreq(note);
      for (let i = 0; i < numSamples; i++) {
        const idx = startIdx + i;
        if (idx >= totalSamples) break;
        const t = i / SAMPLE_RATE;

        // Very slow ambient swell attack and release
        const attack = Math.min(1.0, t * 0.9);
        const rel = t > chord.dur - 1.2 ? Math.min(1.0, (chord.dur - t) / 1.2) : 1.0;
        const env = attack * rel;

        // Dual detuned pure sines for warm chorus drift
        const sL = sine(f * 0.998 * t);
        const sR = sine(f * 1.002 * t);

        left[idx] += sL * env * padVel;
        right[idx] += sR * env * padVel;
      }
    }
  }

  // 2. Tibetan Singing Bowl Simulation (Resonant harmonic overtones with natural acoustic beating)
  function addSingingBowl(baseFreq, startSec, pan = 0.5) {
    const startIdx = Math.floor(startSec * SAMPLE_RATE);
    const ringSamples = Math.floor(4.5 * SAMPLE_RATE);

    for (let i = 0; i < ringSamples; i++) {
      const idx = startIdx + i;
      if (idx >= totalSamples) break;
      const t = i / SAMPLE_RATE;
      const env = Math.exp(-t * 0.85);

      // Tibetan bowls produce fundamental + 2.76x overtone with a 2Hz beat
      const beat = 1.0 + 0.15 * Math.sin(2 * Math.PI * 2.1 * t);
      const f1 = baseFreq;
      const f2 = baseFreq * 2.76;
      const f3 = baseFreq * 5.4;

      const sample = (
        sine(f1 * t) * 0.70 * beat +
        sine(f2 * t) * 0.22 * Math.exp(-t * 1.5) +
        sine(f3 * t) * 0.08 * Math.exp(-t * 3.5)
      ) * env * 0.16;

      left[idx] += sample * (1.0 - pan);
      right[idx] += sample * pan;
    }
  }

  // Drawn regardless of tier so every tier ornaments the same piece.
  const orn = ornamentRng(seed);
  const strikes = [0.4, 4.0, 2.2, 5.6].map((time) => ({
    note: pick(orn, BOWL_NOTES),
    time,
    pan: 0.35 + orn() * 0.3
  }));

  // Tier 1 floats on sparse bowls; higher tiers fill the space
  addSingingBowl(noteToFreq(strikes[0].note), strikes[0].time, strikes[0].pan);
  addSingingBowl(noteToFreq(strikes[1].note), strikes[1].time, strikes[1].pan);

  if (tier >= 2) {
    addSingingBowl(noteToFreq(strikes[2].note), strikes[2].time, strikes[2].pan);
    addSingingBowl(noteToFreq(strikes[3].note), strikes[3].time, strikes[3].pan);
  }

  // Tier 3: deep sustained drone underneath for long prompts
  if (tier >= 3) {
    const droneF = noteToFreq("D2");
    for (let i = 0; i < totalSamples; i++) {
      const t = i / SAMPLE_RATE;
      const swell = 0.6 + 0.4 * Math.sin(2 * Math.PI * 0.07 * t);
      const sample = (sine(droneF * t) * 0.8 + sine(droneF * 2.0 * t) * 0.2) * swell * 0.07;
      left[i] += sample;
      right[i] += sample;
    }
  }

  // 3. Deep Stereo Spatial Reverberation
  const delayL = Math.floor(0.42 * SAMPLE_RATE);
  const delayR = Math.floor(0.56 * SAMPLE_RATE);
  const feedback = 0.32;

  for (let i = 0; i < totalSamples; i++) {
    if (i >= delayL) left[i] += right[i - delayL] * feedback;
    if (i >= delayR) right[i] += left[i - delayR] * feedback;
  }

  // Seamless crossfade boundary
  const fadeLen = Math.floor(0.12 * SAMPLE_RATE);
  for (let i = 0; i < fadeLen; i++) {
    const s = i / fadeLen;
    left[i] *= s;
    right[i] *= s;
    left[totalSamples - 1 - i] *= s;
    right[totalSamples - 1 - i] *= s;
  }

  return createWavBuffer({ left, right, sampleRate: SAMPLE_RATE });
}

module.exports = { generateZenLoop };
