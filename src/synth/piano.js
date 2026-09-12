/**
 * Sparse Piano Procedural Synth Engine
 * Single struck notes, long silences, no pulse — the reading-room genre.
 *
 * Every other melodic genre keeps something moving underneath (a bass line, a
 * pad, an arpeggio). This one is mostly rest: two or three notes decaying into
 * a room. Tiers add notes into the existing silence rather than adding layers
 * on top, so escalation never turns it into a piece with a groove.
 */

const {
  SAMPLE_RATE,
  noteToFreq,
  sine,
  makeRng,
  pick,
  ornamentRng,
  createWavBuffer
} = require("./generator");

// Three curated resting points, each a slow two-chord motion with the melody
// pool that belongs to it. As everywhere else, the seed chooses among these -
// it never picks notes freely, which is what keeps it from wandering off key.
const PIANO_VARIANTS = [
  {
    // A minor - the darkest of the three
    bass: ["A1", "F1"],
    notes: ["A3", "C4", "E4", "G4", "A4", "B4", "E5"]
  },
  {
    // C major - open and plain
    bass: ["C2", "G1"],
    notes: ["C4", "E4", "G4", "A4", "C5", "D5", "E5"]
  },
  {
    // D minor 7 moving to G - the one with a little pull to it
    bass: ["D2", "G1"],
    notes: ["D4", "F4", "A4", "C5", "D5", "E5", "A5"]
  }
];

/**
 * A struck string is a fundamental plus partials that die faster the higher
 * they are, and real piano partials sit slightly sharp of whole multiples.
 * Without that inharmonicity the same envelope reads as a bell, not a piano.
 */
const PARTIALS = [
  { mult: 1.0, amp: 1.0, decay: 0.85 },
  { mult: 2.004, amp: 0.36, decay: 1.5 },
  { mult: 3.012, amp: 0.15, decay: 2.3 },
  { mult: 4.028, amp: 0.075, decay: 3.3 },
  { mult: 5.05, amp: 0.035, decay: 4.5 }
];

function generatePianoLoop(durationSec = 7.6, tier = 2, seed = 0) {
  const rng = makeRng(seed);
  const variant = pick(rng, PIANO_VARIANTS);

  const totalSamples = Math.floor(SAMPLE_RATE * durationSec);
  const left = new Float64Array(totalSamples);
  const right = new Float64Array(totalSamples);

  /**
   * One struck note. `velocity` also opens the tone slightly - a harder strike
   * on a real piano is brighter, not just louder - so the loud notes don't
   * sound like the quiet ones turned up.
   */
  function strike(freq, startSec, velocity, pan) {
    const startIdx = Math.floor(startSec * SAMPLE_RATE);
    const ringSamples = Math.floor(5.0 * SAMPLE_RATE);
    const attackSamples = Math.floor(0.004 * SAMPLE_RATE);
    const brightness = 0.55 + velocity * 0.45;

    for (let i = 0; i < ringSamples; i++) {
      const idx = startIdx + i;
      if (idx >= totalSamples) break;
      const t = i / SAMPLE_RATE;

      let sample = 0;
      for (let p = 0; p < PARTIALS.length; p++) {
        const { mult, amp, decay } = PARTIALS[p];
        // Upper partials are scaled by brightness, the fundamental never is.
        const weight = p === 0 ? amp : amp * brightness;
        sample += sine(freq * mult * t) * weight * Math.exp(-t * decay);
      }

      const attack = i < attackSamples ? i / attackSamples : 1.0;
      const out = sample * attack * velocity * 0.59;

      left[idx] += out * (1.0 - pan);
      right[idx] += out * pan;
    }
  }

  // Drawn before any tier gating, in a fixed order, so tier 3 is the same
  // piece as tier 1 with more of it - not a different arrangement.
  const orn = ornamentRng(seed);
  const melody = [0.25, 3.10, 1.55, 5.20, 4.15, 6.40].map((time) => ({
    note: pick(orn, variant.notes),
    time,
    // Hand-placed rubato: never exactly on a grid, never far enough off to
    // sound wrong.
    offset: (orn() - 0.5) * 0.12,
    velocity: 0.55 + orn() * 0.35,
    pan: 0.38 + orn() * 0.24
  }));

  // Tier 1 is two notes in eight seconds. That is the point of the genre.
  const melodyCount = tier === 1 ? 2 : tier === 2 ? 4 : 6;
  for (let i = 0; i < melodyCount; i++) {
    const m = melody[i];
    strike(noteToFreq(m.note), Math.max(0, m.time + m.offset), m.velocity, m.pan);
  }

  // The left hand: one low octave that spells the change, struck softly and
  // left to ring. The second one only arrives once there is enough going on
  // above it to justify a move.
  strike(noteToFreq(variant.bass[0]), 0.05, 0.42, 0.5);
  if (tier >= 2) strike(noteToFreq(variant.bass[1]), 3.85, 0.36, 0.5);

  // Tier 3 adds sustain rather than notes: the una corda pedal held down, so
  // the room itself gets fuller while the playing stays as sparse as before.
  if (tier >= 3) {
    const pedalF = noteToFreq(variant.bass[0]) * 0.5;
    for (let i = 0; i < totalSamples; i++) {
      const t = i / SAMPLE_RATE;
      const swell = 0.55 + 0.45 * Math.sin(2 * Math.PI * 0.09 * t);
      const sample = (sine(pedalF * t) * 0.75 + sine(pedalF * 2 * t) * 0.25) * swell * 0.105;
      left[i] += sample;
      right[i] += sample;
    }
  }

  // Room tone. Longer and quieter than zen's - a piano in a hall, not a bowl
  // in a cave.
  const delayL = Math.floor(0.37 * SAMPLE_RATE);
  const delayR = Math.floor(0.51 * SAMPLE_RATE);
  const feedback = 0.26;

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

module.exports = { generatePianoLoop };
