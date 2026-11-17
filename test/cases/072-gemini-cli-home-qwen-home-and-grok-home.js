const { fs, path, os, assert, TEST_DIR } = require("../helpers");

(async () => {
  // [72] Gemini CLI, Qwen Code and Grok follow their own config-dir variables (#37).
  console.log("\n\x1b[1m[72] GEMINI_CLI_HOME, QWEN_HOME and GROK_HOME\x1b[0m");
  {
    const { spawnSync } = require("child_process");
    const hooks = require("../../src/hooks");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-cfgdir2-"));
    const dirs = { gemini: path.join(home, "else", "g"), qwen: path.join(home, "else", "q"), grok: path.join(home, "else", "k") };
    const vars = { GEMINI_CLI_HOME: dirs.gemini, QWEN_HOME: dirs.qwen, GROK_HOME: dirs.grok };
    try {
      const own = os.homedir();
      assert.strictEqual(hooks.TARGETS.gemini.file(), path.join(own, ".gemini", "settings.json"), "unset: the defaults");
      Object.assign(process.env, vars);
      // GEMINI_CLI_HOME replaces the home, so the agent's folder is inside it;
      // QWEN_HOME and GROK_HOME are the folder itself.
      assert.strictEqual(hooks.TARGETS.gemini.file(), path.join(dirs.gemini, ".gemini", "settings.json"));
      assert.strictEqual(hooks.TARGETS.qwen.file(), path.join(dirs.qwen, "settings.json"));
      assert.strictEqual(hooks.TARGETS.grok.file(), path.join(dirs.grok, "hooks", "vibeaudio.json"));
      assert.strictEqual(hooks.TARGETS.grok.configDir(), dirs.grok, "detection looks where the agent keeps its config");
      // Qwen expands a leading ~ and resolves the rest, as its resolvePath() does.
      process.env.QWEN_HOME = "~/elsewhere/q";
      assert.strictEqual(hooks.qwenHome(), path.join(own, "elsewhere", "q"));
      process.env.QWEN_HOME = "~";
      assert.strictEqual(hooks.qwenHome(), own);
      for (const k of Object.keys(vars)) process.env[k] = "";
      assert.strictEqual(hooks.TARGETS.qwen.file(), path.join(own, ".qwen", "settings.json"), "an empty variable is unset, never a relative path");
      assert.strictEqual(hooks.grokHome(), path.join(own, ".grok"));
      assert.strictEqual(hooks.geminiDir(), path.join(own, ".gemini"));
    } finally {
      for (const k of Object.keys(vars)) delete process.env[k];
    }

    // End to end: the install writes there and nothing under HOME.
    try {
      const env = { ...process.env, ...vars, HOME: home, USERPROFILE: home, VIBE_DISABLE: "1", VIBE_NO_UPDATE_CHECK: "1" };
      const install = spawnSync(process.execPath, [path.join(TEST_DIR, "..", "bin", "vibeaudio.js"), "--install-hooks", "--tools", "gemini,qwen,grok"], { env, encoding: "utf8", timeout: 20000 });
      assert.strictEqual(install.status, 0, install.stderr);
      for (const f of [path.join(dirs.gemini, ".gemini", "settings.json"), path.join(dirs.qwen, "settings.json"), path.join(dirs.grok, "hooks", "vibeaudio.json")]) {
        assert.ok(/--hook-start/.test(fs.readFileSync(f, "utf8")), `hooks land in ${f}`);
      }
      for (const d of [".gemini", ".qwen", ".grok"]) assert.ok(!fs.existsSync(path.join(home, d)), `nothing is written to ~/${d}`);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
    console.log("   ✓ Gemini, Qwen and Grok hooks follow their config-dir variables; empty means unset; nothing lands under HOME.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
