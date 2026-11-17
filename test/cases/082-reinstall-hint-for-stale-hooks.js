const { fs, path, os, assert, TEST_DIR } = require("../helpers");

(async () => {
  console.log("\n\x1b[1m[82] reinstall hint for stale hooks\x1b[0m");
  // [82] An install from before an event existed gets a reinstall hint (#86).
  {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-stale-"));
    try {
      const env = { ...process.env, HOME: home, USERPROFILE: home, VIBE_CACHE_DIR: path.join(home, "cache") };
      delete env.CLAUDE_CONFIG_DIR;
      const CLI_JS = path.join(TEST_DIR, "..", "src", "cli.js");
      const stale = () =>
        JSON.parse(
          require("child_process").spawnSync(process.execPath, ["-e", `process.stdout.write(JSON.stringify(require(${JSON.stringify(CLI_JS)}).staleHookAgents()))`], {
            env, encoding: "utf8", timeout: 20000, killSignal: "SIGKILL"
          }).stdout
        );
      fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
      assert.deepStrictEqual(stale(), [], "nothing installed, nothing stale");
      const inst = require("child_process").spawnSync(process.execPath, [path.join(TEST_DIR, "..", "bin", "vibeaudio.js"), "--install-hooks", "--tools", "claude"], { env, encoding: "utf8", timeout: 20000 });
      assert.strictEqual(inst.status, 0, inst.stderr);
      assert.deepStrictEqual(stale(), [], "a fresh install is complete");
      const file = path.join(home, ".claude", "settings.json");
      const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
      delete cfg.hooks.SessionEnd;
      fs.writeFileSync(file, JSON.stringify(cfg));
      assert.deepStrictEqual(stale(), ["Claude Code"], "an install missing an event is named");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
    console.log("   ✓ Hooks installed before a new event existed are named in the update notice.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
