const { assert, TEST_DIR, measure } = require("../helpers");

(async () => {
  // 30. The drone genre must stay non-melodic and level-matched
  console.log("30. Testing Deep Drone Generator...");
  const { generateDroneLoop } = require("../../src/synth/drone");
  const { generateJazzLoop: jazzRef } = require("../../src/synth/jazz");

  

  const d1 = generateDroneLoop(7, 1, 42);
  const d2 = generateDroneLoop(7, 2, 42);
  const d3 = generateDroneLoop(7, 3, 42);

  assert.ok(!d1.equals(d2) && !d2.equals(d3), "every tier must render differently");
  assert.ok(!generateDroneLoop(7, 2, 7).equals(d2), "the seed must change the arrangement");
  assert.ok(generateDroneLoop(7, 2, 42).equals(d2), "generation stays deterministic");

  // Loud enough to hear, quiet enough to sit with the melodic genres, and
  // never clipping - a noise bed is the easiest thing in here to overdrive.
  const ref = measure(jazzRef(6.26, 2, 42));
  for (const [tier, buf] of [[1, d1], [2, d2], [3, d3]]) {
    const m = measure(buf);
    assert.ok(m.peak < 0.95, `tier ${tier} must not clip (peak ${m.peak.toFixed(3)})`);
    assert.ok(m.rms > 0.05 && m.rms < ref.rms * 1.6, `tier ${tier} must sit near the other genres (rms ${m.rms.toFixed(4)} vs jazz ${ref.rms.toFixed(4)})`);
  }
  assert.ok(measure(d1).rms < measure(d2).rms && measure(d2).rms < measure(d3).rms, "tiers must escalate in weight");

  // Both ends fade to silence, or the loop point clicks every 7 seconds.
  assert.ok(Math.abs(d2.readInt16LE(44)) < 33, "loop must start from silence");
  assert.ok(Math.abs(d2.readInt16LE(d2.length - 2)) < 33, "loop must end in silence");
  console.log("   ✓ Drone escalates, stays level-matched to the melodic genres and loops seamlessly.");


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
