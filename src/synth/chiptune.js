/**
 * Cozy 8-Bit Chiptune Procedural Synth Engine
 * Filtered/Softened Pulse Lead + Shimmering Arpeggios + NES Triangle Bass
 */

const {
  SAMPLE_RATE,
  noteToFreq,
  softPulse,
  triangle,
  makeRng,
  rotate,
  createWavBuffer
} = require("./generator");

// Each variant pairs a melodic contour with the chord/bass cycle it sits over,
// so the lead always agrees with the arpeggio underneath it.
const VARIANTS = [
  {
    motif: ["E5", "G5", "A5", "C6", "B5", "G5", "E5", "F5", "A5", "C6", "D6", "B5"],
    chords: [["C4", "E4", "G4", "C5"], ["G3", "B3", "D4", "G4"], ["A3", "C4", "E4", "A4"], ["F3", "A3", "C4", "F4"]],
    bass: ["C3", "G2", "A2", "F2"]
  },
  {
    motif: ["A5", "C6", "B5", "A5", "G5", "E5", "G5", "A5", "F5", "A5", "G5", "E5"],
    chords: [["A3", "C4", "E4", "A4"], ["F3", "A3", "C4", "F4"], ["C4", "E4", "G4", "C5"], ["G3", "B3", "D4", "G4"]],
    bass: ["A2", "F2", "C3", "G2"]
  },
  {
    motif: ["G5", "A5", "B5", "D6", "C6", "A5", "G5", "E5", "G5", "B5", "C6", "A5"],
    chords: [["G3", "B3", "D4", "G4"], ["C4", "E4", "G4", "C5"], ["F3", "A3", "C4", "F4"], ["A3", "C4", "E4", "A4"]],
    bass: ["G2", "C3", "F2", "A2"]
  }
];

function generateChiptuneLoop(durationSec = 7.5, tier = 2, seed = 0, bar = 0) {
  const variant = rotate(makeRng(seed), VARIANTS, bar);
  const bpm = 128;
  const secPerBeat = 60.0 / bpm;
  const totalBeats = Math.floor(durationSec / secPerBeat);
  const actualDuration = totalBeats * secPerBeat;
  const totalSamples = Math.floor(SAMPLE_RATE * actualDuration);

  const left = new Float64Array(totalSamples);
  const right = new Float64Array(totalSamples);

  // 1. Melody Events - the rhythm stays fixed, the seed picks the contour.
  const RHYTHM = [
    [0.0, 0.45], [0.5, 0.45], [1.0, 0.45], [1.5, 0.70], [2.5, 0.45],
    [3.0, 0.45], [3.5, 0.45], [4.0, 0.45], [4.5, 0.45], [5.0, 0.45],
    [5.5, 0.70], [6.5, 0.45], [7.0, 0.80], [8.0, 0.45], [8.5, 0.45],
    [9.0, 0.45], [9.5, 0.70], [10.5, 0.45], [11.0, 0.45], [11.5, 0.70],
    [12.5, 0.45], [13.0, 0.45], [13.5, 0.45], [14.0, 0.45], [14.5, 0.85]
  ];
  const melodyEvents = RHYTHM.map(([start, dur], i) => ({
    note: variant.motif[i % variant.motif.length],
    start,
    dur
  }));

  // Melody lead joins at Tier 2 (Tier 1 stays on arpeggio + bass only)
  for (const m of tier >= 2 ? melodyEvents : []) {
    const f = noteToFreq(m.note);
    const startIdx = Math.floor(m.start * secPerBeat * SAMPLE_RATE);
    const numSamples = Math.floor(m.dur * secPerBeat * SAMPLE_RATE);

    // Accumulated, for the same reason as the arpeggio below, plus one of its
    // own: `softPulse((f + vib) * t)` is not vibrato but a phase that jumps
    // when the vibrato switches on at t > 0.15 - by (vib * 0.15) cycles, once
    // per note. Accumulating makes `vib` an actual frequency deviation of
    // +/-3.5Hz, which is what it was meant to be, and the switch-on changes
    // only the rate.
    let leadPhase = 0.0;

    for (let i = 0; i < numSamples; i++) {
      const idx = startIdx + i;
      if (idx >= totalSamples) break;
      const t = i / SAMPLE_RATE;
      const env = Math.min(1.0, t * 75.0) * Math.max(0.0, 1.0 - (t / (m.dur * secPerBeat)));
      const vib = t > 0.15 ? Math.sin(2 * Math.PI * 5.5 * t) * 3.5 : 0.0;
      const sample = softPulse(leadPhase) * env * 0.22;

      left[idx] += sample;
      right[idx] += sample;

      leadPhase += (f + vib) / SAMPLE_RATE;
    }
  }

  // 2. Chords for Retro Arpeggiation
  const chords = variant.chords;
  const arpSpeed = 0.075;

  // The phase is accumulated, not computed as `f * t`.
  //
  // This arpeggio steps to a new note every 75ms and has no envelope at all -
  // it is meant to run continuously. With `softPulse(f * t)`, changing f while
  // t keeps running jumps the phase by (f2 - f1) * t: hundreds of cycles a few
  // seconds in, which lands the waveform on an arbitrary value. That is a
  // click, 13 times a second, with no envelope to hide it - reported as static
  // on 8bit, and at tier 1 every single step over 0.05 full-scale landed
  // exactly on one of these boundaries.
  //
  // Accumulating instead means a new note changes the *rate* the phase
  // advances, never its value, so the waveform stays continuous across the
  // step. It is also how a real oscillator behaves.
  let arpPhase = 0.0;
  let shimmerPhase = 0.0;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / SAMPLE_RATE;
    const beat = Math.floor(t / secPerBeat);
    const chordIdx = Math.floor(beat / 4) % chords.length;
    const chord = chords[chordIdx];
    const noteIdx = Math.floor(t / arpSpeed) % chord.length;
    const f = noteToFreq(chord[noteIdx]);
    const sample = softPulse(arpPhase) * (tier === 1 ? 0.09 : 0.075);

    left[i] += sample * 0.85;
    right[i] += sample * 0.85;

    // Tier 3: octave-up shimmer arpeggio doubling
    if (tier >= 3) {
      const shimmer = softPulse(shimmerPhase) * 0.03;
      left[i] += shimmer * 1.1;
      right[i] += shimmer * 0.9;
    }

    arpPhase += f / SAMPLE_RATE;
    shimmerPhase += (f * 2.0) / SAMPLE_RATE;
  }

  // 3. NES Triangle Bass
  const bassNotes = variant.bass;
  for (let i = 0; i < totalSamples; i++) {
    const t = i / SAMPLE_RATE;
    const beat = Math.floor(t / secPerBeat);
    const chordIdx = Math.floor(beat / 4) % bassNotes.length;
    const f = noteToFreq(bassNotes[chordIdx]);
    const tNote = (t % secPerBeat);
    const env = Math.min(1.0, tNote * 40.0) * Math.max(0.0, 1.0 - Math.pow(tNote / secPerBeat, 0.6));
    const sample = triangle(f * t) * env * 0.24;

    left[i] += sample;
    right[i] += sample;
  }

  // Fade boundaries
  const fadeLen = Math.floor(0.08 * SAMPLE_RATE);
  for (let i = 0; i < fadeLen; i++) {
    const s = i / fadeLen;
    left[i] *= s;
    right[i] *= s;
    left[totalSamples - 1 - i] *= s;
    right[totalSamples - 1 - i] *= s;
  }

  return createWavBuffer({ left, right, sampleRate: SAMPLE_RATE });
}

module.exports = { generateChiptuneLoop };
