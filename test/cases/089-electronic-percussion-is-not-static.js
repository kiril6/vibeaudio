const { assert } = require("../helpers");

(async () => {
  // [89] electronic's tier-2 percussion is a tick, not white noise.
  //
  // It was a 15 ms burst of raw white noise on every 16th, starting at full
  // level, and it was heard as static the moment the music escalated. A tonal
  // tick replaced it. The measure is the RMS of the second difference, which
  // broadband noise drives up and a tone at a few kHz barely moves: the noise
  // layer read 12.9e-3 at tier 2, the tick 0.37e-3, the pluck alone 0.3e-3.
  {
    console.log("\n\x1b[1m[89] electronic's percussion is not static\x1b[0m");
    const { generateLoop } = require("../../src/player");

    for (const seed of [1, 7, 42]) {
      for (const tier of [2, 3]) {
        const wav = generateLoop("electronic", tier, seed);
        const x = [];
        for (let off = 44; off + 4 <= wav.length; off += 4) x.push(wav.readInt16LE(off) / 32768);
        let sum = 0;
        for (let i = 2; i < x.length; i++) {
          const d = x[i] - 2 * x[i - 1] + x[i - 2];
          sum += d * d;
        }
        const hf = Math.sqrt(sum / x.length);
        assert.ok(hf < 0.002, `electronic seed ${seed} tier ${tier}: high-frequency energy ${(hf * 1000).toFixed(2)}e-3 - broadband noise again`);
      }
    }
    console.log("   ✓ electronic's tier-2 and tier-3 percussion carries no broadband noise.");
  }
})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
