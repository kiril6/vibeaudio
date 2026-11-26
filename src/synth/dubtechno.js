/**
 * Dub Techno Procedural Synth Engine
 * D minor chord stabs falling away into a long echo, over a muted pulse.
 */

const { pick, rotate, makeRng, ornamentRng } = require("./generator");
const { track, invert } = require("./kit");

const VARIANTS = [
  { chords: [["D4", "F4", "A4"], ["D4", "F4", "A4", "C5"]], bass: "D3" },
  { chords: [["A3", "C4", "E4"], ["G3", "A#3", "D4"]], bass: "A2" },
  { chords: [["F3", "A3", "C4"], ["E3", "G3", "C4"]], bass: "F2" }
];
// Two 8th positions (of 16) where the stab lands.
const HITS = [[1, 7], [3, 10], [2, 11], [5, 13], [1, 9], [3, 8]];
const ECHOES = [[0.75, 1.0], [0.5, 0.75], [0.75, 1.5], [1.0, 0.75]];
const BASS = [[0, 3, 6], [0, 5], [1, 4, 7], [0, 6]];
const STAB_TONE = [[1, 1], [2, 0.4], [3, 0.2], [4, 0.08]];

// The grid starts after the 80 ms fade-in, or every loop's first kick is lost.
const LEAD = 0.12;
const BPM = 118;
const BEAT = 60 / BPM;
// Sixteen beats plus the loop overlap, as in house.
const DUBTECHNO_SECONDS = 16 * BEAT + 0.12;

function generateDubTechnoLoop(durationSec = DUBTECHNO_SECONDS, tier = 2, seed = 0, bar = 0) {
  const variant = rotate(makeRng(seed), VARIANTS, bar);
  const orn = ornamentRng(seed);
  const hits = pick(orn, HITS);
  const echo = pick(orn, ECHOES);
  const voicing = variant.chords.map((c) => Math.floor(orn() * c.length));
  const bass = pick(orn, BASS);
  const m = track(durationSec);

  // Stabs first, so the long echo takes them and not the pulse underneath.
  for (let half = 0; half < 4; half++) {
    const start = half * 4 * BEAT;
    const which = half % 2;
    for (const hit of hits) {
      const at = LEAD + start + hit * BEAT / 2;
      if (at > durationSec - 0.3) continue;
      invert(variant.chords[which], voicing[which]).forEach((n, i) =>
        m.note(n, at, 0.5, 0.07, { pan: 0.4 + 0.08 * i, partials: STAB_TONE, decay: 10, attack: 0.006 }));
    }
  }
  m.echo(BEAT * echo[0], BEAT * echo[1], 0.45);

  for (let eighth = 0; tier >= 2 && eighth * BEAT / 2 < durationSec - 0.3; eighth++) {
    const at = LEAD + eighth * BEAT / 2;
    if (eighth % 2 === 0) {
      m.note(52, at, 0.25, 0.15, { partials: [[1, 1], [3, 0.35], [5, 0.12]], decay: 12, bend: (t) => 1 + 1.6 * Math.exp(-t * 40) });
      m.note(1300, at, 0.012, 0.025, { decay: 300, attack: 0.001, release: 0.004 });
    }
    if (bass.includes(eighth % 8)) m.note(variant.bass, at, BEAT * 0.6, 0.09, { partials: [[1, 1], [2, 0.35]], decay: 2.5, attack: 0.012 });
    if (tier >= 3 && eighth % 2 === 1) {
      m.note(2600, at, 0.04, 0.02, { decay: 120, attack: 0.001, pan: eighth % 4 === 1 ? 0.3 : 0.7 });
      m.note(variant.chords[0][variant.chords[0].length - 1], at + BEAT / 4, 0.18, 0.025, { partials: STAB_TONE, decay: 16 });
    }
  }
  return m.wav(1.7);
}

module.exports = { generateDubTechnoLoop, DUBTECHNO_SECONDS };
