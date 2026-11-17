const { assert, TEST_DIR } = require("../helpers");

(async () => {
  // 49. Plucked notes start and end at zero
  {
    console.log("\n\x1b[1m[49] No click at a note onset\x1b[0m");
    const { pluckEnv } = require("../../src/synth/generator");
    const step = 0.2727;

    // The bug this replaced: a bare Math.exp(-tNote * decay) is 1.0 the instant
    // tNote wraps to zero, so every note onset stepped the waveform - measured
    // at 0.13 full-scale in synthwave's bass, 3.7 times a second, and reported
    // as static that appeared when the music intensified (those layers only
    // exist from tier 2 up).
    assert.strictEqual(pluckEnv(0, step, 8.0), 0, "a note must start from silence");
    assert.strictEqual(pluckEnv(step, step, 8.0), 0, "and end at silence, so the next one cannot step");
    assert.ok(pluckEnv(0.01, step, 8.0) > 0.9, "but reach full level within ~10ms, or it stops being a pluck");
    assert.ok(pluckEnv(0.15, step, 8.0) < pluckEnv(0.05, step, 8.0), "and still decay in between");

    // Continuity end to end: no single step across a whole note may be large.
    let worst = 0;
    for (let i = 1; i <= 2000; i++) {
      const a = pluckEnv(((i - 1) / 2000) * step, step, 8.0);
      const b = pluckEnv((i / 2000) * step, step, 8.0);
      worst = Math.max(worst, Math.abs(b - a));
    }
    assert.ok(worst < 0.05, `envelope must be continuous, worst step was ${worst.toFixed(4)}`);

    // And the rendered result, since an envelope is only half the story - a
    // voice can reintroduce a click by resetting something else per note.
    // Thresholds are per genre because a waveform may legitimately have edges:
    // 8bit is pulse-based and drone is a noise bed, so both are excluded rather
    // than given a number that would only ever be wrong.
    const { generateLoop } = require("../../src/player");
    const LIMITS = { synthwave: 0.08, electronic: 0.12, lofi: 0.06, jazz: 0.07, zen: 0.05, piano: 0.06 };
    for (const [genre, limit] of Object.entries(LIMITS)) {
      for (const tier of [1, 2, 3]) {
        const wav = generateLoop(genre, tier, 42);
        let prev = null, biggest = 0;
        // 16-bit stereo frames start at byte 44; left channel only.
        for (let off = 44; off + 4 <= wav.length; off += 4) {
          const v = wav.readInt16LE(off) / 32768;
          if (prev !== null) biggest = Math.max(biggest, Math.abs(v - prev));
          prev = v;
        }
        assert.ok(biggest <= limit,
          `${genre} tier ${tier} jumps ${biggest.toFixed(4)} in one sample (limit ${limit}) — a click at a note onset`);
      }
    }
    // 8bit's lead is a saturated pulse, so its own edges are steep by design and
    // a whole-genre limit would only ever be a number about the waveform. Tier 1
    // is the arpeggio and bass alone - no lead - which is precisely the voice
    // that clicked: it runs continuously with no envelope, so a note change that
    // jumps the oscillator's phase has nothing to hide it. It measured 0.1534
    // with 58 steps over 0.05, every one of them landing on an arpeggio
    // boundary; accumulating the phase took it to 0.0289 and none.
    {
      const wav = generateLoop("8bit", 1, 42);
      let prev = null, biggest = 0;
      for (let off = 44; off + 4 <= wav.length; off += 4) {
        const v = wav.readInt16LE(off) / 32768;
        if (prev !== null) biggest = Math.max(biggest, Math.abs(v - prev));
        prev = v;
      }
      assert.ok(biggest <= 0.05,
        `8bit tier 1 jumps ${biggest.toFixed(4)} in one sample — the arpeggio's phase is discontinuous again`);
    }

    console.log("   ✓ Envelopes open and close at zero; no genre steps discontinuously at a note boundary.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
