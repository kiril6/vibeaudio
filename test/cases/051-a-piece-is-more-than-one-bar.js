const { AVAILABLE_GENRES, assert, path, fs, TEST_DIR } = require("../helpers");

(async () => {
  // ---------------------------------------------------------------
  // TEST 51: A piece is more than one bar
  // ---------------------------------------------------------------
  {
    console.log("\n\x1b[1m[51] A piece is more than one bar\x1b[0m");
    const crypto = require("crypto");
    const { generateLoop, getAudioPath, LOOP_BARS } = require("../../src/player");
    const md5 = (buf) => crypto.createHash("md5").update(buf).digest("hex");

    // Every tier, because a tier gate is exactly where a bar can go missing:
    // tier 1 leaves out layers, and a genre whose remaining layers ignore the
    // variant would repeat one bar for the first fifteen seconds of every
    // turn while tiers 2 and 3 looked fine.
    for (const genre of AVAILABLE_GENRES) {
      for (const tier of [1, 2, 3]) {
        const bars = Array.from({ length: LOOP_BARS }, (_, bar) => md5(generateLoop(genre, tier, 1337, bar)));
        assert.strictEqual(
          new Set(bars).size, LOOP_BARS,
          `${genre} tier ${tier}: ${new Set(bars).size} distinct bars of ${LOOP_BARS} - a bar repeats`
        );
      }
    }

    // The phrase wraps, and bar 0 is the seed's own render: a project keeps
    // the sound it had before it had more than one bar. (Test 43 pins that
    // render for every genre and tier, so this only has to hold the default.)
    assert.strictEqual(
      md5(generateLoop("lofi", 3, 1337, LOOP_BARS)), md5(generateLoop("lofi", 3, 1337, 0)),
      "the phrase must wrap back to bar 0"
    );
    assert.strictEqual(
      md5(generateLoop("lofi", 3, 1337)), md5(generateLoop("lofi", 3, 1337, 0)),
      "bar 0 is what the seed alone renders"
    );

    // Bars are cached apart, or the second one would be served the first's
    // file and the phrase would be one bar long again.
    const barSeed = 20260923;
    const files = Array.from({ length: LOOP_BARS }, (_, bar) => getAudioPath("lofi", 2, barSeed, 1, bar));
    assert.strictEqual(new Set(files).size, LOOP_BARS, "each bar needs its own cache file");
    assert.ok(files[0].endsWith("loop_lofi_t2.wav"), `bar 0 keeps its pre-bars name, got ${path.basename(files[0])}`);
    assert.strictEqual(
      new Set(files.map((f) => path.dirname(f))).size, 1,
      "bars of one piece share the project's seed directory, so it prunes as a unit"
    );
    // Test 27's lesson: a seed directory left behind evicts a real project's.
    fs.rmSync(path.dirname(files[0]), { recursive: true, force: true });

    console.log(`   ✓ Every genre and tier plays ${LOOP_BARS} distinct bars that wrap, cached apart, opening on the seed's own.`);
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
