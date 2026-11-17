const { assert, path, os, fs, TEST_DIR, toolTier, installHooksFn } = require("../helpers");

(async () => {
// 23. Reactive Mode: tool calls drive intensity
console.log("23. Testing Reactive Intensity Mapping...");

assert.strictEqual(toolTier("Read"), 1, "reading stays sparse");
assert.strictEqual(toolTier("Grep"), 1);
assert.strictEqual(toolTier("Edit"), 2, "edits bring in the groove");
assert.strictEqual(toolTier("Bash"), 3, "shelling out goes to peak");
assert.strictEqual(toolTier("SomeFutureTool"), 2, "unknown tools must not swing the mix");

const reactiveSettings = path.join(os.tmpdir(), `vibeaudio-reactive-${process.pid}.json`);
fs.writeFileSync(reactiveSettings, "{}");

installHooksFn("lofi", 0.4, reactiveSettings, { reactive: true });
const reactiveOn = JSON.parse(fs.readFileSync(reactiveSettings, "utf8"));
assert.ok(reactiveOn.hooks.PreToolUse, "reactive install must wire PreToolUse");
assert.ok(/--reactive/.test(reactiveOn.hooks.UserPromptSubmit[0].hooks[0].command));

// Reinstalling without --reactive must take the per-tool hook back out.
installHooksFn("lofi", 0.4, reactiveSettings, { reactive: false });
const reactiveOff = JSON.parse(fs.readFileSync(reactiveSettings, "utf8"));
fs.unlinkSync(reactiveSettings);
assert.strictEqual(reactiveOff.hooks.PreToolUse, undefined, "plain install must drop PreToolUse");
assert.ok(!/--reactive/.test(reactiveOff.hooks.UserPromptSubmit[0].hooks[0].command));
console.log("   ✓ Tool tiers map correctly and --reactive toggles PreToolUse cleanly.");


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
