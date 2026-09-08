/**
 * Cozy 8-Bit Chiptune Procedural Synth Engine
 * Filtered/Softened Pulse Lead + Shimmering Arpeggios + NES Triangle Bass
 */

const {
  SAMPLE_RATE,
  noteToFreq,
  softPulse,
  triangle,
  createWavBuffer
} = require("./generator");

function generateChiptuneLoop(durationSec = 7.5) {
  const bpm = 128;
  const secPerBeat = 60.0 / bpm;
  const totalBeats = Math.floor(durationSec / secPerBeat);
  const actualDuration = totalBeats * secPerBeat;
  const totalSamples = Math.floor(SAMPLE_RATE * actualDuration);

  const left = new Float64Array(totalSamples);
  const right = new Float64Array(totalSamples);

  // 1. Melody Events (note, startBeat, durBeats)
  const melodyEvents = [
    { note: "E5", start: 0.0, dur: 0.45 },
    { note: "G5", start: 0.5, dur: 0.45 },
    { note: "A5", start: 1.0, dur: 0.45 },
    { note: "C6", start: 1.5, dur: 0.70 },
    { note: "B5", start: 2.5, dur: 0.45 },
    { note: "G5", start: 3.0, dur: 0.45 },
    { note: "E5", start: 3.5, dur: 0.45 },
    { note: "F5", start: 4.0, dur: 0.45 },
    { note: "A5", start: 4.5, dur: 0.45 },
    { note: "C6", start: 5.0, dur: 0.45 },
    { note: "D6", start: 5.5, dur: 0.70 },
    { note: "B5", start: 6.5, dur: 0.45 },
    { note: "C6", start: 7.0, dur: 0.80 },
    { note: "G5", start: 8.0, dur: 0.45 },
    { note: "E5", start: 8.5, dur: 0.45 },
    { note: "F5", start: 9.0, dur: 0.45 },
    { note: "A5", start: 9.5, dur: 0.70 },
    { note: "G5", start: 10.5, dur: 0.45 },
    { note: "D5", start: 11.0, dur: 0.45 },
    { note: "C5", start: 11.5, dur: 0.70 },
    { note: "E5", start: 12.5, dur: 0.45 },
    { note: "D5", start: 13.0, dur: 0.45 },
    { note: "C5", start: 13.5, dur: 0.45 },
    { note: "B4", start: 14.0, dur: 0.45 },
    { note: "C5", start: 14.5, dur: 0.85 }
  ];

  for (const m of melodyEvents) {
    const f = noteToFreq(m.note);
    const startIdx = Math.floor(m.start * secPerBeat * SAMPLE_RATE);
    const numSamples = Math.floor(m.dur * secPerBeat * SAMPLE_RATE);

    for (let i = 0; i < numSamples; i++) {
      const idx = startIdx + i;
      if (idx >= totalSamples) break;
      const t = i / SAMPLE_RATE;
      const env = Math.min(1.0, t * 75.0) * Math.max(0.0, 1.0 - (t / (m.dur * secPerBeat)));
      const vib = t > 0.15 ? Math.sin(2 * Math.PI * 5.5 * t) * 3.5 : 0.0;
      const sample = softPulse((f + vib) * t, 0.32) * env * 0.22;

      left[idx] += sample;
      right[idx] += sample;
    }
  }

  // 2. Chords for Retro Arpeggiation
  const chords = [
    ["C4", "E4", "G4", "C5"],
    ["G3", "B3", "D4", "G4"],
    ["A3", "C4", "E4", "A4"],
    ["F3", "A3", "C4", "F4"]
  ];
  const arpSpeed = 0.075;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / SAMPLE_RATE;
    const beat = Math.floor(t / secPerBeat);
    const chordIdx = Math.floor(beat / 4) % chords.length;
    const chord = chords[chordIdx];
    const noteIdx = Math.floor(t / arpSpeed) % chord.length;
    const f = noteToFreq(chord[noteIdx]);
    const sample = softPulse(f * t, 0.5) * 0.075;

    left[i] += sample * 0.85;
    right[i] += sample * 0.85;
  }

  // 3. NES Triangle Bass
  const bassNotes = ["C3", "G2", "A2", "F2"];
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
