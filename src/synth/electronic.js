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
  makeRng,
  rotate,
  pick,
  ornamentRng,
  pluckEnv,
  createWavBuffer
} = require("./generator");

// D dorian throughout; each pluck figure ships with the bass cycle that
// harmonises it.
const VARIANTS = [
  {
    pluck: ["D4", "A4", "F4", "C5", "D4", "G4", "A4", "F4", "A#3", "F4", "D4", "A4"],
    bass: ["D2", "D2", "A#1", "C2"]
  },
  {
    pluck: ["A4", "D5", "C5", "A4", "F4", "A4", "G4", "D4", "F4", "C5", "A4", "G4"],
    bass: ["A1", "F2", "C2", "G2"]
  },
  {
    pluck: ["F4", "A4", "C5", "A4", "G4", "D5", "C5", "A4", "D4", "F4", "A4", "G4"],
    bass: ["F2", "C2", "D2", "A#1"]
  }
];

// Which of the 16 eighth-note steps the pluck plays (1) or rests on (0).
// Rests only, so no pattern can add a note the figure does not have.
const GATES = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0],
  [1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1],
  [1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1],
  [1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 0]
];

// Per-step level: flat, the beat, every other step, and a 3-3-2 figure.
// Never above 1, so an accent cannot make the pluck louder than it was.
const ACCENTS = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 0.75, 0.75, 0.75, 1, 0.75, 0.75, 0.75, 1, 0.75, 0.75, 0.75, 1, 0.75, 0.75, 0.75],
  [1, 0.75, 1, 0.75, 1, 0.75, 1, 0.75, 1, 0.75, 1, 0.75, 1, 0.75, 1, 0.75],
  [1, 0.75, 0.75, 1, 0.75, 0.75, 1, 0.75, 1, 0.75, 0.75, 1, 0.75, 0.75, 1, 0.75]
];

// Which 16ths in each beat get a tick: all four, the three after the beat,
// the 8ths, and a skip figure.
const TICKS = [
  [1, 1, 1, 1],
  [0, 1, 1, 1],
  [1, 0, 1, 0],
  [1, 0, 1, 1]
];

function generateElectronicLoop(durationSec = 6.4, tier = 2, seed = 0, bar = 0) {
  const variant = rotate(makeRng(seed), VARIANTS, bar);
  // The pluck sounds at every tier, so its rhythm is what makes tier 1 differ
  // between projects - it had 3 arrangements for every seed.
  const groove = ornamentRng(seed ^ 0x3c6ef372);
  const gate = pick(groove, GATES);
  const accent = pick(groove, ACCENTS);
  const bpm = 116;
  const secPerBeat = 60.0 / bpm;
  const totalBeats = Math.floor(durationSec / secPerBeat);
  const actualDuration = totalBeats * secPerBeat;
  const totalSamples = Math.floor(SAMPLE_RATE * actualDuration);

  const left = new Float64Array(totalSamples);
  const right = new Float64Array(totalSamples);

  // 1. Resonant Electronic Pluck Synth (Dorian / Melodic Minor)
  // Notes: D4, F4, G4, A4, C5, D5
  const pluckSeq = variant.pluck.map((note, step) => ({ note, step }));

  const stepSec = secPerBeat / 2.0; // 8th notes

  for (let i = 0; i < totalSamples; i++) {
    const t = i / SAMPLE_RATE;
    const currentStep = Math.floor(t / stepSec) % 16;
    const activePluck = gate[currentStep] ? pluckSeq.find((p) => p.step === currentStep % pluckSeq.length) : null;

    if (activePluck) {
      const f = noteToFreq(activePluck.note);
      const tNote = t % stepSec;
      // Fast exponential decay filter simulation
      const filterCutoff = Math.exp(-tNote * 14.0);
      const env = pluckEnv(tNote, stepSec, 7.0) * accent[currentStep];

      // Resonant pluck wave: mixture of soft pulse and harmonics modulated by filter cutoff
      const osc = softPulse(f * t) * 0.7 + analogSaw(f * t) * 0.3 * filterCutoff;
      const sample = osc * env * (tier === 1 ? 0.19 : 0.16);

      const pan = 0.5 + 0.3 * Math.sin(2 * Math.PI * 0.8 * t);
      left[i] += sample * (1.0 - pan);
      right[i] += sample * pan;

      // Tier 3: octave-up counter-pluck for peak energy
      if (tier >= 3) {
        const counter = softPulse(f * 2.0 * t) * env * 0.05;
        left[i] += counter * pan;
        right[i] += counter * (1.0 - pan);
      }
    }
  }

  // 2. Electronic Sub-Bass (Deep and punchy) - joins at Tier 2
  const bassSeq = variant.bass;
  for (let i = 0; tier >= 2 && i < totalSamples; i++) {
    const t = i / SAMPLE_RATE;
    const bar = Math.floor(t / (secPerBeat * 2.0)) % bassSeq.length;
    const f = noteToFreq(bassSeq[bar]);
    const tBeat = t % secPerBeat;
    // Same reason as the pluck above: a bare decay is 1.0 the instant tBeat
    // wraps, which on a sub this deep is a thump rather than a note. It also
    // lands the bar's pitch change on an envelope of zero, so the oscillator's
    // phase jump there is inaudible.
    const env = pluckEnv(tBeat, secPerBeat, 4.5);

    // Deep sine sub + triangle warmth
    const sub = (sine(f * t) * 0.75 + triangle(f * t) * 0.25) * env * 0.28;
    left[i] += sub;
    right[i] += sub;
  }

  // 3. Tick on every 16th - joins at Tier 2
  //
  // This was a 15 ms burst of raw white noise starting at full level, and it
  // was heard as static as soon as the music escalated (test [89]). A short
  // tonal blip falling 2.4 to 1.6 kHz keeps the 16th-note pulse with no noise
  // in it, and its 1 ms fade-in keeps it from clicking.
  // Tier-gated, so the pattern has a stream of its own.
  const ticks = pick(ornamentRng(seed ^ 0x1b873593), TICKS);
  let tickPhase = 0.0;
  for (let i = 0; tier >= 2 && i < totalSamples; i++) {
    const t = i / SAMPLE_RATE;
    const t16 = t % (secPerBeat / 4.0);
    const sixteenth = Math.floor(t / (secPerBeat / 4.0)) % 4;
    if (t16 < 0.03 && ticks[sixteenth]) {
      const f = 1600 + 800 * Math.exp(-t16 / 0.004);
      tickPhase += f / SAMPLE_RATE;
      const env = Math.min(1.0, t16 / 0.001) * Math.exp(-t16 / 0.006);
      const sample = Math.sin(2 * Math.PI * tickPhase) * env * 0.03;
      left[i] += sample;
      right[i] += sample;
    } else {
      tickPhase = 0.0;
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
