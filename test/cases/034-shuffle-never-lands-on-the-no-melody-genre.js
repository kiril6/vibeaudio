const { assert, TEST_DIR } = require("../helpers");

(async () => {
  // --- 34. Shuffle stays musical ---
  console.log("\n\x1b[1m[34] Shuffle never lands on the no-melody genre\x1b[0m");
  {
    const { resolveGenre: resolve, SHUFFLE_GENRES, AVAILABLE_GENRES: ALL } = require("../../src/player");

    const NON_MELODIC = ["drone", "rain", "ocean", "fireplace", "wind", "stream"];
    for (const g of NON_MELODIC) assert.ok(!SHUFFLE_GENRES.includes(g), `${g} must be out of the shuffle pool`);
    assert.strictEqual(SHUFFLE_GENRES.length, ALL.length - NON_MELODIC.length, "shuffle must drop exactly the non-melodic genres");

    const seen = new Set();
    for (let i = 0; i < 4000; i++) seen.add(resolve("random"));
    for (const g of NON_MELODIC) assert.ok(!seen.has(g), `random must never resolve to ${g}`);
    // 4000 draws from 6 options: a genre missing here means the pool is wrong,
    // not that the dice were unkind (P(miss) is about 6 * 0.833^4000).
    assert.strictEqual(seen.size, SHUFFLE_GENRES.length, "shuffle must still reach every other genre");

    for (const name of ["drone", "noise", "focus"]) {
      assert.strictEqual(resolve(name), "drone", `${name} must still reach drone on purpose`);
    }
    for (const name of ["rain", "storm", "ocean", "surf"]) {
      assert.ok(["rain", "ocean"].includes(resolve(name)), `${name} must still be reachable on purpose`);
    }
    console.log("   ✓ random stays musical; the no-melody genres remain reachable by name and alias.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
