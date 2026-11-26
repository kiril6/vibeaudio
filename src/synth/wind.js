/**
 * Wind Procedural Synth Engine
 * Noise through a band whose edge drifts slowly, with shallow gusts and, at
 * tier 3, a faint whistle. No notes, no rhythm.
 *
 * Told apart from ocean by how little it moves (ocean swells and drains,
 * this stays within a few dB) and from rain by having no drops. Every slow
 * movement completes whole cycles per loop, so the boundary does not jump.
 */

const { SAMPLE_RATE, makeRng, rotate, ornamentRng, createWavBuffer } = require("./generator");

const VARIANTS = [
  { low: 450, high: 160, drift: 0.35, whistle: 950, level: 1.0, label: "breeze" },
  { low: 800, high: 220, drift: 0.45, whistle: 1250, level: 0.75, label: "gale" },
  { low: 320, high: 140, drift: 0.3, whistle: 720, level: 1.2, label: "eaves" }
];
const BED_GAIN = { 1: 1.0, 2: 1.16, 3: 1.36 };
const onePole = (hz) => 1 - Math.exp((-2 * Math.PI * hz) / SAMPLE_RATE);

function generateWindLoop(durationSec = 8.0, tier = 2, seed = 0, bar = 0) {
  const orn = ornamentRng(seed);
  const variant = rotate(orn, VARIANTS, bar);
  const driftPhase = orn() * 2 * Math.PI;
  const gustPhase = orn() * 2 * Math.PI;
  const total = Math.floor(SAMPLE_RATE * durationSec);
  const out = [new Float64Array(total), new Float64Array(total)];

  // Both noise streams are consumed identically at every tier.
  const noise = makeRng(seed ^ 0x428a2f98);
  const air = makeRng(seed ^ 0x71374491);
  const gain = BED_GAIN[tier] || BED_GAIN[2];
  const state = [0, 1].map(() => ({ lp: 0, lp2: 0, hp: 0, low: 0, band: 0 }));

  for (let i = 0; i < total; i++) {
    const turn = (2 * Math.PI * i) / total;
    for (let c = 0; c < 2; c++) {
      const s = state[c];
      const drift = Math.sin(turn + driftPhase + c * 0.7);
      const gust = 1 + 0.09 * Math.sin(2 * turn + gustPhase + c * 0.5) + (tier >= 2 ? 0.05 * Math.sin(3 * turn + driftPhase) : 0);
      s.lp += onePole(variant.low * (1 + variant.drift * drift)) * (noise() * 2 - 1 - s.lp);
      s.lp2 += onePole(variant.low * 2) * (s.lp - s.lp2);
      s.hp += onePole(variant.high) * (s.lp2 - s.hp);
      let v = (s.lp2 - s.hp) * gain * variant.level * gust * 1.1;

      // A resonant filter on its own noise: breathy, not a held tone.
      const f = 2 * Math.sin((Math.PI * variant.whistle * (1 + 0.12 * drift)) / SAMPLE_RATE);
      s.low += f * s.band;
      s.band += f * (air() * 2 - 1 - s.low - 0.04 * s.band);
      if (tier >= 3) v += s.band * 0.045 * gust;
      out[c][i] = v;
    }
  }

  const fade = Math.floor(0.12 * SAMPLE_RATE);
  for (let i = 0; i < fade; i++) {
    for (const ch of out) {
      ch[i] *= i / fade;
      ch[total - 1 - i] *= i / fade;
    }
  }
  return createWavBuffer({ left: out[0], right: out[1], sampleRate: SAMPLE_RATE });
}

module.exports = { generateWindLoop };
