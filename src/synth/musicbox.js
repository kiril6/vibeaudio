/**
 * Music Box Procedural Synth Engine
 * A small comb of high tines in C major, unhurried.
 */

const { pick, rotate, makeRng, ornamentRng } = require("./generator");
const { track } = require("./kit");

const VARIANTS = [
  { melody: ["E5", "G5", "C6", "G5", "F5", "A5", "C6", "A5"], chords: [["C5", "E5", "G5"], ["F4", "A4", "C5"]] },
  { melody: ["G5", "E5", "C5", "E5", "D5", "G5", "B5", "G5"], chords: [["C5", "E5", "G5"], ["G4", "B4", "D5"]] },
  { melody: ["A5", "C6", "E6", "C6", "G5", "E5", "C5", "E5"], chords: [["A4", "C5", "E5"], ["C5", "E5", "G5"]] }
];
// Where each of a half-loop's four melody notes sits, in beats.
const RHYTHMS = [[0, 1, 2, 3], [0, 0.75, 2, 3], [0, 1, 1.5, 3], [0, 1, 2, 2.75], [0, 0.5, 2, 3]];
const BROKEN = [[0, 1, 2, 1], [0, 2, 1, 2], [2, 1, 0, 1], [1, 0, 2, 0]];
const TINE = [[1, 1], [3.01, 0.18], [5.4, 0.05]];
const BEAT = 0.9;

function generateMusicBoxLoop(durationSec = 7.6, tier = 2, seed = 0, bar = 0) {
  const variant = rotate(makeRng(seed), VARIANTS, bar);
  const orn = ornamentRng(seed);
  const rhythms = [pick(orn, RHYTHMS), pick(orn, RHYTHMS)];
  const broken = pick(orn, BROKEN);
  // Which melody notes get a grace note from the chord just before them.
  const graces = variant.melody.map(() => orn() < 0.3);
  const pans = variant.melody.map(() => 0.3 + 0.4 * orn());
  const m = track(durationSec);

  variant.melody.forEach((note, i) => {
    const half = Math.floor(i / 4);
    const at = 0.1 + half * 4 * BEAT + rhythms[half][i % 4] * BEAT;
    const chord = variant.chords[half];
    m.note(note, at, 1.5, 0.11, { pan: pans[i], partials: TINE, decay: 3.2, attack: 0.002 });
    if (graces[i]) m.note(chord[2], Math.max(0.05, at - 0.09), 0.5, 0.045, { partials: TINE, decay: 7, attack: 0.002 });
  });
  for (let k = 0; tier >= 2 && k < 16; k++) {
    const chord = variant.chords[Math.floor(k / 8)];
    m.note(chord[broken[k % 4]], 0.1 + k * BEAT / 2 + BEAT / 4, 1.0, 0.045, { pan: k % 2 ? 0.65 : 0.35, partials: TINE, decay: 4.5, attack: 0.002 });
  }
  for (let i = 0; tier >= 3 && i < 8; i++) {
    const chord = variant.chords[Math.floor(i / 4)];
    const high = chord[(i + broken[0]) % 3].replace(/\d/, (d) => Number(d) + 1);
    m.note(high, 0.1 + i * BEAT + BEAT / 2, 0.8, 0.028, { pan: 1 - pans[i], partials: TINE, decay: 6, attack: 0.002 });
  }
  m.echo(0.29, 0.41, 0.22);
  return m.wav(2);
}

module.exports = { generateMusicBoxLoop };
