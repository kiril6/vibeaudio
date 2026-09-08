/**
 * Zen Ambient / Deep Meditation Procedural Synth Engine
 * Singing Bowls + Celestial Morphing Pads + Zero Rhythm / Floating Harmony
 */

const {
  SAMPLE_RATE,
  noteToFreq,
  sine,
  createWavBuffer
} = require("./generator");

function generateZenLoop(durationSec = 7.2) {
  const totalSamples = Math.floor(SAMPLE_RATE * durationSec);
  const left = new Float64Array(totalSamples);
  const right = new Float64Array(totalSamples);

  // 1. Slow Celestial Morphing Ambient Pads (D Major / Pentatonic)
  const padChords = [
    { notes: ["D3", "A3", "F#4", "B4"], start: 0.0, dur: 4.0 },
    { notes: ["G2", "D3", "B3", "E4"], start: 3.6, dur: 4.0 }
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

        left[idx] += sL * env * 0.12;
        right[idx] += sR * env * 0.12;
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

  // Soft bowl strikes floating in space
  addSingingBowl(noteToFreq("D4"), 0.4, 0.35);
  addSingingBowl(noteToFreq("A4"), 2.2, 0.65);
  addSingingBowl(noteToFreq("F#4"), 4.0, 0.40);
  addSingingBowl(noteToFreq("D5"), 5.6, 0.60);

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
