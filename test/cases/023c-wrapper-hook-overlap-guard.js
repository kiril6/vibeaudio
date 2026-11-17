const { path, os, fs, installHooksFn, assert, uninstallHooks, windowsCommandNeedsShell, TEST_DIR } = require("../helpers");

(async () => {
// 23c. The wrapper must stand down when hooks already cover Claude Code.
// Otherwise `vibe claude` layers a session-long stream over the hook daemon's.
console.log("23c. Testing Wrapper/Hook Overlap Guard...");
const { hooksAlreadyCover } = require("../../src/cli");
const coverFile = path.join(os.tmpdir(), `vibeaudio-cover-${process.pid}.json`);

fs.writeFileSync(coverFile, "{}");
installHooksFn("lofi", 0.4, coverFile);
assert.strictEqual(hooksAlreadyCover(["claude"], coverFile), true, "wrapper must defer to installed hooks");
assert.strictEqual(
  hooksAlreadyCover(["/opt/homebrew/bin/claude"], coverFile), true,
  "an absolute path to claude must still be recognised"
);
assert.strictEqual(hooksAlreadyCover(["npm", "test"], coverFile), false, "other commands keep the wrapper");
assert.strictEqual(hooksAlreadyCover(["aider"], coverFile), false, "a tool without hooks keeps the wrapper");

uninstallHooks(coverFile);
assert.strictEqual(hooksAlreadyCover(["claude"], coverFile), false, "without hooks the wrapper takes over again");

fs.writeFileSync(coverFile, "{ not json");
assert.strictEqual(hooksAlreadyCover(["claude"], coverFile), false, "unreadable settings must not crash the wrapper");
fs.unlinkSync(coverFile);
console.log("   ✓ Wrapper defers to installed hooks and keeps working without them.");

// Windows command dispatch must not send real executables through cmd.exe.
// cmd.exe splits an unquoted path like C:\Program Files\nodejs\node.exe at
// the space, while .cmd/.bat wrappers still require a shell.
assert.strictEqual(
  windowsCommandNeedsShell("C:\\Program Files\\nodejs\\node.exe"),
  false,
  "Windows .exe paths must bypass the shell"
);
assert.strictEqual(
  windowsCommandNeedsShell("C:\\Program Files\\nodejs\\npm.cmd"),
  true,
  "Windows .cmd wrappers still require the shell"
);
assert.strictEqual(
  windowsCommandNeedsShell("npm"),
  true,
  "bare commands must preserve Windows shell resolution"
);


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
