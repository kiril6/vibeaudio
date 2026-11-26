const { assert } = require("../setup");

(async () => {
  // [93] Tiers are one piece: what a seed picks at tier 1 it still picks at
  // tiers 2 and 3.
  //
  // Escalation adds layers to the same arrangement. That holds only while a
  // tier-gated layer never draws ahead of an ungated one from a shared random
  // stream: one draw inserted early would shift every later choice, and tier
  // 1 would quietly stop being the same piece as tier 3 (CLAUDE.md, "Ornaments
  // draw from ornamentRng(seed) in a fixed order, regardless of tier"; #4).
  // It held by construction, and nothing checked it.
  //
  // So every draw is recorded with the source line that made it, per stream.
  // A stream's draws at a lower tier must be a prefix of its draws at a
  // higher one, line for line: the same draw feeds the same choice, and a
  // higher tier may only draw more after it. Genres that draw per sample
  // (drone, rain, ocean) are left out; their beds are tier-independent by
  // construction and slow to trace.
  {
    console.log("\n\x1b[1m[93] Tiers are one piece\x1b[0m");
    const path = require("path");
    const synth = path.join(__dirname, "../../src/synth");
    const generator = require(path.join(synth, "generator"));

    let log = null;
    const created = new Map();
    function traced(rng, label) {
      const n = (created.get(label) || 0) + 1;
      created.set(label, n);
      const key = `${label}#${n}`;
      return function draw() {
        const lines = log && (log.get(key) || []);
        // Choices are made in the first few draws; past 500 it is per-sample
        // noise (jazz's brushes draw ~20,000), the same line every time.
        if (lines && lines.length < 500) {
          // The first frame outside generator.js is the choice being made.
          const site = new Error().stack.split("\n").slice(2).find((l) => l.includes(synth) && !l.includes("generator.js"));
          lines.push(site ? site.replace(/^.*\/src\/synth\//, "").replace(/:\d+\)?$/, "") : "?");
          log.set(key, lines);
        }
        return rng();
      };
    }
    const { makeRng, ornamentRng } = generator;
    generator.makeRng = (seed) => traced(makeRng(seed), `m${seed >>> 0}`);
    generator.ornamentRng = (seed) => traced(ornamentRng(seed), `o${seed >>> 0}`);
    // The genres destructure these at require time, so load them after.
    for (const id of Object.keys(require.cache)) {
      if (id.startsWith(synth) && !id.endsWith("generator.js")) delete require.cache[id];
    }

    const GENRES = {
      lofi: [require(path.join(synth, "lofi")).generateLofiLoop, 6.4],
      synthwave: [require(path.join(synth, "synthwave")).generateSynthwaveLoop, 6.8],
      "8bit": [require(path.join(synth, "chiptune")).generateChiptuneLoop, 7.5],
      electronic: [require(path.join(synth, "electronic")).generateElectronicLoop, 6.4],
      jazz: [require(path.join(synth, "jazz")).generateJazzLoop, 6.26],
      zen: [require(path.join(synth, "zen")).generateZenLoop, 7.2],
      piano: [require(path.join(synth, "piano")).generatePianoLoop, 7.6],
      house: [require(path.join(synth, "house")).generateHouseLoop, 16 * 60 / 122 + 0.12],
      dubtechno: [require(path.join(synth, "dubtechno")).generateDubTechnoLoop, 16 * 60 / 118 + 0.12],
      shoegaze: [require(path.join(synth, "shoegaze")).generateShoegazeLoop, 8.0],
      gamelan: [require(path.join(synth, "gamelan")).generateGamelanLoop, 8.0],
      musicbox: [require(path.join(synth, "musicbox")).generateMusicBoxLoop, 7.6],
      rainpiano: [require(path.join(synth, "rainpiano")).generateRainPianoLoop, 7.6]
    };

    function trace(generate, duration, tier, seed, bar) {
      log = new Map();
      created.clear();
      generate(duration, tier, seed, bar);
      const result = log;
      log = null;
      return result;
    }

    for (const [genre, [generate, duration]] of Object.entries(GENRES)) {
      for (const seed of [1, 7, 42]) {
        for (const bar of [0, 1]) { // A bar only rotates the variant, one draw.
          const tiers = [1, 2, 3].map((tier) => trace(generate, duration, tier, seed, bar));
          for (let t = 0; t < 2; t++) {
            for (const [key, lower] of tiers[t]) {
              const higher = tiers[t + 1].get(key) || [];
              const at = lower.findIndex((site, i) => higher[i] !== site);
              assert.strictEqual(at, -1,
                `${genre} seed ${seed} bar ${bar}: draw ${at} of stream ${key} came from ${lower[at]} at tier ${t + 1} but ${higher[at] || "nowhere"} at tier ${t + 2} - the tiers stop being one piece`);
            }
          }
        }
      }
    }
    console.log("   ✓ Every choice a seed makes at a lower tier is made the same way at the higher ones.");
  }
})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
