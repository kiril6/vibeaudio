const { path, assert, TEST_DIR, spawn, CLI } = require("../helpers");

(async () => {
// 24. Exit Codes Propagate (end-to-end)
// Regression: a signal-killed child reported code null, which was mapped to 0 -
// an aborted run claimed success and played the success chime.
console.log("24. Testing Exit Code Propagation (end-to-end)...");



// A grace window longer than the test keeps these runs completely silent.
function runCli(args, killAfterMs = null) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, "--grace", "60000", "--no-hud", ...args], { stdio: "ignore" });
    if (killAfterMs !== null) setTimeout(() => child.kill("SIGINT"), killAfterMs);
    child.on("close", (code) => resolve(code));
  });
}

// Spawn node rather than sleep/true/false: those are Unix shell builtins the
// Windows CI job has no equivalent for, and node is by definition present.
// These two run through executeCommand, which spawns with shell:true on
// Windows - and Node does not quote args for cmd. Keep them free of spaces,
// quotes and parens, or cmd eats them. (NODE_HANG only runs on posix.)
const NODE_OK = [process.execPath, "-e", "0"];
const NODE_FAIL = [process.execPath, "-e", "process.exitCode=1"];
const NODE_HANG = [process.execPath, "-e", "setTimeout(() => {}, 30000)"];

  assert.strictEqual(await runCli(NODE_OK), 0, "successful command must exit 0");
  assert.strictEqual(await runCli(NODE_FAIL), 1, "failing command must propagate exit 1");
  if (process.platform === "win32") {
    // Windows has no POSIX signals; SIGINT to a detached child is not the
    // same mechanism, so the 130 mapping is a Unix-only guarantee.
    console.log("   ✓ Success (0) and failure (1) exit codes propagate (signal test skipped on Windows).");
  } else {
    assert.strictEqual(await runCli(NODE_HANG, 400), 130, "SIGINT must exit 130, not 0");
    console.log("   ✓ Success (0), failure (1) and interrupt (130) exit codes all propagate.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
