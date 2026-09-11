/**
 * Midnight Jazz / Coffee Shop Bossa Procedural Synth Engine
 * Classic ii-V-I Jazz Chords + Walking Upright Bass + Brushed Swing Cymbal
 */

const {
  SAMPLE_RATE,
  noteToFreq,
  sine,
  triangle,
  softPulse,
  makeRng,
  pick,
  ornamentRng,
  createWavBuffer
} = require("./generator");

// Three standard turnarounds in C, each with its own walking bass line so the
// bass always spells the changes it is under.
const CHANGES = [
  {
    // ii - V - I - VI7  (Dm9 - G13 - Cmaj9 - A7b9)
    chords: [["F3", "A3", "C4", "E4"], ["F3", "B3", "E4", "A4"], ["E3", "G3", "B3", "D4"], ["G3", "A#3", "C#4", "F4"]],
    bass: ["D2", "F2", "F#2", "G2", "B2", "C3", "B2", "A2"]
  },
  {
    // I - VI - ii - V  (Cmaj9 - Am9 - Dm9 - G13)
    chords: [["E3", "G3", "B3", "D4"], ["E3", "G3", "C4", "B3"], ["F3", "A3", "C4", "E4"], ["F3", "B3", "E4", "A4"]],
    bass: ["C2", "E2", "A2", "G2", "D2", "F2", "G2", "B2"]
  },
  {
    // iii - VI - ii - V  (Em9 - Am9 - Dm9 - G13)
    chords: [["G3", "B3", "D4", "F#4"], ["E3", "G3", "C4", "B3"], ["F3", "A3", "C4", "E4"], ["F3", "B3", "E4", "A4"]],
    bass: ["E2", "G2", "A2", "C3", "D2", "F2", "G2", "B2"]
  }
];

const STAB_NOTES = ["D5", "E5", "G5", "A5", "B5"];

function generateJazzLoop(durationSec = 6.26, tier = 2, seed = 0) {
  const rng = makeRng(seed);
  const changes = pick(rng, CHANGES);
  const orn = ornamentRng(seed);
  const bpm = 92;
  const secPerBeat = 60.0 / bpm;
  const totalBeats = Math.floor(durationSec / secPerBeat);
  const actualDuration = totalBeats * secPerBeat;
  const totalSamples = Math.floor(SAMPLE_RATE * actualDuration);

  const left = new Float64Array(totalSamples);
  const right = new Float64Array(totalSamples);

  // 1. Jazz Piano Comping (ii-V-I-VI Progression: Dmin9 -> G13 -> Cmaj9 -> A7b9)
  const comping = [
    { startBeat: 0.5, durBeats: 1.2 },
    { startBeat: 2.0, durBeats: 1.5 },
    { startBeat: 4.5, durBeats: 1.2 },
    { startBeat: 6.0, durBeats: 1.5 }
  ];
  const jazzChords = comping.map((slot, i) => ({ ...slot, notes: changes.chords[i] }));

  for (const chord of jazzChords) {
    const startIdx = Math.floor(chord.startBeat * secPerBeat * SAMPLE_RATE);
    const numSamples = Math.floor(chord.durBeats * secPerBeat * SAMPLE_RATE);

    for (const note of chord.notes) {
      const f = noteToFreq(note);
      for (let i = 0; i < numSamples; i++) {
        const idx = startIdx + i;
        if (idx >= totalSamples) break;
        const t = i / SAMPLE_RATE;
        const attack = Math.min(1.0, t * 45.0);
        const body = Math.exp(-t * 1.2);
        // Soft warm jazz piano tone
        const sample = (
          sine(f * t) * 0.75 +
          sine(f * 2.0 * t) * 0.20 * body +
          sine(f * 3.0 * t) * 0.05 * Math.exp(-t * 6.0)
        ) * attack * body * (tier === 1 ? 0.13 : tier === 3 ? 0.18 : 0.16);

        left[idx] += sample * 0.85;
        right[idx] += sample * 1.15;
      }
    }
  }

  // 2. Walking Upright Acoustic Bass (Quarter notes with wood tone) - joins at Tier 2
  const walkingBass = changes.bass;
  for (let b = 0; tier >= 2 && b < walkingBass.length && b < totalBeats; b++) {
    const f = noteToFreq(walkingBass[b]);
    const startIdx = Math.floor(b * secPerBeat * SAMPLE_RATE);
    const numSamples = Math.floor(secPerBeat * 0.95 * SAMPLE_RATE);

    for (let i = 0; i < numSamples; i++) {
      const idx = startIdx + i;
      if (idx >= totalSamples) break;
      const t = i / SAMPLE_RATE;
      const attack = Math.min(1.0, t * 50.0);
      const env = Math.exp(-t * 3.2);

      // Acoustic upright bass: fundamental sine + warm triangle pluck
      const sample = (sine(f * t) * 0.70 + triangle(f * t) * 0.30) * attack * env * 0.28;
      left[idx] += sample;
      right[idx] += sample;
    }
  }

  // 3. Brushed Jazz Swing Cymbal Pattern (Spang-a-lang ride cymbal swing) - joins at Tier 2
  for (let i = 0; tier >= 2 && i < totalSamples; i++) {
    const t = i / SAMPLE_RATE;
    const beatPos = (t / secPerBeat) % 1.0;
    // Classic jazz triplet swing tap (on the beat and on beatPos ~ 0.66)
    const isBeat = beatPos < 0.04;
    const isSwingTap = beatPos > 0.64 && beatPos < 0.68;

    if (isBeat || isSwingTap) {
      const relT = isBeat ? beatPos : beatPos - 0.64;
      const env = Math.max(0.0, 1.0 - relT / 0.04);
      const n = (orn() * 2.0 - 1.0) * env * (isBeat ? 0.04 : 0.025);
      left[i] += n * 0.7;
      right[i] += n * 1.2;
    }
  }

  // Tier 3: sparse upper-register piano stabs for long prompts
  if (tier >= 3) {
    const stabRng = ornamentRng(seed ^ 0x5f356495);
    const stabs = [1.7, 3.4, 5.6, 7.1].map((beat) => ({ note: pick(stabRng, STAB_NOTES), beat }));

    for (const stab of stabs) {
      const f = noteToFreq(stab.note);
      const startIdx = Math.floor(stab.beat * secPerBeat * SAMPLE_RATE);
      const numSamples = Math.floor(0.9 * secPerBeat * SAMPLE_RATE);

      for (let i = 0; i < numSamples; i++) {
        const idx = startIdx + i;
        if (idx >= totalSamples) break;
        const t = i / SAMPLE_RATE;
        const env = Math.min(1.0, t * 60.0) * Math.exp(-t * 2.6);
        const sample = (sine(f * t) * 0.8 + sine(f * 2.0 * t) * 0.2) * env * 0.075;

        left[idx] += sample * 1.1;
        right[idx] += sample * 0.9;
      }
    }
  }

  // 4. Warm Room Stereo Reverb
  const delayL = Math.floor(0.22 * SAMPLE_RATE);
  const delayR = Math.floor(0.31 * SAMPLE_RATE);
  const feedback = 0.24;

  for (let i = 0; i < totalSamples; i++) {
    if (i >= delayL) left[i] += right[i - delayL] * feedback;
    if (i >= delayR) right[i] += left[i - delayR] * feedback;
  }

  // Boundary fade
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

module.exports = { generateJazzLoop };
