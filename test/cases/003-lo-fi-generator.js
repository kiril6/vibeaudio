const { generateLofiLoop, assert, TEST_DIR } = require("../helpers");

(async () => {
// 3. Lo-Fi Engine
console.log("3. Testing Lo-Fi Generator...");
const lofiBuf = generateLofiLoop(1.0);
assert.ok(lofiBuf.length > 44, "Lo-Fi buffer must have audio content");
console.log(`   ✓ Lo-Fi engine generated ${lofiBuf.length} bytes.`);


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
