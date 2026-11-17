const { assert, fs, path, os, TEST_DIR } = require("../helpers");

(async () => {
  // 26. Command lookup must work off Unix too
  console.log("26. Testing Command Lookup...");
  const { isInstalled } = require("../../src/interactive");
  assert.strictEqual(isInstalled("node"), true, "node is on PATH in any environment running this suite");
  assert.strictEqual(isInstalled("definitely-not-a-real-command-xyz"), false, "missing commands report false");
  // The lookup reads PATH off the disk (no `which`/`where` to hang, #58): only the PATH given counts,
  // a plain file is not a command, and Windows resolves a bare name through PATHEXT.
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-scan-"));
    const exe = process.platform === "win32" ? "tool.cmd" : "tool";
    fs.writeFileSync(path.join(dir, exe), "x", { mode: 0o755 });
    fs.writeFileSync(path.join(dir, "plain.txt"), "x", { mode: 0o644 });
    assert.strictEqual(isInstalled("tool", { PATH: dir }), true, "an executable in PATH is found by its bare name");
    assert.strictEqual(isInstalled("tool", { PATH: os.tmpdir() }), false, "and only on the PATH it was given");
    assert.strictEqual(isInstalled("tool", { PATH: "" }), false, "an empty PATH finds nothing");
    if (process.platform !== "win32") assert.strictEqual(isInstalled("plain.txt", { PATH: dir }), false, "a file without the execute bit is not a command");
    assert.strictEqual(isInstalled(path.join(dir, exe), { PATH: "" }), true, "a name with a separator is a path");
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log("   ✓ Tool detection resolves real commands and rejects missing ones.");


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
