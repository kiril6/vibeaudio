/**
 * Chill Synthwave / Cyberpunk Procedural Synth Engine
 * Analog Chorused Pads (Dmin -> Bbmaj7 -> Cmaj) + Pulsing 80s Bassline + Shimmering Arp
 */

const {
  SAMPLE_RATE,
  noteToFreq,
  analogSaw,
  triangle,
  createWavBuffer
} = require("./generator");

function generateSynthwaveLoop(durationSec = 6.8) {
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
      const env = Math.exp(-tNote * 8.0);
      const sample = (triangle(f * t) * 0.7 + analogSaw(f * t) * 0.3) * env * 0.20;

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
      const env = Math.exp(-tNote * 6.5);
      const sample = analogSaw(f * t) * env * 0.085;

      const pan = 0.5 + 0.35 * Math.sin(2 * Math.PI * 1.5 * t);
      left[idx] += sample * (1.0 - pan);
      right[idx] += sample * pan;
    }
  }

  // Progression: Dmin -> Bbmaj7 -> Cmaj
  addPadChord(["D3", "F3", "A3", "D4"], 0.0, 3.2, 0.15);
  addBass("D2", 0.0, 3.2);

  addPadChord(["A#2", "F3", "A3", "D4"], 3.2, 1.8, 0.15);
  addBass("A#1", 3.2, 1.8);

  addPadChord(["C3", "G3", "C4", "E4"], 5.0, 1.8, 0.15);
  addBass("C2", 5.0, 1.8);

  addArp(["D5", "F5", "A5", "C6", "D6", "A5", "F5", "E5"], 0.6, 6.0);

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

  return createWavBuffer({ left, right, sampleRate: SAMPLE_RATE });
}

module.exports = { generateSynthwaveLoop };
