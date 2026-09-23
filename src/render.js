/**
 * Rendering a piece to a file, rather than to the speakers.
 *
 * The live player spawns one bar at a time and crossfades the boundary by
 * re-spawning early (LOOP_OVERLAP_MS in player.js); a file has to do that
 * stitching itself, or the seams click. Everything here is pure - buffers in,
 * buffer out - so both callers (`vibe --render` and the landing page's
 * scripts/render-demo.js) get the same audio the player would have produced.
 */

const { generateLoop, LOOP_BARS } = require("./player");
const { generateSuccessChime } = require("./synth/chime");
const { createWavBuffer } = require("./synth/generator");

// Matches the live player's own crossfade window.
const LOOP_OVERLAP_MS = 120;

function parseWav(buf) {
  const numChannels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const dataSize = buf.readUInt32LE(40);
  const numSamples = Math.floor(dataSize / 2 / numChannels);
  const left = new Float64Array(numSamples);
  const right = numChannels === 2 ? new Float64Array(numSamples) : null;
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    left[i] = buf.readInt16LE(offset) / 32768;
    offset += 2;
    if (right) {
      right[i] = buf.readInt16LE(offset) / 32768;
      offset += 2;
    }
  }
  return { sampleRate, left, right };
}

/** Crossfades consecutive clips over `overlapMs`, mirroring the live player's loop boundary. */
function crossfadeConcat(clips, overlapMs = LOOP_OVERLAP_MS) {
  const sampleRate = clips[0].sampleRate;
  const overlapSamples = Math.floor((sampleRate * overlapMs) / 1000);
  const stereo = !!clips[0].right;
  let totalLen = 0;
  for (const c of clips) totalLen += c.left.length;
  totalLen -= overlapSamples * (clips.length - 1);

  const outL = new Float64Array(totalLen);
  const outR = stereo ? new Float64Array(totalLen) : null;
  const starts = [];
  let pos = 0;

  for (let ci = 0; ci < clips.length; ci++) {
    const c = clips[ci];
    starts.push(pos);
    for (let i = 0; i < c.left.length; i++) {
      const idx = pos + i;
      if (idx >= totalLen) break;
      let gL = c.left[i];
      let gR = stereo ? c.right[i] : 0;
      if (ci > 0 && i < overlapSamples) {
        const fadeIn = i / overlapSamples;
        gL *= fadeIn;
        gR *= fadeIn;
      }
      if (ci < clips.length - 1 && i >= c.left.length - overlapSamples) {
        const fadeOut = (c.left.length - i) / overlapSamples;
        gL *= fadeOut;
        gR *= fadeOut;
      }
      outL[idx] += gL;
      if (outR) outR[idx] += gR;
    }
    pos += c.left.length - overlapSamples;
  }
  return { sampleRate, left: outL, right: outR, starts, totalLen };
}

/** Plain append, no crossfade - used for the trailing chime. */
function append(a, b) {
  const totalLen = a.left.length + b.left.length;
  const stereo = !!a.right;
  const outL = new Float64Array(totalLen);
  const outR = stereo ? new Float64Array(totalLen) : null;
  outL.set(a.left, 0);
  outL.set(b.left, a.left.length);
  if (stereo) {
    outR.set(a.right, 0);
    outR.set(b.right, a.left.length);
  }
  return { sampleRate: a.sampleRate, left: outL, right: outR, chimeStart: a.left.length };
}

/**
 * A whole session as one file: every bar of the phrase at each tier in turn,
 * then the success chime - what someone would have heard sitting through a
 * turn long enough to reach tier 3.
 *
 * `tiers` repeated per bar rather than per tier, so the escalation is audible
 * without the phrase being cut short at the point it starts to make sense.
 */
function renderPiece({ genre = "lofi", seed = 0, tiers = [1, 2, 3], chime = true } = {}) {
  const clips = [];
  const tierStarts = [];
  for (const tier of tiers) {
    tierStarts.push(clips.length);
    for (let bar = 0; bar < LOOP_BARS; bar++) {
      clips.push(parseWav(generateLoop(genre, tier, seed, bar)));
    }
  }

  const stitched = crossfadeConcat(clips);
  const piece = chime ? append(stitched, parseWav(generateSuccessChime())) : stitched;
  const wav = createWavBuffer({ left: piece.left, right: piece.right, sampleRate: piece.sampleRate });

  const msAt = (samples) => Math.round((samples / piece.sampleRate) * 1000);
  return {
    wav,
    durationMs: msAt(piece.left.length),
    tierStartsMs: tierStarts.map((i) => msAt(stitched.starts[i])),
    chimeStartMs: chime ? msAt(piece.chimeStart) : null
  };
}

module.exports = { parseWav, crossfadeConcat, append, renderPiece, LOOP_OVERLAP_MS };
