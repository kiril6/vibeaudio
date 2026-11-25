const { assert } = require("../helpers");

(async () => {
  // [92] drone's held tone sits where small speakers play.
  //
  // Its roots were D1/A1/E1 (37-55 Hz). Laptop speakers play almost nothing
  // below ~120 Hz, and above 150 Hz the tone measured 9-30 dB under the noise
  // bed, so the genre was heard as noise alone and taken for rain. The stuck
  // heartbeat holds its tonic between 110 and 220 Hz for the same reason.
  {
    console.log("\n\x1b[1m[92] drone's tone is audible on small speakers\x1b[0m");
    const { noteToFreq } = require("../../src/synth/generator");
    const { DRONE_VARIANTS } = require("../../src/synth/drone");
    for (const v of DRONE_VARIANTS) {
      const hz = noteToFreq(v.root);
      assert.ok(hz >= 110, `drone variant "${v.label}" sits at ${v.root} (${hz.toFixed(1)} Hz), under what laptop speakers play`);
    }
    console.log("   ✓ Every drone root is at 110 Hz or above.");
  }
})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
