/**
 * Shared voice for the genres added with #5: one stereo track, one note
 * renderer whose envelope starts and ends at zero (so no note can click),
 * a ping-pong echo and the loop-boundary fades. Pure, like every generator.
 */

const { SAMPLE_RATE, noteToFreq, createWavBuffer } = require("./generator");

/** Move the lowest `k` notes of a chord up an octave. */
const invert = (chord, k) =>
  chord.map((n, i) => (i < k ? n.slice(0, -1) + (Number(n.slice(-1)) + 1) : n));

/**
 * Rounds off anything over `knee` (never past knee + 0.12), so raising a
 * genre's level cannot take away the headroom the stuck heartbeat needs.
 */
const soften = (v, knee) =>
  Math.abs(v) <= knee ? v : Math.sign(v) * (knee + 0.12 * Math.tanh((Math.abs(v) - knee) / 0.12));

function track(seconds) {
  const length = Math.floor(SAMPLE_RATE * seconds);
  const left = new Float64Array(length);
  const right = new Float64Array(length);

  return {
    left,
    right,
    length,

    /**
     * `at` and `len` in seconds, `partials` as [ratio, level] pairs, `decay`
     * per second, `bend(t)` an optional pitch multiplier over the note.
     */
    note(note, at, len, amp, { pan = 0.5, partials = [[1, 1]], decay = 0, attack = 0.004, release = 0.02, bend = null } = {}) {
      const f = typeof note === "number" ? note : noteToFreq(note);
      const start = Math.max(0, Math.floor(at * SAMPLE_RATE));
      // A note running past the loop ends with it, release included.
      const count = Math.min(Math.floor(len * SAMPLE_RATE), length - start);
      let phase = 0;
      for (let i = 0; i < count; i++) {
        const t = i / SAMPLE_RATE;
        const env = Math.min(1, t / attack, (count - i) / (release * SAMPLE_RATE)) * (decay ? Math.exp(-t * decay) : 1);
        phase += (f * (bend ? bend(t) : 1)) / SAMPLE_RATE;
        let v = 0;
        for (let p = 0; p < partials.length; p++) v += Math.sin(2 * Math.PI * phase * partials[p][0]) * partials[p][1];
        v *= env * amp;
        left[start + i] += v * (1 - pan) * 2;
        right[start + i] += v * pan * 2;
      }
    },

    echo(secL, secR, feedback) {
      const dl = Math.floor(secL * SAMPLE_RATE);
      const dr = Math.floor(secR * SAMPLE_RATE);
      for (let i = 0; i < length; i++) {
        if (i >= dl) left[i] += right[i - dl] * feedback;
        if (i >= dr) right[i] += left[i - dr] * feedback;
      }
    },

    wav(trim = 1, fadeSec = 0.08) {
      const fade = Math.floor(fadeSec * SAMPLE_RATE);
      for (let i = 0; i < length; i++) {
        const g = trim * Math.min(1, i / fade, (length - 1 - i) / fade);
        left[i] = soften(left[i] * g, 0.555);
        right[i] = soften(right[i] * g, 0.555);
      }
      return createWavBuffer({ left, right, sampleRate: SAMPLE_RATE });
    }
  };
}

module.exports = { track, invert, soften };
