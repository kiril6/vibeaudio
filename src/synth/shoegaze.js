/**
 * Shoegaze Pads Procedural Synth Engine
 * Slow, detuned washes in D major; a melody swells out of them as the turn
 * runs on. No drums.
 */

const { noteToFreq, pick, rotate, makeRng, ornamentRng } = require("./generator");
const { track, invert } = require("./kit");

const VARIANTS = [
  { chords: [["D3", "F#3", "A3", "E4"], ["G3", "B3", "D4", "F#4"]], tones: ["A4", "B4", "D5", "E5", "F#5"] },
  { chords: [["B2", "F#3", "A3", "D4"], ["G2", "D3", "F#3", "B3"]], tones: ["F#4", "A4", "B4", "D5", "E5"] },
  { chords: [["G3", "B3", "D4", "A4"], ["A3", "C#4", "E4", "B4"]], tones: ["B4", "C#5", "D5", "E5", "A5"] }
];
const DETUNES = [0.0025, 0.004, 0.0055, 0.007];
const SWELLS = [0.6, 1.0, 1.5, 2.0];
const TONE = [[1, 1], [2, 0.3], [3, 0.12]];

function generateShoegazeLoop(durationSec = 8.0, tier = 2, seed = 0, bar = 0) {
  const variant = rotate(makeRng(seed), VARIANTS, bar);
  const orn = ornamentRng(seed);
  const detune = pick(orn, DETUNES);
  const swell = pick(orn, SWELLS);
  const voicing = variant.chords.map(() => Math.floor(orn() * 3));
  const melody = [0.4, 2.2, 4.4, 6.0].map((at) => ({ at, note: pick(orn, variant.tones), pan: 0.3 + 0.4 * orn() }));
  const m = track(durationSec);
  const half = durationSec / 2;

  // The two chords crossfade over `swell`, so the pad never drops out. The
  // ends use the loop's own short fade instead.
  variant.chords.forEach((chord, c) => {
    invert(chord, voicing[c]).forEach((n, i) => {
      for (const [d, pan] of [[-detune, 0.25], [detune, 0.75]]) {
        m.note(noteToFreq(n) * (1 + d * (1 + i * 0.2)), c * half, c ? half : half + swell, 0.027, { pan, partials: TONE, attack: c ? swell : 0.15, release: c ? 0.15 : swell });
      }
    });
  });
  if (tier >= 2) {
    for (const x of melody) {
      m.note(x.note, x.at, 1.8, 0.045, { pan: x.pan, partials: TONE, attack: 0.35, release: 0.7, bend: (t) => 1 + 0.004 * Math.sin(2 * Math.PI * 5 * t) });
    }
  }
  if (tier >= 3) {
    for (const x of melody) {
      m.note(x.note, x.at + 1.0, 1.0, 0.018, { pan: 1 - x.pan, partials: [[2, 1], [3, 0.2]], attack: 0.3, release: 0.4 });
    }
  }
  m.echo(0.43, 0.61, 0.35);
  return m.wav(1.35, 0.12);
}

module.exports = { generateShoegazeLoop };
