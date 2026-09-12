#!/usr/bin/env node
/**
 * Renders the landing-page demo clips from the real synth — no stock audio.
 * Reuses player.js#generateLoop (same durations/tiers the CLI plays) and
 * synth/chime.js. Deterministic: re-running produces identical output.
 *
 * Output: docs/audio/*.m4a + docs/audio/manifest.json
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const { generateLoop, AVAILABLE_GENRES } = require("../src/player");
const { generateSuccessChime, generateFailureChime, generateAttentionChime } = require("../src/synth/chime");
const { createWavBuffer, hashString } = require("../src/synth/generator");

const OUT_DIR = path.join(__dirname, "..", "docs", "audio");
const LOOP_OVERLAP_MS = 120; // matches player.js's own crossfade window

if (process.platform !== "darwin") {
  console.error("render-demo.js needs macOS's built-in afconvert to encode m4a. Aborting.");
  process.exit(1);
}

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
function crossfadeConcat(clips, overlapMs) {
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

/** Plain append, no crossfade — used for the trailing chime. */
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

function encodeM4a(wavBuffer, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tmpWav = path.join(os.tmpdir(), `vibeaudio-render-${process.pid}-${Date.now()}.wav`);
  fs.writeFileSync(tmpWav, wavBuffer);
  try {
    const result = spawnSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", "128000", tmpWav, outPath]);
    if (result.status !== 0) {
      throw new Error(`afconvert failed for ${outPath}: ${result.stderr}`);
    }
  } finally {
    fs.rmSync(tmpWav, { force: true });
  }
}

function samplesToMs(n, sampleRate) {
  return Math.round((n / sampleRate) * 1000);
}

function renderSession(genre, seed, manifest) {
  const clips = [1, 1, 2, 2, 3, 3].map((tier) => parseWav(generateLoop(genre, tier, seed)));
  const stitched = crossfadeConcat(clips, LOOP_OVERLAP_MS);
  const chime = parseWav(generateSuccessChime());
  const withChime = append(stitched, chime);

  const wav = createWavBuffer({ left: withChime.left, right: withChime.right, sampleRate: withChime.sampleRate });
  encodeM4a(wav, path.join(OUT_DIR, `${genre}-session.m4a`));

  manifest[genre] = {
    tier1StartMs: samplesToMs(stitched.starts[0], stitched.sampleRate),
    tier2StartMs: samplesToMs(stitched.starts[2], stitched.sampleRate),
    tier3StartMs: samplesToMs(stitched.starts[4], stitched.sampleRate),
    chimeStartMs: samplesToMs(withChime.chimeStart, withChime.sampleRate),
    totalMs: samplesToMs(withChime.left.length, withChime.sampleRate)
  };
}

function renderChime(name, generator) {
  const wav = generator();
  encodeM4a(wav, path.join(OUT_DIR, `chime-${name}.m4a`));
}

function renderSeed(name, seedSource) {
  const seed = hashString(seedSource);
  const wav = generateLoop("jazz", 2, seed);
  encodeM4a(wav, path.join(OUT_DIR, `seed-${name}.m4a`));
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const manifest = {};
for (const genre of AVAILABLE_GENRES) {
  renderSession(genre, hashString(`demo-${genre}`), manifest);
  process.stdout.write(`  rendered ${genre}-session.m4a\n`);
}

renderChime("success", generateSuccessChime);
renderChime("failure", generateFailureChime);
renderChime("attention", generateAttentionChime);
process.stdout.write("  rendered chime-{success,failure,attention}.m4a\n");

renderSeed("1", "~/work/api");
renderSeed("2", "~/side/game");
renderSeed("3", "~/oss/cli");
process.stdout.write("  rendered seed-{1,2,3}.m4a\n");

fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`  wrote manifest.json\n\nDone: ${OUT_DIR}\n`);
