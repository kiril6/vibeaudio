const { parseArgs, assert, TEST_DIR } = require("../helpers");

(async () => {
// 13. Volume Presets & Independent Chime Volume
console.log("13. Testing Volume Presets & Independent Chime Volume...");
const quietParsed = parseArgs(["node", "bin/vibeaudio.js", "--quiet", "-cv", "70", "gemini"]);
assert.strictEqual(quietParsed.volume, 0.25, "--quiet should set volume to 0.25");
assert.strictEqual(quietParsed.chimeVolume, 0.70, "-cv should set chimeVolume to 0.70");

const whisperParsed = parseArgs(["node", "bin/vibeaudio.js", "--whisper", "claude"]);
assert.strictEqual(whisperParsed.volume, 0.15, "--whisper should set volume to 0.15");

const loudParsed = parseArgs(["node", "bin/vibeaudio.js", "--loud", "claude"]);
assert.strictEqual(loudParsed.volume, 0.75, "--loud should set volume to 0.75");
// Regression: MCP parsed volume itself and skipped the NaN guard, so
// VIBE_VOLUME=loud reached the player as NaN and afplay got `-v NaN`.
const { normalizeVolume } = require("../../src/player");
assert.strictEqual(normalizeVolume("50", 0.4), 0.5, "string percent parses");
assert.strictEqual(normalizeVolume(50, 0.4), 0.5, "MCP sends a number, not a string");
assert.strictEqual(normalizeVolume("loud", 0.4), 0.4, "unparseable value must fall back, not yield NaN");
assert.strictEqual(normalizeVolume(undefined, 0.4), 0.4, "missing value falls back");
assert.strictEqual(normalizeVolume(undefined, null), null, "chime volume keeps its null default");
assert.strictEqual(normalizeVolume("200", 0.4), 1, "clamps to 100");
assert.strictEqual(normalizeVolume("-5", 0.4), 0.05, "clamps to the 5 floor");
console.log("   ✓ Volume presets (--whisper, --quiet, --loud) and --chime-volume work properly.");


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
