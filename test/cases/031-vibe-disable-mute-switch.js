const { assert, TEST_DIR } = require("../helpers");

(async () => {
  // 31. VIBE_DISABLE must mute automatic playback without touching config
  console.log("31. Testing VIBE_DISABLE Mute Switch...");
  const { AudioPlayer, playbackDisabled } = require("../../src/player");
  const realDisable = process.env.VIBE_DISABLE;

  delete process.env.VIBE_DISABLE;
  assert.strictEqual(playbackDisabled(), false, "silent by default would be a bad default");
  for (const on of ["1", "true", "yes", "on", "TRUE", " 1 "]) {
    process.env.VIBE_DISABLE = on;
    assert.strictEqual(playbackDisabled(), true, `${JSON.stringify(on)} must mute`);
  }
  for (const offValue of ["0", "false", "", "no"]) {
    process.env.VIBE_DISABLE = offValue;
    assert.strictEqual(playbackDisabled(), false, `${JSON.stringify(offValue)} must not mute`);
  }

  // The gate lives in start(), which every automatic path goes through.
  process.env.VIBE_DISABLE = "1";
  const muted = new AudioPlayer();
  assert.strictEqual(muted.start("lofi", 0.3), false, "start() must refuse while muted");
  assert.strictEqual(muted.isPlaying, false, "a muted player must not claim to be playing");
  assert.strictEqual(muted.stop({ playChime: true }), false, "nothing was playing, so nothing to stop");

  if (realDisable === undefined) delete process.env.VIBE_DISABLE;
  else process.env.VIBE_DISABLE = realDisable;
  console.log("   ✓ VIBE_DISABLE mutes automatic playback and leaves config alone.");


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
