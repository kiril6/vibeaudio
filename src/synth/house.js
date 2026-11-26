/**
 * House Procedural Synth Engine
 * A soft four-on-the-floor in A minor: chord stabs, then kick, offbeat bass
 * and tick, then a pluck arpeggio.
 */

const { pick, rotate, makeRng, ornamentRng } = require("./generator");
const { track, invert } = require("./kit");

const VARIANTS = [
  { chords: [["A3", "C4", "E4", "G4"], ["F3", "A3", "C4", "E4"]], bass: ["A2", "F2"] },
  { chords: [["D4", "F4", "A4", "C5"], ["E4", "G4", "B4", "D5"]], bass: ["D3", "E3"] },
  { chords: [["C4", "E4", "G4", "B4"], ["G3", "B3", "D4", "E4"]], bass: ["C3", "G2"] }
];
// Which of a bar's eight 8ths get a stab.
const STABS = [
  [0, 1, 0, 0, 1, 0, 0, 0],
  [0, 0, 0, 1, 0, 0, 1, 0],
  [0, 1, 0, 1, 0, 0, 0, 0],
  [1, 0, 0, 1, 0, 0, 1, 0],
  [0, 1, 0, 0, 0, 1, 0, 1]
];
// Octave of each offbeat bass note.
const BASS = [[1, 1, 1, 1], [1, 1, 2, 1], [1, 2, 1, 2], [1, 1, 1, 2]];
const ARPS = [[0, 1, 2, 3], [3, 2, 1, 0], [0, 2, 1, 3], [0, 3, 1, 2]];
const STAB_TONE = [[1, 1], [2, 0.35], [3, 0.15]];

// The grid starts after the 80 ms fade-in, or every loop's first kick is lost.
const LEAD = 0.12;
const BPM = 122;
const BEAT = 60 / BPM;
// Sixteen beats, plus the player's 120 ms loop overlap, so the next loop's
// downbeat lands on the grid instead of 120 ms early.
const HOUSE_SECONDS = 16 * BEAT + 0.12;

function generateHouseLoop(durationSec = HOUSE_SECONDS, tier = 2, seed = 0, bar = 0) {
  const variant = rotate(makeRng(seed), VARIANTS, bar);
  const orn = ornamentRng(seed);
  const stabs = pick(orn, STABS);
  const voicing = variant.chords.map(() => Math.floor(orn() * 3));
  const bass = pick(orn, BASS);
  const arp = pick(orn, ARPS);
  const m = track(durationSec);

  for (let eighth = 0; eighth * BEAT / 2 < durationSec - 0.3; eighth++) {
    const at = LEAD + eighth * BEAT / 2;
    const half = Math.floor(eighth / 16) % 2;
    const chord = invert(variant.chords[half], voicing[half]);
    if (stabs[eighth % 8]) {
      chord.forEach((n, i) => m.note(n, at, BEAT * 0.8, 0.05, { pan: 0.35 + 0.1 * i, partials: STAB_TONE, decay: 5, attack: 0.008 }));
    }
    if (tier >= 2) {
      if (eighth % 2 === 0) {
        // Kick: a short falling sine.
        // Upper partials and a beater click: 55 Hz alone is silent on a laptop.
        m.note(55, at, 0.22, 0.17, { partials: [[1, 1], [3, 0.35], [5, 0.15]], decay: 14, bend: (t) => 1 + 2 * Math.exp(-t * 45) });
        m.note(1500, at, 0.012, 0.035, { decay: 300, attack: 0.001, release: 0.004 });
      } else {
        m.note(variant.bass[half], at, BEAT * 0.42, 0.1 * bass[Math.floor(eighth / 2) % 4] ** -0.5, {
          partials: bass[Math.floor(eighth / 2) % 4] === 2 ? [[2, 1], [4, 0.2]] : [[1, 1], [2, 0.5]], decay: 3
        });
        m.note(3200, at, 0.03, 0.018, { decay: 150, attack: 0.001 });
      }
    }
    if (tier >= 3) {
      for (const [k, offset] of [[0, 0], [1, BEAT / 4]]) {
        const n = chord[arp[(eighth * 2 + k) % 4]];
        m.note(n, at + offset, BEAT / 4, 0.03, { pan: k ? 0.7 : 0.3, partials: [[2, 1], [4, 0.2]], decay: 9 });
      }
    }
  }
  m.echo(BEAT * 0.75, BEAT, 0.18);
  return m.wav(1.5);
}

module.exports = { generateHouseLoop, HOUSE_SECONDS };
