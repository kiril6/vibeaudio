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
      lofi:         ["72384bfdc7bc", "367eaec3f27f", "8822514a06a3"],
      synthwave:    ["e1f5d0a2d342", "0f4e86379703", "75ef1aff23c9"],
      "8bit":       ["bb389e3ed87a", "f61824a4a2c3", "d04478d1310e"],
      electronic:   ["46f985a4af09", "e2862335b57a", "61254145fe28"],
      jazz:         ["8ff30f228660", "2aa5ccd1104c", "a84538a236d1"],
      zen:          ["f8cfbeb593a5", "2406dd0ef020", "4a628e76d64d"],
      piano:        ["bd13952e9c8d", "c4940c3eb360", "d1678230deb0"],
      drone:        ["02a8069359cc", "2679af8bd7f0", "cf5f9257b2f6"],
      rain:         ["7b8c1fa69650", "273c139a3f7f", "bb17c8957987"],
      ocean:        ["c59e8b6ca39b", "6ff406d3611f", "1d548d21a985"],
      fireplace:    ["bfa2b3db6784", "55a40cb863de", "5ebef470c6c1"],
      wind: ["26794e6cc2af", "9dfe83fa071d", "a48dc68ad010"],
      stream: ["7cd506c26c13", "1bd56bbe89cd", "0438139963e2"],
      house: ["b93718d0375c", "6fd4f36b30fe", "65d9a820c1e2"],
      dubtechno: ["51ab59a31908", "106699c9b0e5", "10c3f8bae96c"],
      shoegaze: ["d77e84822fe6", "a5d273dc6654", "f69406c2ca83"],
      gamelan: ["d616d7e23dec", "16f13b88837f", "6de348f515ee"],
      musicbox: ["7cfd4630f406", "a19502525f5a", "acaa07eff981"],
      rainpiano: ["eae68342de02", "85e51298ab1f", "b736717bd8be"]
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
      ocean: (t) => require("../../src/synth/ocean").generateOceanLoop(8.0, t, 1),
      fireplace: (t) => require("../../src/synth/fireplace").generateFireplaceLoop(7.0, t, 1),
      wind: (t) => require("../../src/synth/wind").generateWindLoop(8.0, t, 1),
      stream: (t) => require("../../src/synth/stream").generateStreamLoop(8.0, t, 1),
      house: (t) => require("../../src/synth/house").generateHouseLoop(16 * 60 / 122 + 0.12, t, 1),
      dubtechno: (t) => require("../../src/synth/dubtechno").generateDubTechnoLoop(16 * 60 / 118 + 0.12, t, 1),
      shoegaze: (t) => require("../../src/synth/shoegaze").generateShoegazeLoop(8.0, t, 1),
      gamelan: (t) => require("../../src/synth/gamelan").generateGamelanLoop(8.0, t, 1),
      musicbox: (t) => require("../../src/synth/musicbox").generateMusicBoxLoop(7.6, t, 1),
      rainpiano: (t) => require("../../src/synth/rainpiano").generateRainPianoLoop(7.6, t, 1)
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

    console.log("   ✓ All 19 genres × 3 tiers render exactly as pinned — audio drift now fails the suite.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
