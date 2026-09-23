/**
 * Deep Drone / Filtered Noise Procedural Synth Engine
 * A held fundamental + slow-swept noise bed. No notes, no rhythm, no melody.
 *
 * Every other genre plays something. This one deliberately doesn't: it exists
 * for people who find any melodic line distracting, where the goal is a floor
 * of sound to mask a room rather than music to listen past.
 */

const {
  SAMPLE_RATE,
  noteToFreq,
  sine,
  makeRng,
  rotate,
  ornamentRng,
  createWavBuffer
} = require("./generator");

// A drone has no progression to clash with, so the seed picks its colour
// rather than its harmony: a root, the interval stacked above it, and how
// bright the noise bed sits.
const DRONE_VARIANTS = [
  { root: "D1", partial: 1.5, cutoff: 0.055, label: "deep fifth" },   // D + A
  { root: "A1", partial: 1.5, cutoff: 0.040, label: "dark fifth" },   // A + E
  { root: "E1", partial: 1.335, cutoff: 0.070, label: "open fourth" } // E + A
];

function generateDroneLoop(durationSec = 7.0, tier = 2, seed = 0, bar = 0) {
  // Drawn before any tier gating, so gating a layer can't shift these.
  const orn = ornamentRng(seed);
  const variant = rotate(orn, DRONE_VARIANTS, bar);
  const sweepDepth = 0.55 + orn() * 0.35;
  const breathOffset = orn() * Math.PI * 2;

  const totalSamples = Math.floor(SAMPLE_RATE * durationSec);
  const left = new Float64Array(totalSamples);
  const right = new Float64Array(totalSamples);

  const rootHz = noteToFreq(variant.root);

  // 1. Noise bed, one-pole lowpassed into brown noise and slowly swept.
  //    The sweep runs exactly twice per loop so it lines up at the boundary.
  //    Generated identically at every tier: the rng stream must not depend on
  //    tier, or the same seed would render a different bed as time passes.
  const noiseRng = makeRng(seed ^ 0x9e3779b9);
  let lpL = 0;
  let lpR = 0;
  const sweepHz = 2 / durationSec;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / SAMPLE_RATE;
    // Two uncorrelated streams, so the bed is wide rather than centred.
    const nL = noiseRng() * 2 - 1;
    const nR = noiseRng() * 2 - 1;

    // Cutoff breathes between roughly half and full openness.
    const sweep = 0.5 + 0.5 * sine(sweepHz * t + breathOffset / (2 * Math.PI));
    const k = variant.cutoff * (1 - sweepDepth + sweepDepth * sweep);

    lpL += k * (nL - lpL);
    lpR += k * (nR - lpR);

    // Brown noise is far quieter than white after filtering, so it needs
    // making up - but only to the level the melodic genres sit at. Measured
    // against jazz (peak 0.64, RMS 0.108); these land at 0.43-0.61 / 0.084-0.128.
    const bedGain = tier === 1 ? 1.02 : tier === 3 ? 1.38 : 1.2;
    left[i] += lpL * bedGain;
    right[i] += lpR * bedGain;
  }

  // 2. The fundamental, held for the whole loop. Two voices a few cents apart
  //    beat slowly against each other, which is what keeps a held note from
  //    sounding like a test tone.
  const rootGain = tier === 1 ? 0.072 : tier === 3 ? 0.108 : 0.09;
  for (let i = 0; i < totalSamples; i++) {
    const t = i / SAMPLE_RATE;
    const a = sine(rootHz * 0.9985 * t);
    const b = sine(rootHz * 1.0015 * t);
    const body = (a + b) * 0.5 + sine(rootHz * 2 * t) * 0.12;
    left[i] += body * rootGain;
    right[i] += body * rootGain;
  }

  // 3. Tier 2+: the stacked interval, panned wide. No new notes - the same
  //    drone gains a partial, so escalation is felt as weight, not movement.
  if (tier >= 2) {
    const partialHz = rootHz * variant.partial;
    const gain = tier === 3 ? 0.0675 : 0.0495;
    for (let i = 0; i < totalSamples; i++) {
      const t = i / SAMPLE_RATE;
      left[i] += sine(partialHz * 0.999 * t) * gain;
      right[i] += sine(partialHz * 1.001 * t) * gain;
    }
  }

  // 4. Tier 3 only: a high shimmer that swells once across the loop, the one
  //    thing in this genre that changes over time.
  if (tier === 3) {
    const shimmerHz = rootHz * 6;
    for (let i = 0; i < totalSamples; i++) {
      const t = i / SAMPLE_RATE;
      const swell = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / durationSec);
      const s = sine(shimmerHz * t) * 0.035 * swell;
      left[i] += s;
      right[i] -= s;
    }
  }

  // 5. Wide, slow reverberation - the tail is most of what makes a drone feel
  //    like a space rather than an oscillator.
  const delayL = Math.floor(0.38 * SAMPLE_RATE);
  const delayR = Math.floor(0.51 * SAMPLE_RATE);
  const feedback = 0.34;
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

module.exports = { generateDroneLoop };
