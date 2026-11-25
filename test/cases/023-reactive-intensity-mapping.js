const { assert, path, os, fs, TEST_DIR, toolTier, installHooksFn } = require("../helpers");

(async () => {
// 23. Reactive Mode: tool calls drive intensity
console.log("23. Testing Reactive Intensity Mapping...");

assert.strictEqual(toolTier("Read"), 1, "reading stays sparse");
assert.strictEqual(toolTier("Grep"), 1);
assert.strictEqual(toolTier("Edit"), 2, "edits bring in the groove");
assert.strictEqual(toolTier("Bash"), 3, "shelling out goes to peak");
assert.strictEqual(toolTier("SomeFutureTool"), 2, "unknown tools must not swing the mix");
// Gemini and Copilot name their tools differently; unmapped, every call sat on the fallback.
assert.strictEqual(toolTier("search_file_content"), 1, "Gemini's grep stays sparse");
assert.strictEqual(toolTier("replace"), 2, "Gemini's edit is an edit");
assert.strictEqual(toolTier("run_shell_command"), 3, "Gemini's shell goes to peak");
assert.strictEqual(toolTier("bash"), 3, "Copilot's shell goes to peak");

// Rising is immediate, falling waits for three calmer calls in a row.
const { nextIntensity } = require("../../src/hook-core");
assert.strictEqual(nextIntensity("", 1), "1 0", "first call sets the tier");
assert.strictEqual(nextIntensity("1 0", 3), "3 0", "a heavier call rises at once");
let st = "3 0";
st = nextIntensity(st, 1); assert.strictEqual(st, "3 1", "one Read does not drop the music");
st = nextIntensity(st, 1); assert.strictEqual(st, "3 2");
assert.strictEqual(nextIntensity("3 2", 3), "3 0", "a heavy call in between resets the streak");
st = nextIntensity(st, 1); assert.strictEqual(st, "1 0", "the third calm call in a row brings it down");
assert.strictEqual(nextIntensity("3", 2), "3 1", "a file from before the streak still reads");

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
