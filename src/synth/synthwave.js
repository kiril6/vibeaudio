/**
 * Chill Synthwave / Cyberpunk Procedural Synth Engine
 * Analog Chorused Pads (Dmin -> Bbmaj7 -> Cmaj) + Pulsing 80s Bassline + Shimmering Arp
 */

const {
  SAMPLE_RATE,
  noteToFreq,
  analogSaw,
  triangle,
  makeRng,
  rotate,
  pick,
  ornamentRng,
  pluckEnv,
  createWavBuffer
} = require("./generator");

// Three progressions in D minor, each paired with the arpeggio figures that
// sit on top of it (index 0 for tier 2, index 1 for the busier tier 3).
//
// `pads` holds three hand-written voicings of each step's chord - its own
// tones, inverted or spread (one Bbmaj7 voicing leaves out the 7th) - and the
// seed picks one per step (#4).
// Index 0 is the original voicing.
const PROGRESSIONS = [
  {
    steps: [
      { pads: [["D3", "F3", "A3", "D4"], ["F3", "A3", "D4", "F4"], ["D3", "A3", "D4", "F4"]], bass: "D2" },
      { pads: [["A#2", "F3", "A3", "D4"], ["A#2", "D3", "F3", "A3"], ["D3", "F3", "A#3", "D4"]], bass: "A#1" },
      { pads: [["C3", "G3", "C4", "E4"], ["E3", "G3", "C4", "E4"], ["G3", "C4", "E4", "G4"]], bass: "C2" }
    ],
    arps: [
      ["D5", "F5", "A5", "C6", "D6", "A5", "F5", "E5"],
      ["D5", "A5", "F5", "C6", "D6", "E6", "A5", "F5"]
    ]
  },
  {
    steps: [
      { pads: [["A2", "E3", "A3", "C4"], ["C3", "E3", "A3", "C4"], ["E3", "A3", "C4", "E4"]], bass: "A1" },
      { pads: [["F3", "A3", "C4", "F4"], ["C3", "F3", "A3", "C4"], ["A3", "C4", "F4", "A4"]], bass: "F2" },
      { pads: [["G3", "A#3", "D4", "G4"], ["D3", "G3", "A#3", "D4"], ["G3", "D4", "G4", "A#4"]], bass: "G2" }
    ],
    arps: [
      ["A4", "C5", "E5", "A5", "G5", "E5", "C5", "D5"],
      ["A4", "E5", "C5", "A5", "G5", "D6", "E5", "C5"]
    ]
  },
  {
    steps: [
      { pads: [["F3", "A3", "C4", "F4"], ["C3", "F3", "A3", "C4"], ["A3", "C4", "F4", "A4"]], bass: "F2" },
      { pads: [["C3", "G3", "C4", "E4"], ["E3", "G3", "C4", "E4"], ["G3", "C4", "E4", "G4"]], bass: "C2" },
      { pads: [["D3", "F3", "A3", "D4"], ["F3", "A3", "D4", "F4"], ["D3", "A3", "D4", "F4"]], bass: "D2" }
    ],
    arps: [
      ["F5", "A5", "C6", "A5", "D6", "C6", "A5", "G5"],
      ["F5", "C6", "A5", "D6", "E6", "C6", "A5", "F5"]
    ]
  }
];

// Octave figures for the 8th-note bass, one entry per 8th: 0 the root, 1 the
// root an octave up. Octaves only, so no figure can leave the chord.
const BASS_FIGURES = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 1, 0, 1, 0, 1, 0, 1],
  [0, 0, 0, 1, 0, 0, 0, 1],
  [0, 0, 1, 0, 0, 0, 1, 0]
];

