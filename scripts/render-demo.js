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
const { hashString } = require("../src/synth/generator");
// The stitching lives in src/render.js, where `vibe --render` uses it too -
// the page has to demo the audio the CLI actually produces.
const { renderPiece } = require("../src/render");

const OUT_DIR = path.join(__dirname, "..", "docs", "audio");

if (process.platform !== "darwin") {
  console.error("render-demo.js needs macOS's built-in afconvert to encode m4a. Aborting.");
  process.exit(1);
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

function renderSession(genre, seed, manifest) {
  const piece = renderPiece({ genre, seed });
  encodeM4a(piece.wav, path.join(OUT_DIR, `${genre}-session.m4a`));

  manifest[genre] = {
    tier1StartMs: piece.tierStartsMs[0],
    tier2StartMs: piece.tierStartsMs[1],
    tier3StartMs: piece.tierStartsMs[2],
    chimeStartMs: piece.chimeStartMs,
    totalMs: piece.durationMs
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
