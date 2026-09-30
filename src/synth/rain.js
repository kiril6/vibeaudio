/**
 * Rain Procedural Synth Engine
 * A band-passed noise bed with sparse droplet transients on top. No notes, no
 * rhythm, no melody - like `drone`, it is a floor of sound rather than music.
 *
 * Tiers add density, not movement: a heavier bed and more drops falling into
 * the same piece, never a pulse.
 */

const {
  SAMPLE_RATE,
  sine,
  makeRng,
  rotate,
  ornamentRng,
  createWavBuffer
} = require("./generator");

// The seed picks how the rain sounds, not what it plays: where the band sits,
// how many drops land, and how high they ring.
const RAIN_VARIANTS = [
  { hp: 800, lp: 5000, drops: 1.0, pitch: [2200, 4200], label: "steady" },
  { hp: 500, lp: 3600, drops: 0.7, pitch: [1800, 3400], label: "roof" },
  { hp: 1300, lp: 7000, drops: 1.3, pitch: [2800, 5200], label: "window" }
];

const DROP_POOL = 40;
const DROPS_BY_TIER = { 1: 0.25, 2: 0.5, 3: 1.0 };
// Band-passed noise is far hotter than the melodic genres, so this is made
// down to their level (jazz: peak 0.64 / RMS 0.108) rather than up to it.
const BED_GAIN = { 1: 0.27, 2: 0.33, 3: 0.44 };

const onePole = (hz) => 1 - Math.exp((-2 * Math.PI * hz) / SAMPLE_RATE);

function generateRainLoop(durationSec = 7.0, tier = 2, seed = 0, bar = 0) {
  const orn = ornamentRng(seed);
  const variant = rotate(orn, RAIN_VARIANTS, bar);

  const totalSamples = Math.floor(SAMPLE_RATE * durationSec);
  const left = new Float64Array(totalSamples);
  const right = new Float64Array(totalSamples);

  // 1. Bed: white noise through a high-pass and a low-pass. Drawn identically
  //    at every tier, or the same seed would render a different bed as time
  //    passes.
  const noiseRng = makeRng(seed ^ 0x51ed270b);
  const kLp = onePole(variant.lp);
  const kHp = onePole(variant.hp);
  let lpL = 0, lpR = 0, hpL = 0, hpR = 0;
  const bedGain = BED_GAIN[tier] || BED_GAIN[2];

  for (let i = 0; i < totalSamples; i++) {
    lpL += kLp * (noiseRng() * 2 - 1 - lpL);
    lpR += kLp * (noiseRng() * 2 - 1 - lpR);
    hpL += kHp * (lpL - hpL);
    hpR += kHp * (lpR - hpR);
    left[i] += (lpL - hpL) * bedGain;
    right[i] += (lpR - hpR) * bedGain;
  }

  // 2. Droplets. The whole pool is drawn up front, from a stream of its own,
  //    and a tier only chooses how much of it to play - so tier 1 is tier 3's
  //    drops with the rest left out, not a different shower.
  const dropRng = ornamentRng(seed ^ 0x2545f491);
  const pool = Array.from({ length: DROP_POOL }, () => ({
    at: Math.floor(dropRng() * totalSamples),
    hz: variant.pitch[0] + dropRng() * (variant.pitch[1] - variant.pitch[0]),
    pan: dropRng(),
    amp: 0.35 + 0.65 * dropRng() * dropRng()
  }));
  const count = Math.min(DROP_POOL, Math.round(DROP_POOL * variant.drops * (DROPS_BY_TIER[tier] || 0.5)));
  const dropLen = Math.floor(0.045 * SAMPLE_RATE);
  for (const d of pool.slice(0, count)) {
    for (let j = 0; j < dropLen && d.at + j < totalSamples; j++) {
      const t = j / SAMPLE_RATE;
      const v = sine(d.hz * t) * Math.exp(-t / 0.009) * d.amp * 0.11;
      left[d.at + j] += v * (1 - d.pan);
      right[d.at + j] += v * d.pan;
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

module.exports = { generateRainLoop };
