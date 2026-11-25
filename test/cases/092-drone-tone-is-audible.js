const { assert } = require("../helpers");

(async () => {
  // [92] drone's held tone sits where small speakers play, over a steady bed.
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

    // With the tone raised it still read as surf: the noise bed's sweep made
    // the loop swell 6-11 dB twice over (10.9 dB at worst over these renders, 5.3 now). A steadier,
    // quieter bed was chosen by ear; this keeps it from swelling again.
    const { generateLoop } = require("../../src/player");
    let worst = 0;
    let where = "";
    for (const seed of [1, 7, 42]) {
      for (const tier of [1, 2, 3]) {
        for (const bar of [0, 1, 2]) {
          const wav = generateLoop("drone", tier, seed, bar);
          const windows = [];
          let sum = 0;
          let n = 0;
          for (let off = 44; off + 4 <= wav.length; off += 4) {
            const v = wav.readInt16LE(off) / 32768;
            sum += v * v;
            if (++n === 4410) { windows.push(Math.sqrt(sum / n)); sum = 0; n = 0; }
          }
          const inner = windows.slice(3, -3); // Clear of the boundary fades.
          const swing = 20 * Math.log10(Math.max(...inner) / Math.min(...inner));
          if (swing > worst) { worst = swing; where = `seed ${seed} tier ${tier} bar ${bar}`; }
        }
      }
    }
    assert.ok(worst < 6, `drone swells ${worst.toFixed(1)} dB within a loop (${where}) - it reads as waves`);
    console.log(`   ✓ drone's level holds within ${worst.toFixed(1)} dB across a loop.`);
  }
})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