function generateSynthwaveLoop(durationSec = 6.8, tier = 2, seed = 0, bar = 0) {
  const variant = rotate(makeRng(seed), PROGRESSIONS, bar);
  const progression = variant.steps;

  // Ornaments (#4): without them the seed picked a progression and nothing
  // else, so every project on synthwave played one of three arrangements.
  // Drawn regardless of tier, in this order, so every tier is the same piece.
  // The pads sound at every tier and share `orn`; the bass figure and the arp
  // offset only sound from tier 2, so they have a stream of their own.
  const orn = ornamentRng(seed);
  const voicings = progression.map((step) => pick(orn, step.pads));
  const gated = ornamentRng(seed ^ 0x27d4eb2f);
  const bassFigure = pick(gated, BASS_FIGURES);
  // Where in its figure the arp starts: the same notes in the same order, so
  // it agrees with the progression whatever the offset.
  const arpOffset = Math.floor(gated() * 8);
  const arps = variant.arps.map((figure) => figure.map((_, i) => figure[(i + arpOffset) % figure.length]));
  const totalSamples = Math.floor(SAMPLE_RATE * durationSec);
  const left = new Float64Array(totalSamples);
  const right = new Float64Array(totalSamples);

  // Analog chorused pad renderer
  function addPadChord(chordNotes, startSec, durSec, vel = 0.15) {
    const startIdx = Math.floor(startSec * SAMPLE_RATE);
    const numSamples = Math.floor(durSec * SAMPLE_RATE);

    for (const note of chordNotes) {
      const f = noteToFreq(note);
      for (let i = 0; i < numSamples; i++) {
        const idx = startIdx + i;
        if (idx >= totalSamples) break;
        const t = i / SAMPLE_RATE;

        const attack = Math.min(1.0, t * 2.5);
        const rel = t > durSec - 0.35 ? Math.min(1.0, (durSec - t) * 3.0) : 1.0;
        const env = attack * rel;

        // Dual detuned oscillators for lush analog chorus
        const detune = 0.0035;
        const oscL = analogSaw(f * (1.0 - detune) * t);
        const oscR = analogSaw(f * (1.0 + detune) * t);

        left[idx] += oscL * env * vel;
        right[idx] += oscR * env * vel;
      }
    }
  }

  // Pulsing 8th-note synthwave bass
  function addBass(bassNote, startSec, durSec, bpm = 110) {
    const startIdx = Math.floor(startSec * SAMPLE_RATE);
    const numSamples = Math.floor(durSec * SAMPLE_RATE);
    const f = noteToFreq(bassNote);
    const stepSec = 60.0 / bpm / 2.0;

    for (let i = 0; i < numSamples; i++) {
      const idx = startIdx + i;
      if (idx >= totalSamples) break;
      const t = i / SAMPLE_RATE;
      const tNote = t % stepSec;
      const env = pluckEnv(tNote, stepSec, 8.0);
      // The octave changes only on a step boundary, where the pluck is at zero.
      const fStep = bassFigure[Math.floor(t / stepSec) % bassFigure.length] ? f * 2 : f;
      const sample = (triangle(fStep * t) * 0.7 + analogSaw(fStep * t) * 0.3) * env * 0.20;

      left[idx] += sample;
      right[idx] += sample;
    }
  }

  // Shimmering 16th-note arpeggiator lead
  function addArp(leadNotes, startSec, durSec) {
    const stepSec = 0.136;
    const startIdx = Math.floor(startSec * SAMPLE_RATE);
    const numSamples = Math.floor(durSec * SAMPLE_RATE);

    for (let i = 0; i < numSamples; i++) {
      const idx = startIdx + i;
      if (idx >= totalSamples) break;
      const t = i / SAMPLE_RATE;
      const noteIdx = Math.floor(t / stepSec) % leadNotes.length;
      const f = noteToFreq(leadNotes[noteIdx]);
      const tNote = t % stepSec;
      const env = pluckEnv(tNote, stepSec, 6.5);
      const sample = analogSaw(f * t) * env * 0.085;

      const pan = 0.5 + 0.35 * Math.sin(2 * Math.PI * 1.5 * t);
      left[idx] += sample * (1.0 - pan);
      right[idx] += sample * pan;
    }
  }

  const padVel = tier === 1 ? 0.18 : 0.15;
  const slots = [
    { start: 0.0, dur: 3.2 },
    { start: 3.2, dur: 1.8 },
    { start: 5.0, dur: 1.8 }
  ];

  progression.forEach((step, i) => {
    addPadChord(voicings[i], slots[i].start, slots[i].dur, padVel);
    if (tier >= 2) addBass(step.bass, slots[i].start, slots[i].dur);
  });

  if (tier >= 2) {
    addArp(tier === 3 ? arps[1] : arps[0], 0.6, 6.0);
  }

  // Stereo ping-pong delay
  const delayL = Math.floor(0.27 * SAMPLE_RATE);
  const delayR = Math.floor(0.36 * SAMPLE_RATE);
  const feedback = 0.28;

  for (let i = 0; i < totalSamples; i++) {
    if (i >= delayL) left[i] += right[i - delayL] * feedback;
    if (i >= delayR) right[i] += left[i - delayR] * feedback;
  }

  // Soft boundary fade
  const fadeLen = Math.floor(0.08 * SAMPLE_RATE);
  for (let i = 0; i < fadeLen; i++) {
    const s = i / fadeLen;
    left[i] *= s;
    right[i] *= s;
    left[totalSamples - 1 - i] *= s;
    right[totalSamples - 1 - i] *= s;
  }

  // The voicings and the octave bass raised the loudest render's peak by up to
  // 0.08 (#4); this brings every tier back to or under its old peak and RMS.
  for (let i = 0; i < totalSamples; i++) {
    left[i] *= 0.90;
    right[i] *= 0.90;
  }

  return createWavBuffer({ left, right, sampleRate: SAMPLE_RATE });
}

module.exports = { generateSynthwaveLoop };
