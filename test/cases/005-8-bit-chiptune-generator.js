const { generateChiptuneLoop, assert, TEST_DIR } = require("../helpers");

(async () => {
// 5. Chiptune Engine
console.log("5. Testing 8-Bit Chiptune Generator...");
const chipBuf = generateChiptuneLoop(1.0);
assert.ok(chipBuf.length > 44, "Chiptune buffer must have audio content");
console.log(`   ✓ Chiptune engine generated ${chipBuf.length} bytes.`);


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
