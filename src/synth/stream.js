/**
 * Stream Procedural Synth Engine
 * Running water: a soft bed and a great many very short bubbles, each rising
 * a little in pitch. No notes, no rhythm.
 *
 * Told apart from rain by the bubbles: lower, far denser, and gurgling
 * upwards where rain's droplets are high, sparse, single pings.
 */

const { SAMPLE_RATE, makeRng, rotate, ornamentRng, createWavBuffer } = require("./generator");

const VARIANTS = [
  { low: 2600, high: 350, pitch: [450, 1100], bubbles: 1.0, level: 1.0, label: "brook" },
  { low: 1800, high: 260, pitch: [320, 800], bubbles: 0.8, level: 1.15, label: "creek" },
  { low: 3600, high: 500, pitch: [650, 1500], bubbles: 1.2, level: 0.85, label: "rill" }
];
const POOL = 600;
const BY_TIER = { 1: 0.3, 2: 0.55, 3: 0.8 };
const BED_GAIN = { 1: 0.21, 2: 0.26, 3: 0.33 };
const onePole = (hz) => 1 - Math.exp((-2 * Math.PI * hz) / SAMPLE_RATE);

function generateStreamLoop(durationSec = 8.0, tier = 2, seed = 0, bar = 0) {
  const variant = rotate(ornamentRng(seed), VARIANTS, bar);
  const total = Math.floor(SAMPLE_RATE * durationSec);
  const left = new Float64Array(total);
  const right = new Float64Array(total);

  const noise = makeRng(seed ^ 0x5be0cd19);
  const gain = (BED_GAIN[tier] || BED_GAIN[2]) * variant.level;
  const kl = onePole(variant.low);
  const kh = onePole(variant.high);
  let l = 0, r = 0, hl = 0, hr = 0;
  for (let i = 0; i < total; i++) {
    l += kl * (noise() * 2 - 1 - l);
    r += kl * (noise() * 2 - 1 - r);
    hl += kh * (l - hl);
    hr += kh * (r - hr);
    left[i] = (l - hl) * gain;
    right[i] = (r - hr) * gain;
  }

  // The whole pool is drawn up front and a tier plays a prefix of it.
  const draw = ornamentRng(seed ^ 0x1f83d9ab);
  const pool = Array.from({ length: POOL }, (_, n) => ({
    // Golden-ratio spacing, jittered: every prefix a tier plays stays even,
    // so the water does not surge and thin out across the loop.
    at: Math.floor(((n * 0.6180339887 + 0.01 * draw()) % 1) * total),
    hz: variant.pitch[0] + draw() * (variant.pitch[1] - variant.pitch[0]),
    len: Math.floor((0.012 + 0.028 * draw()) * SAMPLE_RATE),
    pan: 0.15 + 0.7 * draw(),
    amp: 0.16 + 0.14 * draw()
  }));
  const count = Math.min(POOL, Math.round(POOL * variant.bubbles * (BY_TIER[tier] || BY_TIER[2])));
  for (const b of pool.slice(0, count)) {
    let phase = 0;
    for (let j = 0; j < b.len && b.at + j < total; j++) {
      const x = j / b.len;
      phase += (b.hz * (1 + 0.6 * x)) / SAMPLE_RATE;
      const v = Math.sin(2 * Math.PI * phase) * Math.sin(Math.PI * x) ** 2 * b.amp;
      left[b.at + j] += v * (1 - b.pan);
      right[b.at + j] += v * b.pan;
    }
  }

  const fade = Math.floor(0.12 * SAMPLE_RATE);
  for (let i = 0; i < fade; i++) {
    const s = i / fade;
    left[i] *= s;
    right[i] *= s;
    left[total - 1 - i] *= s;
    right[total - 1 - i] *= s;
  }
  return createWavBuffer({ left, right, sampleRate: SAMPLE_RATE });
}

module.exports = { generateStreamLoop };
