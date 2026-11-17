const { generateJazzLoop, assert, TEST_DIR } = require("../helpers");

(async () => {
// 7. Midnight Jazz Engine
console.log("7. Testing Jazz Generator...");
const jazzBuf = generateJazzLoop(1.0);
assert.ok(jazzBuf.length > 44, "Jazz buffer must have audio content");
console.log(`   ✓ Jazz engine generated ${jazzBuf.length} bytes.`);


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
