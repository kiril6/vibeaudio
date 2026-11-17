const { assert, parseArgs, TEST_DIR } = require("../helpers");

(async () => {
  // ---------------------------------------------------------------
  // TEST 52: --render writes the piece to a file
  // ---------------------------------------------------------------
  {
    console.log("\n\x1b[1m[52] --render writes the piece to a file\x1b[0m");
    const { renderPiece } = require("../../src/render");
    const { LOOP_BARS } = require("../../src/player");

    // Optional filename, like --mute's optional duration: a flag after it is
    // still a flag, or `vibe --render --genre zen` would render to a file
    // called "--genre".
    assert.strictEqual(parseArgs(["node", "vibe", "--render"]).render, "", "bare --render means the default name");
    assert.strictEqual(parseArgs(["node", "vibe", "--render", "mine.wav"]).render, "mine.wav");
    const both = parseArgs(["node", "vibe", "--render", "--genre", "zen"]);
    assert.strictEqual(both.render, "", "a flag is not a filename");
    assert.strictEqual(both.genre, "zen", "…and the flag after it still parses");
    assert.strictEqual(parseArgs(["node", "vibe", "npm", "test"]).render, null, "no flag, no render");

    const piece = renderPiece({ genre: "jazz", seed: 7 });
    assert.strictEqual(piece.wav.toString("ascii", 0, 4), "RIFF", "must be a canonical WAV");
    assert.strictEqual(piece.wav.readUInt16LE(22), 2, "stereo");
    assert.strictEqual(piece.wav.readUInt32LE(24), 44100, "44.1 kHz");

    // Every bar of the phrase at every tier, in order, then the chime - the
    // point of the file is that it is a whole session, not one loop.
    assert.strictEqual(piece.tierStartsMs.length, 3, "three tiers");
    for (let i = 1; i < piece.tierStartsMs.length; i++) {
      assert.ok(piece.tierStartsMs[i] > piece.tierStartsMs[i - 1], "tiers must run in order");
    }
    assert.ok(piece.chimeStartMs > piece.tierStartsMs[2], "the chime ends it");
    assert.ok(piece.durationMs > piece.chimeStartMs, "…and is actually in the file");

    const barMs = piece.tierStartsMs[1] / LOOP_BARS;
    assert.ok(barMs > 5000 && barMs < 9000, `a tier should be ${LOOP_BARS} bars, got ${barMs}ms each`);

    // A render is played by something with its own volume control, so it goes
    // out at full scale - but a crossfade sums two bars at the seam, and a
    // render that clips there is worse than one that is quiet.
    const { parseWav } = require("../../src/render");
    const audio = parseWav(piece.wav);
    let peak = 0;
    for (let i = 0; i < audio.left.length; i++) {
      peak = Math.max(peak, Math.abs(audio.left[i]), Math.abs(audio.right[i]));
    }
    assert.ok(peak < 1.0, `the crossfade seams must not clip, peak was ${peak.toFixed(3)}`);
    assert.ok(peak > 0.2, `…and it must not be silent either, peak was ${peak.toFixed(3)}`);

    console.log("   ✓ Optional filename parses, and the file is a full session — every bar of every tier, then the chime, without clipping.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
