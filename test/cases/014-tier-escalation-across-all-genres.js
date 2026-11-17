const { generateLofiLoop, generateSynthwaveLoop, generateChiptuneLoop, generateElectronicLoop, generateJazzLoop, generateZenLoop, assert, TEST_DIR, tieredGenerators } = require("../helpers");

(async () => {
// 14. Adaptive Escalation Is Audible In Every Genre
// Regression: chiptune/electronic/jazz/zen used to ignore the tier argument,
// so all three cached tier files were byte-identical.
console.log("14. Testing Tier Escalation Across All Genres...");

function rmsOf(wavBuf) {
  let sum = 0;
  let count = 0;
  for (let off = 44; off + 1 < wavBuf.length; off += 2) {
    const v = wavBuf.readInt16LE(off) / 32768;
    sum += v * v;
    count++;
  }
  return Math.sqrt(sum / count);
}



for (const [name, generate] of Object.entries(tieredGenerators)) {
  const buf1 = generate(3.0, 1);
  const buf2 = generate(3.0, 2);
  const buf3 = generate(3.0, 3);

  assert.ok(!buf1.equals(buf3), `${name}: tier 1 and tier 3 must not be identical audio`);
  assert.ok(!buf2.equals(buf3), `${name}: tier 2 and tier 3 must not be identical audio`);

  // Two genres dither with noise, so require a change far larger than dither
  // to prove the tier argument actually reshapes the arrangement.
  const rms1 = rmsOf(buf1);
  const rms3 = rmsOf(buf3);
  const delta = Math.abs(rms3 - rms1) / rms1;
  assert.ok(delta > 0.05, `${name}: tier 1 -> 3 must change level materially (got ${(delta * 100).toFixed(1)}%)`);
}
console.log(`   ✓ All ${Object.keys(tieredGenerators).length} genres render distinct audio per tier.`);


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
