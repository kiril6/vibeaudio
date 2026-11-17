const { fs, path, os, spawn, CLI, assert, TEST_DIR } = require("../helpers");

(async () => {
  // 32. --status and --stop must run clean on a machine with nothing set up
  console.log("32. Testing --status And --stop...");
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-status-"));
  const runFlag = (flag) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI, flag], {
        env: { ...process.env, HOME: emptyHome, USERPROFILE: emptyHome, VIBE_DISABLE: "" },
        stdio: ["ignore", "pipe", "pipe"]
      });
      let out = "";
      child.stdout.on("data", (c) => (out += c));
      child.stderr.on("data", (c) => (out += c));
      child.on("close", (code) => resolve({ code, out }));
    });

  const status = await runFlag("--status");
  assert.strictEqual(status.code, 0, "--status must exit 0 with nothing installed");
  assert.ok(/not installed/.test(status.out), "--status must say when hooks are missing");
  assert.ok(/not running/.test(status.out), "--status must say when no player is running");

  const stopped = await runFlag("--stop");
  assert.strictEqual(stopped.code, 0, "--stop must exit 0 when nothing is playing");
  assert.ok(/Nothing was playing/.test(stopped.out), "--stop must say so rather than claim a kill");

  fs.rmSync(emptyHome, { recursive: true, force: true });
  console.log("   ✓ --status reports missing pieces and --stop is safe with nothing running.");


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
