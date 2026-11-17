const { fs, path, os, assert, parseArgs, TEST_DIR } = require("../helpers");

(async () => {
  // [54] --doctor judges the setup and exits non-zero only on a real failure.
  {
    console.log("\n\x1b[1m[54] --doctor judges the setup and exits 1 on a real failure\x1b[0m");
    const docHome = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-doctor-"));
    fs.mkdirSync(path.join(docHome, ".vibeaudio"), { recursive: true });
    fs.mkdirSync(path.join(docHome, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(docHome, ".vibeaudio", "config.json"), "{ not json");
    fs.writeFileSync(path.join(docHome, ".claude", "settings.json"), JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: "command", command: "'/nonexistent/node' '/nonexistent/cli.js' --hook-stop" }] }] }
    }));
    const r = require("child_process").spawnSync(process.execPath, [path.join(TEST_DIR, "..", "bin", "vibeaudio.js"), "--doctor"], {
      env: { ...process.env, HOME: docHome, USERPROFILE: docHome, VIBE_NO_UPDATE_CHECK: "1" },
      encoding: "utf8",
      // A stall must fail in a minute, not hold a CI runner for six hours.
      timeout: 60000,
      killSignal: "SIGKILL"
    });
    fs.rmSync(docHome, { recursive: true, force: true });
    assert.notStrictEqual(r.status, null, "--doctor must finish: it timed out");
    const out = r.stdout.replace(/\x1b\[[0-9;]*m/g, "");
    assert.strictEqual(r.status, 1, "a failing check must make the exit code non-zero");
    assert.ok(/✘ Saved settings/.test(out), "an unparseable config.json is reported");
    assert.ok(/✘ Claude Code hooks[^\n]*no longer exists/.test(out), "a hook pointing at a missing binary is reported");
    assert.ok(/fix: vibe --install-hooks/.test(out), "each failure carries its fix");
    assert.strictEqual(parseArgs(["node", "vibe", "--doctor"]).doctor, true);
    assert.strictEqual(parseArgs(["node", "vibe", "npm", "test", "--doctor"]).doctor, false, "after the command it is the child's flag");

    console.log("   ✓ --doctor flags a broken config and a dead hook path, names the fix, and exits 1.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
