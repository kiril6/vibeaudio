/**
 * Fireplace Procedural Synth Engine
 * A warm, narrow noise bed with irregular crackles and the odd pop. No notes,
 * no rhythm, no melody.
 *
 * Told apart from the other noise genres by ear: rain is a bright bed with
 * ringing droplets, ocean swells once per loop, drone holds a tone. This is a
 * dark, still bed with dry, noisy snaps and nothing pitched.
 *
 * Tiers add density and weight: more crackles over a heavier bed, never a beat.
 */

const {
  SAMPLE_RATE,
  makeRng,
  rotate,
  ornamentRng,
  createWavBuffer
} = require("./generator");

// The seed picks the fire, not a tune: how dark the bed is, how busy the wood
// is and how sharp it snaps. `level` evens the three out, since a darker filter
// passes less noise. `hp` stays high enough for laptop speakers to play.
const FIREPLACE_VARIANTS = [
  { hp: 160, lp: 700, crackles: 1.0, snap: 3000, level: 1.0, label: "hearth" },
  { hp: 140, lp: 480, crackles: 0.7, snap: 2200, level: 1.2, label: "embers" },
  { hp: 220, lp: 1000, crackles: 1.3, snap: 4200, level: 0.85, label: "kindling" }
];

const CRACKLE_POOL = 90;
const CRACKLES_BY_TIER = { 1: 0.3, 2: 0.55, 3: 1.0 };
const POP_POOL = 6;
const POPS_BY_TIER = { 1: 1, 2: 3, 3: 6 };
const BED_GAIN = { 1: 0.52, 2: 0.61, 3: 0.72 };

const onePole = (hz) => 1 - Math.exp((-2 * Math.PI * hz) / SAMPLE_RATE);

function generateFireplaceLoop(durationSec = 7.0, tier = 2, seed = 0, bar = 0) {
  const orn = ornamentRng(seed);
  const variant = rotate(orn, FIREPLACE_VARIANTS, bar);

  const totalSamples = Math.floor(SAMPLE_RATE * durationSec);
  const left = new Float64Array(totalSamples);
  const right = new Float64Array(totalSamples);

  // 1. Bed, drawn identically at every tier.
  const noiseRng = makeRng(seed ^ 0x6a09e667);
  const kLp = onePole(variant.lp);
  const kHp = onePole(variant.hp);
  let lpL = 0, lpR = 0, hpL = 0, hpR = 0;
  const bedGain = (BED_GAIN[tier] || BED_GAIN[2]) * variant.level;

  for (let i = 0; i < totalSamples; i++) {
    lpL += kLp * (noiseRng() * 2 - 1 - lpL);
    lpR += kLp * (noiseRng() * 2 - 1 - lpR);
    hpL += kHp * (lpL - hpL);
    hpR += kHp * (lpR - hpR);
    left[i] = (lpL - hpL) * bedGain;
    right[i] = (lpR - hpR) * bedGain;
  }

  // 2. Snaps: short noise bursts, 1 ms up and an exponential decay down to
  //    zero. Each is scaled to its own peak, so how far it stands out of the
  //    bed does not depend on its noise or filter. Each carries its own noise
  //    seed, so it sounds the same whether or not a tier plays the others.
  const burst = ({ at, pan, amp, decay, hz, noise }) => {
    const rng = makeRng(noise);
    const k = onePole(hz);
    const len = Math.floor(decay * 6 * SAMPLE_RATE);
    const attack = 0.001 * SAMPLE_RATE;
    const wave = new Float64Array(len);
    let a = 0, b = 0, top = 0;
    for (let j = 0; j < len; j++) {
      a += k * (rng() * 2 - 1 - a);
      b += 0.25 * k * (a - b);
      wave[j] = (a - b) * Math.min(1, j / attack) * Math.exp(-j / (decay * SAMPLE_RATE)) * (1 - j / len);
      top = Math.max(top, Math.abs(wave[j]));
    }
    for (let j = 0; j < len && at + j < totalSamples; j++) {
      const v = (wave[j] / top) * amp;
      left[at + j] += v * (1 - pan);
      right[at + j] += v * pan;
    }
  };

  // Both pools are drawn in full up front and a tier plays a prefix, so tier 1
  // is tier 3's fire with sounds left out.
  const draw = ornamentRng(seed ^ 0x3243f6a9);
  const entry = (hz, decay, amp) => ({
    at: Math.floor(draw() * totalSamples),
    pan: 0.2 + 0.6 * draw(),
    hz: hz * (0.6 + 0.8 * draw()),
    decay: decay * (0.5 + draw()),
    amp: amp * (0.5 + 0.5 * draw() * draw()),
    noise: Math.floor(draw() * 0x100000000)
  });
  const crackles = Array.from({ length: CRACKLE_POOL }, () => entry(variant.snap, 0.004, 1.05));
  const pops = Array.from({ length: POP_POOL }, () => entry(1500, 0.012, 0.9));

  const count = Math.min(CRACKLE_POOL, Math.round(CRACKLE_POOL * variant.crackles * (CRACKLES_BY_TIER[tier] || 0.55)));
  crackles.slice(0, count).forEach(burst);
  pops.slice(0, POPS_BY_TIER[tier] || POPS_BY_TIER[2]).forEach(burst);

  // Overlapping snaps can stack: round off anything over 0.56, so the stuck
  // heartbeat mixed on top still has headroom.
  const soften = (v) => (Math.abs(v) <= 0.56 ? v : Math.sign(v) * (0.56 + 0.12 * Math.tanh((Math.abs(v) - 0.56) / 0.12)));
  for (let i = 0; i < totalSamples; i++) {
    left[i] = soften(left[i]);
    right[i] = soften(right[i]);
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

module.exports = { generateFireplaceLoop };
