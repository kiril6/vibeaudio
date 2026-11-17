const { fs, path, os, assert, TEST_DIR } = require("../helpers");

(async () => {
  // [64] The Gemini CLI extension: built from TARGETS.gemini, it runs a whole
  // turn when Gemini calls it, and steps aside for installed Gemini hooks.
  console.log("\n\x1b[1m[64] The Gemini CLI extension\x1b[0m");
  {
    const { spawnSync } = require("child_process");
    const hooks = require("../../src/hooks");
    const { buildGeminiExtension } = require("../../scripts/gemini-extension");
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-gext-"));
    try {
      const dir = buildGeminiExtension(out);
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, "gemini-extension.json"), "utf8"));
      assert.strictEqual(manifest.version, require("../../package.json").version, "the extension carries the release's version");
      assert.ok(fs.existsSync(path.join(dir, "bin", "vibeaudio.js")) && fs.existsSync(path.join(dir, "src", "hooks.js")), "the extension ships the CLI");
      const declared = JSON.parse(fs.readFileSync(path.join(dir, "hooks", "hooks.json"), "utf8")).hooks;
      assert.deepStrictEqual(Object.keys(declared).sort(), [...hooks.expectedEvents("gemini")].sort(), "the extension's events are TARGETS.gemini's");
      for (const [event, entries] of Object.entries(declared)) {
        const h = entries[0].hooks[0];
        assert.ok(h.command.startsWith('node "${extensionPath}${/}bin${/}vibeaudio.js" --hook-'), h.command);
        assert.ok(h.command.endsWith(` --plugin --event ${event}`));
        assert.strictEqual(h.timeout, 5000, "Gemini's timeouts are milliseconds");
      }
      assert.strictEqual(hooks.pluginAgent({ GEMINI_PROJECT_DIR: "/w", CLAUDE_PROJECT_DIR: "/w" }), "gemini");
      assert.strictEqual(hooks.pluginAgent({ QWEN_PROJECT_DIR: "/w", GEMINI_PROJECT_DIR: "/w" }), "qwen", "Qwen, a fork, sets Gemini's variable too");

      // Gemini substitutes the variables itself; do the same and run a turn.
      const home = path.join(out, "home");
      const env = { ...process.env, HOME: home, USERPROFILE: home, VIBE_DISABLE: "1", GEMINI_PROJECT_DIR: out };
      const command = (event) => declared[event][0].hooks[0].command.replace(/\$\{extensionPath\}/g, dir).replace(/\$\{\/\}/g, path.sep);
      const fire = (event, payload = {}) => {
        const r = spawnSync(command(event), { shell: true, env, input: JSON.stringify({ session_id: "g1", hook_event_name: event, cwd: out, ...payload }), timeout: 10000 });
        assert.strictEqual(r.status, 0, String(r.stderr));
      };
      const session = path.join(home, ".vibeaudio", "sessions", "g1.json");
      fire("BeforeAgent");
      assert.ok(fs.existsSync(session), "BeforeAgent starts a turn");
      fire("AfterAgent");
      assert.ok(!fs.existsSync(session), "AfterAgent ends it");

      // Installed Gemini hooks win, as for the plugin.
      hooks.installHooks("lofi", 0.4, path.join(home, ".gemini", "settings.json"), { id: "gemini" });
      fire("BeforeAgent");
      assert.ok(!fs.existsSync(session), "the extension steps aside for installed Gemini hooks");
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
    console.log("   ✓ The extension's hooks are TARGETS.gemini's, run a turn as Gemini calls them, and step aside for installed hooks.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
