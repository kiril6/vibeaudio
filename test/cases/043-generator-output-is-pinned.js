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
      fireplace:    ["8a4631c3712a", "f665027d05d3", "66d865818cff"],
      wind: ["275ac0eabf05", "3c0a14780c68", "5c20addddb00"],
      stream: ["86c43f55c00d", "3931840171cd", "c87074417046"],
      house: ["580588bd7cc9", "9fcf4962db34", "8c1c14c77c12"],
      dubtechno: ["dd69286cd684", "a4dbdb849fb1", "7b430ef1a363"],
      shoegaze: ["d77e84822fe6", "6fa119bb0fc7", "1f112fea63e6"],
      gamelan: ["8cc831a81a58", "3f66f2f3e665", "119b09bf8dab"],
      musicbox: ["3864c62af34b", "3f1e503dd2be", "1838eac4b0fa"],
      rainpiano: ["9b9f5bcc030f", "5c874454bf9a", "9f37d270ab2a"]
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
