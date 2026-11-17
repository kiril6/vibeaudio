const { path, os, fs, assert, TEST_DIR, installHooks, uninstallHooks } = require("../helpers");

(async () => {
// 21. Claude Code Hook Install / Uninstall
console.log("21. Testing Claude Code Hook Installation...");

const hookSettings = path.join(os.tmpdir(), `vibeaudio-hooks-${process.pid}.json`);
const foreignHook = { hooks: [{ type: "command", command: "echo other-tool", timeout: 30 }] };
fs.writeFileSync(hookSettings, JSON.stringify({ model: "opus", hooks: { Stop: [foreignHook] } }));

installHooks("jazz", 0.25, hookSettings);
installHooks("zen", 0.25, hookSettings); // installing twice must not duplicate

const afterInstall = JSON.parse(fs.readFileSync(hookSettings, "utf8"));
assert.strictEqual(afterInstall.model, "opus", "unrelated settings must be preserved");
assert.strictEqual(afterInstall.hooks.UserPromptSubmit.length, 1, "repeat installs must not duplicate hooks");
assert.strictEqual(afterInstall.hooks.Stop.length, 2, "another tool's hook must survive alongside ours");
assert.strictEqual(afterInstall.hooks.Stop[0].hooks[0].command, "echo other-tool");
// Genre and volume are deliberately absent from the command line: each hook
// reads the saved config when it fires, which is what lets `vibe --genre jazz`
// change installed hooks without reinstalling them.
assert.ok(
  !/--genre|--volume/.test(afterInstall.hooks.UserPromptSubmit[0].hooks[0].command),
  "hook commands must not pin genre or volume"
);

const { removed } = uninstallHooks(hookSettings);
const afterUninstall = JSON.parse(fs.readFileSync(hookSettings, "utf8"));
fs.unlinkSync(hookSettings);
// start, stop, and Claude's 2 wait + 3 resume + StopFailure + SessionEnd
assert.strictEqual(removed, 9, "all nine hooks must be removed");
assert.deepStrictEqual(afterUninstall.hooks.Stop, [foreignHook], "uninstall must leave foreign hooks untouched");
assert.strictEqual(afterUninstall.hooks.UserPromptSubmit, undefined, "emptied events must be dropped");
assert.strictEqual(afterUninstall.hooks.PermissionRequest, undefined, "the wait hook must go too");
console.log("   ✓ Hooks install idempotently, merge safely and uninstall cleanly.");


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
