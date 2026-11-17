const { assert, os } = require("../helpers");

// A case that hangs is named with the process tree under it, and its
// grandchildren die with it (#58): the next macOS/Node 18 hang should say which
// system child stalled.
(async () => {
  console.log("\n\x1b[1m[83] The runner names a hung case\x1b[0m");
  if (process.platform === "win32") {
    console.log("   ✓ Skipped on Windows (the tree dump needs ps).");
    return;
  }
  const fs = require("fs");
  const path = require("path");
  const { spawnSync } = require("child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-runner-"));
  try {
    const marker = `vibe-hang-${process.pid}`;
    fs.writeFileSync(
      path.join(dir, "001-hangs.js"),
      `require("child_process").spawn("sleep", ["${marker.length + 900}"], { stdio: "ignore" }); setTimeout(() => {}, 1e6);\n`
    );
    fs.writeFileSync(path.join(dir, "002-passes.js"), "0;\n");
    const r = spawnSync(process.execPath, [path.join(__dirname, "..", "run.js")], {
      env: { ...process.env, VIBE_TEST_CASES_DIR: dir, VIBE_TEST_CASE_TIMEOUT_MS: "2000" },
      encoding: "utf8",
      timeout: 30000,
      killSignal: "SIGKILL"
    });
    assert.strictEqual(r.status, 1, "a hung case fails the run");
    assert.ok(/001-hangs\.js has run for 2s\. Process tree under it/.test(r.stderr), "the hung case is named");
    assert.ok(/sleep \d+/.test(r.stderr), "the stuck child is in the dump");
    assert.ok(/1 of 2 cases failed/.test(r.stderr), "the case after it still ran");
    const alive = spawnSync("pgrep", ["-f", `sleep ${marker.length + 900}`], { encoding: "utf8" });
    assert.notStrictEqual(alive.status, 0, "its grandchild was killed with it");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log("   ✓ A hung case is killed with its children, named, and shown with its process tree.");
})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
