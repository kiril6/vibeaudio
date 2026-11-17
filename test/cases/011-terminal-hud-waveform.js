const { assert, TEST_DIR, TerminalHud } = require("../helpers");

(async () => {
// 11. Terminal HUD & Waveform
console.log("11. Testing Terminal HUD & Waveform...");

const hud = new TerminalHud("synthwave");
assert.strictEqual(hud.genre, "synthwave");
console.log("   ✓ Terminal HUD initializes correctly.");


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
