const { assert } = require("../helpers");

(async () => {
  // [91] A note that stops, stops at zero.
  //
  // jazz's walking bass ended each note at 0.95 of a beat still at ~14% of its
  // level, and its tier-3 stabs at ~22%: a click on every beat from tier 2,
  // heard as static (with the brushes muted, so not the noise). The same cut
  // was in synthwave's bass at each slot end (a slot is not a whole number of
  // steps), its arp at 6.6 s, and lofi's first chord where the second starts.
  // Each now ramps out over 20 ms, as jazz's comping already did.
  //
  // [49] missed these: its one-sample limit for jazz is 0.07 and the steps
  // were 0.014 to 0.028. This looks for an isolated step instead: a second
  // difference far above that of the audio around it. A render of main had
  // 26 such steps in jazz tier 2, 8 in synthwave tier 2 and 2 in lofi tier 1;
  // with the releases, none. lofi is checked at tier 1 only: its kalimba from
  // tier 2 starts at full level, an attack transient this detector also finds,
  // and zen's bowl onsets are the same kind; neither was reported, neither is
  // a cut, so they are out of scope here. 8bit is pulse-based, as in [49].
  {
    console.log("\n\x1b[1m[91] Notes end at zero\x1b[0m");
    const { generateLoop } = require("../../src/player");

    function isolatedSteps(wav) {
      const x = [];
      for (let off = 44; off + 4 <= wav.length; off += 4) x.push(wav.readInt16LE(off) / 32768);
      const d = new Float64Array(x.length);
      for (let i = 2; i < x.length; i++) d[i] = Math.abs(x[i] - 2 * x[i - 1] + x[i - 2]);
      const sq = new Float64Array(x.length + 1);
      for (let i = 0; i < x.length; i++) sq[i + 1] = sq[i] + d[i] * d[i];
      const found = [];
      const half = 200;
      for (let i = 2; i < x.length - 1; i++) {
        if (d[i] < 0.004) continue;
        const a = Math.max(0, i - half);
        const b = Math.min(x.length, i + half);
        // The neighbourhood without the step itself and the samples beside it.
        const rest = sq[b] - sq[a] - d[i - 1] ** 2 - d[i] ** 2 - d[i + 1] ** 2;
        if (d[i] > 8 * Math.sqrt(rest / (b - a - 3))) found.push((i / 44100).toFixed(3));
      }
      return found;
    }

    const CASES = [["synthwave", [1, 2, 3]], ["jazz", [1, 2, 3]], ["lofi", [1]]];
    for (const [genre, tiers] of CASES) {
      for (const seed of [1, 7, 42]) {
        for (const tier of tiers) {
          for (const bar of [0, 1, 2]) {
            const steps = isolatedSteps(generateLoop(genre, tier, seed, bar));
            assert.strictEqual(steps.length, 0,
              `${genre} seed ${seed} tier ${tier} bar ${bar}: a note stops dead at ${steps.slice(0, 4).join(", ")} s`);
          }
        }
      }
    }
    console.log("   ✓ jazz's bass and stabs, synthwave's bass and arp and lofi's chords ramp out instead of cutting.");
  }
})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
