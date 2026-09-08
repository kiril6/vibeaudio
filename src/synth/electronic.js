/**
 * Melodic Electronic / Downtempo Procedural Synth Engine
 * Resonant Pluck Arpeggio + Warm Electronic Sub-Bass + Subtle Tech Pulse
 */

const {
  SAMPLE_RATE,
  noteToFreq,
  analogSaw,
  softPulse,
  triangle,
  sine,
  createWavBuffer
} = require("./generator");

function generateElectronicLoop(durationSec = 6.4) {
  const bpm = 116;
  const secPerBeat = 60.0 / bpm;
  const totalBeats = Math.floor(durationSec / secPerBeat);
  const actualDuration = totalBeats * secPerBeat;
  const totalSamples = Math.floor(SAMPLE_RATE * actualDuration);

  const left = new Float64Array(totalSamples);
  const right = new Float64Array(totalSamples);

  // 1. Resonant Electronic Pluck Synth (Dorian / Melodic Minor)
  // Notes: D4, F4, G4, A4, C5, D5
  const pluckSeq = [
    { note: "D4", step: 0 },
    { note: "A4", step: 1 },
    { note: "F4", step: 2 },
    { note: "C5", step: 3 },
    { note: "D4", step: 4 },
    { note: "G4", step: 5 },
    { note: "A4", step: 6 },
    { note: "F4", step: 7 },
    { note: "Bb3", step: 8 },
    { note: "F4", step: 9 },
    { note: "D4", step: 10 },
    { note: "A4", step: 11 }
  ];

  const stepSec = secPerBeat / 2.0; // 8th notes

  for (let i = 0; i < totalSamples; i++) {
    const t = i / SAMPLE_RATE;
    const currentStep = Math.floor(t / stepSec) % 16;
    const activePluck = pluckSeq.find((p) => p.step === currentStep % pluckSeq.length);

    if (activePluck) {
      const f = noteToFreq(activePluck.note);
      const tNote = t % stepSec;
      // Fast exponential decay filter simulation
      const filterCutoff = Math.exp(-tNote * 14.0);
      const env = Math.exp(-tNote * 7.0);

      // Resonant pluck wave: mixture of soft pulse and harmonics modulated by filter cutoff
      const osc = softPulse(f * t, 0.4) * 0.7 + analogSaw(f * t) * 0.3 * filterCutoff;
      const sample = osc * env * 0.16;

      const pan = 0.5 + 0.3 * Math.sin(2 * Math.PI * 0.8 * t);
      left[i] += sample * (1.0 - pan);
      right[i] += sample * pan;
    }
  }

  // 2. Electronic Sub-Bass (Deep and punchy)
  const bassSeq = ["D2", "D2", "A#1", "C2"];
  for (let i = 0; i < totalSamples; i++) {
    const t = i / SAMPLE_RATE;
    const bar = Math.floor(t / (secPerBeat * 2.0)) % bassSeq.length;
    const f = noteToFreq(bassSeq[bar]);
    const tBeat = t % secPerBeat;
    const env = Math.exp(-tBeat * 4.5);

    // Deep sine sub + triangle warmth
    const sub = (sine(f * t) * 0.75 + triangle(f * t) * 0.25) * env * 0.28;
    left[i] += sub;
    right[i] += sub;
  }

  // 3. Subtle Tech Glitch/Percussion Pulse (Rhythmic noise blips)
  for (let i = 0; i < totalSamples; i++) {
    const t = i / SAMPLE_RATE;
    const t16 = t % (secPerBeat / 4.0);
    if (t16 < 0.015) {
      const n = (Math.random() * 2.0 - 1.0) * (1.0 - t16 / 0.015);
      const sample = n * 0.045;
      left[i] += sample;
      right[i] += sample;
    }
  }

  // 4. Stereo Ping-Pong Echo
  const delayL = Math.floor(0.26 * SAMPLE_RATE);
  const delayR = Math.floor(0.39 * SAMPLE_RATE);
  const feedback = 0.26;

  for (let i = 0; i < totalSamples; i++) {
    if (i >= delayL) left[i] += right[i - delayL] * feedback;
    if (i >= delayR) right[i] += left[i - delayR] * feedback;
  }

  // Smooth loop boundary fade
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

module.exports = { generateElectronicLoop };
