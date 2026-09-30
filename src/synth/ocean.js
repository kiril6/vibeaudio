/**
 * Ocean Procedural Synth Engine
 * Low-passed noise under a slow swell: the surf rises, breaks and drains once
 * per loop. No notes, no rhythm, no melody.
 *
 * The swell is exactly one cycle per loop (plus an exact second harmonic at
 * tier 2+), so it lines up at the boundary and the loop reads as one
 * continuous tide. Tiers add weight and foam, never a beat.
 */

const {
  SAMPLE_RATE,
  makeRng,
  rotate,
  ornamentRng,
  createWavBuffer
} = require("./generator");

// The seed picks the sea, not a tune: how dark the water is, how deep the
// swell runs, and how sharply it breaks. `level` evens the three out: a darker
// filter passes less noise, so each needs its own make-up to land at the
// level of the other genres (jazz: peak 0.64 / RMS 0.108).
const OCEAN_VARIANTS = [
  { lp: 380, depth: 0.80, shape: 1.6, level: 1.48, label: "slow swell" },
  { lp: 620, depth: 0.65, shape: 1.2, level: 1.03, label: "shore" },
  { lp: 260, depth: 0.90, shape: 2.0, level: 1.97, label: "deep water" }
];

const TIER_GAIN = { 1: 1.0, 2: 1.1, 3: 1.2 };
const onePole = (hz) => 1 - Math.exp((-2 * Math.PI * hz) / SAMPLE_RATE);

function generateOceanLoop(durationSec = 8.0, tier = 2, seed = 0, bar = 0) {
  // Drawn before any tier gating, so gating a layer can't shift these.
  const orn = ornamentRng(seed);
  const variant = rotate(orn, OCEAN_VARIANTS, bar);
  const chopPhase = orn();
  const widthShift = 0.05 + orn() * 0.06;

  const totalSamples = Math.floor(SAMPLE_RATE * durationSec);
  const left = new Float64Array(totalSamples);
  const right = new Float64Array(totalSamples);

  // Noise streams are consumed identically at every tier.
  const noiseRng = makeRng(seed ^ 0x7f4a7c15);
  const foamRng = ornamentRng(seed ^ 0x1b873593);
  const gain = variant.level * (TIER_GAIN[tier] || TIER_GAIN[2]);
  let lpL = 0, lpR = 0, foamL = 0, foamR = 0;

  // One swell cycle per loop; the right ear trails the left for width.
  const swell = (cycles) => {
    const s = 0.5 - 0.5 * Math.cos(2 * Math.PI * cycles);
    return variant.depth * Math.pow(s, variant.shape) + (1 - variant.depth);
  };

  for (let i = 0; i < totalSamples; i++) {
    const c = i / totalSamples;
    let envL = swell(c);
    let envR = swell(c - widthShift);
    // Tier 2+: a second, shorter swell (exactly two cycles, so it tiles too)
    // rides on the first - more water, not more rhythm.
    if (tier >= 2) {
      const chop = (x) => 0.18 * (0.5 - 0.5 * Math.cos(4 * Math.PI * x + chopPhase * 2 * Math.PI));
      envL += chop(c);
      envR += chop(c - widthShift);
    }

    // The surf opens up as the swell builds: louder and brighter together.
    const kL = onePole(variant.lp * (0.45 + 0.55 * envL));
    const kR = onePole(variant.lp * (0.45 + 0.55 * envR));
    lpL += kL * (noiseRng() * 2 - 1 - lpL);
    lpR += kR * (noiseRng() * 2 - 1 - lpR);
    left[i] = lpL * envL * gain;
    right[i] = lpR * envR * gain;

    // Tier 3 only: foam, a high hiss that only exists while the wave breaks.
    if (tier === 3) {
      foamL += 0.35 * (foamRng() * 2 - 1 - foamL);
      foamR += 0.35 * (foamRng() * 2 - 1 - foamR);
      left[i] += foamL * 0.05 * Math.pow(envL, 3);
      right[i] += foamR * 0.05 * Math.pow(envR, 3);
    }
  }

  // Both ends fade to silence, or the loop point clicks every repeat.
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

module.exports = { generateOceanLoop };
