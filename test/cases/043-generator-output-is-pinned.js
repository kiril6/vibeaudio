const { assert, generateLofiLoop, generateSynthwaveLoop, generateChiptuneLoop, generateElectronicLoop, generateJazzLoop, generateZenLoop, TEST_DIR } = require("../helpers");

(async () => {
  // 43. Nothing pinned the actual audio, so an accidental change to a
  //     generator shipped silently - and the cache key, which hashes
  //     src/synth/, would dutifully deliver it to every user as though it
  //     were intended. One render per genre is enough to notice.
  //
  //     WHEN THIS FAILS AND THE CHANGE WAS DELIBERATE: listen to the genre
  //     first (`node bin/vibeaudio.js --clear-cache && node bin/vibeaudio.js
  //     --preview <genre>`), then paste the new hash in. Updating it without
  //     listening defeats the only check that hears anything at all.
  {
    console.log("\n\x1b[1m[43] Generator output is pinned\x1b[0m");
    const crypto = require("crypto");

    // All three tiers, not just one. Pinning tier 2 alone left every
    // tier-specific regression invisible whenever the broken value happened to
    // equal tier 2's - mutation testing caught exactly that: hard-coding
    // piano's note count to 4 (its tier-2 value) changed nothing at tier 2 and
    // sailed through, while silently flattening tiers 1 and 3.
    const GOLDEN = {
      lofi:         ["c6342ec4f12c", "9468d401ca94", "e017253dfaf0"],
      synthwave:    ["2cffc02140f9", "42eed792d353", "46a7e0526723"],
      "8bit":       ["5b08cfdfcd2d", "7c3f8d4be1ab", "de7451563424"],
      electronic:   ["873f83ea4f3b", "f542bda966bb", "a29af6b5bccd"],
      jazz:         ["fadaf4f52b75", "5cdbd8524d3d", "686fd1208d39"],
      zen:          ["0496cb273359", "2ea4a3da3d8a", "efb72a71fac0"],
      piano:        ["e12477cbde4c", "3e2e18d19203", "27e0f694c35f"],
      drone:        ["80d547b0bf48", "dfba6786efb4", "62c4918e156b"],
      rain:         ["7b8c1fa69650", "273c139a3f7f", "bb17c8957987"],
      ocean:        ["c59e8b6ca39b", "6ff406d3611f", "1d548d21a985"]
    };

    const RENDERERS = {
      lofi: (t) => generateLofiLoop(6.4, t, 1),
      synthwave: (t) => generateSynthwaveLoop(6.8, t, 1),
      "8bit": (t) => generateChiptuneLoop(7.5, t, 1),
      electronic: (t) => generateElectronicLoop(6.4, t, 1),
      jazz: (t) => generateJazzLoop(6.26, t, 1),
      zen: (t) => generateZenLoop(7.2, t, 1),
      piano: (t) => require("../../src/synth/piano").generatePianoLoop(7.6, t, 1),
      drone: (t) => require("../../src/synth/drone").generateDroneLoop(7.0, t, 1),
      rain: (t) => require("../../src/synth/rain").generateRainLoop(7.0, t, 1),
      ocean: (t) => require("../../src/synth/ocean").generateOceanLoop(8.0, t, 1)
    };

    // Every genre the player can produce must be pinned, or a new one slips
    // in with no drift protection at all.
    const { AVAILABLE_GENRES } = require("../../src/player");
    assert.deepStrictEqual(
      Object.keys(GOLDEN).sort(), [...AVAILABLE_GENRES].sort(),
      "every genre in AVAILABLE_GENRES needs a golden hash here"
    );

    for (const [genre, render] of Object.entries(RENDERERS)) {
      const hashes = [1, 2, 3].map((t) =>
        crypto.createHash("sha256").update(render(t)).digest("hex").slice(0, 12)
      );
      for (let i = 0; i < 3; i++) {
        assert.strictEqual(
          hashes[i], GOLDEN[genre][i],
          `${genre} tier ${i + 1} renders differently than it used to ` +
          `(${GOLDEN[genre][i]} -> ${hashes[i]}). If you meant to change it, listen to it and ` +
          `update the hash; if you did not, you just found a regression.`
        );
      }
      // A tier that stopped differing is escalation quietly switched off.
      assert.strictEqual(new Set(hashes).size, 3, `${genre} must render three distinct tiers`);
    }

    console.log("   ✓ All 10 genres × 3 tiers render exactly as pinned — audio drift now fails the suite.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
