const { measure, assert, TEST_DIR } = require("../helpers");

(async () => {
  // [55] the noise genres: noise-based, level-matched, tiered, seamless.
  {
    console.log("\n\x1b[1m[55] Noise genres stay level-matched, escalate and loop\x1b[0m");
    const { generateRainLoop } = require("../../src/synth/rain");
    const { generateOceanLoop } = require("../../src/synth/ocean");
    const { generateFireplaceLoop } = require("../../src/synth/fireplace");
    const { generateWindLoop } = require("../../src/synth/wind");
    const { generateStreamLoop } = require("../../src/synth/stream");
    const jazzRef = measure(require("../../src/synth/jazz").generateJazzLoop(6.26, 2, 42));

    for (const [name, gen, dur] of [["rain", generateRainLoop, 7.0], ["ocean", generateOceanLoop, 8.0], ["fireplace", generateFireplaceLoop, 7.0], ["wind", generateWindLoop, 8.0], ["stream", generateStreamLoop, 8.0]]) {
      // Every curated variant, not just the seed's: they filter differently and
      // one of them being 3x too hot is exactly how these go wrong.
      for (let bar = 0; bar < 3; bar++) {
        const tiers = [1, 2, 3].map((t) => gen(dur, t, 42, bar));
        assert.ok(gen(dur, 2, 42, bar).equals(tiers[1]), `${name} must be deterministic`);
        assert.ok(!tiers[0].equals(tiers[1]) && !tiers[1].equals(tiers[2]), `${name} must honour its tier argument`);
        const ms = tiers.map(measure);
        ms.forEach((m, i) => {
          assert.ok(m.peak < 0.95, `${name} bar ${bar} tier ${i + 1} must not clip (peak ${m.peak.toFixed(3)})`);
          assert.ok(m.rms > 0.05 && m.rms < jazzRef.rms * 1.6, `${name} bar ${bar} tier ${i + 1} rms ${m.rms.toFixed(4)} is off the house level`);
        });
        assert.ok(ms[0].rms < ms[1].rms && ms[1].rms < ms[2].rms, `${name} bar ${bar} tiers must escalate in weight`);
        assert.ok(Math.abs(tiers[1].readInt16LE(44)) < 33 && Math.abs(tiers[1].readInt16LE(tiers[1].length - 2)) < 33, `${name} must loop from silence to silence`);
      }
      assert.ok(!gen(dur, 2, 7).equals(gen(dur, 2, 42)), `${name}: the seed must change the arrangement`);
    }
    console.log("   ✓ Noise genres: deterministic, three tiers, all bars near the other genres' level, seamless.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
