const { assert, TEST_DIR } = require("../helpers");

(async () => {
  // --- 35. Sparse piano ---
  console.log("\n\x1b[1m[35] Sparse Piano Generator\x1b[0m");
  {
    const { generatePianoLoop } = require("../../src/synth/piano");

    const level = (buf) => {
      let peak = 0, sum = 0, n = 0;
      for (let o = 44; o + 1 < buf.length; o += 2) {
        const v = buf.readInt16LE(o) / 32768;
        peak = Math.max(peak, Math.abs(v));
        sum += v * v;
        n++;
      }
      return { peak, rms: Math.sqrt(sum / n) };
    };

    const tiers = [1, 2, 3].map((t) => generatePianoLoop(7.6, t, 4242));

    assert.ok(
      generatePianoLoop(7.6, 2, 4242).equals(tiers[1]),
      "the same seed and tier must render byte-identical audio"
    );
    assert.ok(
      !tiers[0].equals(tiers[1]) && !tiers[1].equals(tiers[2]),
      "each tier must honour its argument - identical files would disable escalation"
    );

    let previous = 0;
    for (let i = 0; i < 3; i++) {
      const { peak, rms } = level(tiers[i]);
      // Volume is applied after this, so a hot render just clips earlier.
      assert.ok(peak < 0.95, `tier ${i + 1} must not clip (peak ${peak.toFixed(3)})`);
      // Level-matched to the rest: measured across 12 seeds this sits at
      // 0.056-0.138, between jazz (0.118 at tier 3) and drone (0.141).
      assert.ok(rms > 0.05 && rms < 0.15, `tier ${i + 1} rms ${rms.toFixed(4)} is off the house level`);
      assert.ok(rms > previous, `tier ${i + 1} must add weight over tier ${i}`);
      previous = rms;
    }

    // The loop is spawned again before the previous one ends, so the ends have
    // to be silent or every repeat clicks.
    const edges = [
      Math.abs(tiers[1].readInt16LE(44)),
      Math.abs(tiers[1].readInt16LE(tiers[1].length - 2))
    ];
    assert.ok(Math.max(...edges) < 32, "loop boundaries must fade to silence");

    console.log("   ✓ Piano is deterministic, escalates, stays level-matched and loops seamlessly.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
