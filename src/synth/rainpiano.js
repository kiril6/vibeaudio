/**
 * Rain and Piano: the sparse piano with the rain bed behind it. Both layers
 * are the existing generators, so their variants, tiers and seeds carry over.
 */

const { SAMPLE_RATE, createWavBuffer } = require("./generator");
const { generatePianoLoop } = require("./piano");
const { generateRainLoop } = require("./rain");

const PIANO_LEVEL = 0.84;
const RAIN_LEVEL = 0.3;
const TIER_GAIN = { 1: 1.25, 2: 1.18, 3: 1.1 };

function generateRainPianoLoop(durationSec = 7.6, tier = 2, seed = 0, bar = 0) {
  const piano = generatePianoLoop(durationSec, tier, seed, bar);
  const rain = generateRainLoop(durationSec, tier, seed, bar);
  const frames = (piano.length - 44) / 4;
  const gain = TIER_GAIN[tier] || TIER_GAIN[2];
  const left = new Float64Array(frames);
  const right = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    const at = 44 + i * 4;
    left[i] = (piano.readInt16LE(at) * PIANO_LEVEL + rain.readInt16LE(at) * RAIN_LEVEL) * gain / 32768;
    right[i] = (piano.readInt16LE(at + 2) * PIANO_LEVEL + rain.readInt16LE(at + 2) * RAIN_LEVEL) * gain / 32768;
  }
  return createWavBuffer({ left, right, sampleRate: SAMPLE_RATE });
}

module.exports = { generateRainPianoLoop };
