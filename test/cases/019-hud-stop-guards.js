const { TerminalHud, assert, TEST_DIR } = require("../helpers");

(async () => {
// 19. HUD Guards Against Unstarted And Repeated Stops
// Regression: cleanup ran twice on interrupt, printing the outcome line twice,
// and a never-started HUD reported a bogus multi-decade runtime.
console.log("19. Testing HUD Stop Guards...");
const unstartedHud = new TerminalHud("lofi");
unstartedHud.stop({ outcome: "success", code: 0 });
assert.strictEqual(unstartedHud.stopped, false, "a HUD that never started must not report an outcome");

const startedHud = new TerminalHud("lofi");
startedHud.start();
startedHud.stop({ outcome: "success", code: 0 });
assert.strictEqual(startedHud.stopped, true);
startedHud.stop({ outcome: "success", code: 0 });
assert.strictEqual(startedHud.timer, null, "repeated stops must stay inert");
console.log("   ✓ HUD ignores unstarted and duplicate stops.");


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
