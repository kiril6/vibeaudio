/**
 * Gamelan Procedural Synth Engine
 * Bronze metallophones on a five-note subset of D major (D E F# A B): a slow
 * core melody, then a faster one an octave up, then interlocking parts.
 */

const { pick, rotate, makeRng, ornamentRng } = require("./generator");
const { track } = require("./kit");

// Core melodies, eight beats each.
const VARIANTS = [
  { core: ["D4", "F#4", "E4", "A4", "B4", "A4", "F#4", "E4"], gong: "D3" },
  { core: ["A4", "B4", "A4", "F#4", "E4", "F#4", "E4", "D4"], gong: "D3" },
  { core: ["B4", "A4", "F#4", "A4", "E4", "D4", "E4", "F#4"], gong: "B2" }
];
const SCALE = ["D5", "E5", "F#5", "A5", "B5", "D6"];
// How the faster part decorates each core note: steps up the scale from it.
const FIGURES = [[0, 1], [1, 0], [0, 2], [2, 1], [0, 0]];
const INTERLOCKS = [[0, 1, 0, 1], [0, 0, 1, 1], [1, 0, 1, 0], [0, 1, 1, 0]];
const BRONZE = [[1, 1], [2.01, 0.25], [2.76, 0.3], [5.4, 0.08]];
const BEAT = 1.0;

function generateGamelanLoop(durationSec = 8.0, tier = 2, seed = 0, bar = 0) {
  const variant = rotate(makeRng(seed), VARIANTS, bar);
  const orn = ornamentRng(seed);
  const figures = variant.core.map(() => pick(orn, FIGURES));
  const lock = pick(orn, INTERLOCKS);
  const pans = variant.core.map(() => 0.3 + 0.4 * orn());
  const m = track(durationSec);
  const step = (note, up) => {
    const at = SCALE.findIndex((s) => s.slice(0, -1) === note.slice(0, -1));
    return SCALE[(at + up) % SCALE.length];
  };

  m.note(variant.gong, 0.1, 5.0, 0.09, { partials: [[1, 1], [2.02, 0.4], [2.9, 0.15]], decay: 0.8, attack: 0.02, release: 0.1 });
  variant.core.forEach((note, i) => {
    const at = 0.1 + i * BEAT;
    m.note(note, at, 1.6, 0.085, { pan: pans[i], partials: BRONZE, decay: 3 });
    if (tier >= 2) {
      figures[i].forEach((up, k) => m.note(step(note, up), at + k * BEAT / 2, 0.8, 0.045, { pan: 1 - pans[i], partials: BRONZE, decay: 6 }));
    }
    if (tier >= 3) {
      for (let k = 0; k < 4; k++) {
        m.note(step(note, lock[k] + 2), at + k * BEAT / 4 + BEAT / 8, 0.35, 0.025, { pan: lock[k] ? 0.8 : 0.2, partials: BRONZE, decay: 12 });
      }
    }
  });
  m.echo(0.31, 0.47, 0.2);
  return m.wav({ 1: 2.2, 2: 2.55, 3: 2.76 }[tier] || 2.55, 0.1);
}

module.exports = { generateGamelanLoop };
