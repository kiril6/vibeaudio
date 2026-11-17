const { generateLofiLoop, assert, TEST_DIR } = require("../helpers");

(async () => {
// 10. Adaptive Escalation Tiers
console.log("10. Testing Adaptive Escalation Tiers...");
const tier1Buf = generateLofiLoop(1.0, 1);
const tier3Buf = generateLofiLoop(1.0, 3);
assert.ok(tier1Buf.length > 44, "Tier 1 loop must have content");
assert.ok(tier3Buf.length > 44, "Tier 3 loop must have content");
console.log("   ✓ Adaptive escalation tiers (Tier 1 Ambient -> Tier 3 Peak) generate successfully.");


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
