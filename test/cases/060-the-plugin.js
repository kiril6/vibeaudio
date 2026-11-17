const { path, fs, assert, parseArgs, os, TEST_DIR } = require("../helpers");

(async () => {
  // [60] The plugin: manifests agree with the package, each hooks file is the
  // one TARGETS generates, Claude Code's file holds only events it accepts, and
  // a hook yields to installed hooks and to events its agent does not use.
  console.log("\n\x1b[1m[60] The plugin\x1b[0m");
  {
    const { spawnSync } = require("child_process");
    const root = path.join(TEST_DIR, "..");
    const readJson = (f) => JSON.parse(fs.readFileSync(path.join(root, f), "utf8"));
    const pkgJson = readJson("package.json");
    const manifest = readJson(".claude-plugin/plugin.json");
    const codexManifest = readJson(".codex-plugin/plugin.json");
    const market = readJson(".claude-plugin/marketplace.json");
    const hooks = require("../../src/hooks");

    for (const m of [manifest, codexManifest]) {
      assert.strictEqual(m.version, pkgJson.version, "manifest versions must track package.json, or a plugin update ships nothing");
      assert.strictEqual(m.name, market.plugins[0].name, "entry name and manifest names must match");
    }
    assert.strictEqual(market.plugins[0].source, "./", "the plugin is the repository root");
    // Claude Code loads hooks/hooks.json by convention and errors with
    // "Duplicate hooks file detected" when the manifest names it as well.
    assert.strictEqual(manifest.hooks, undefined, "Claude Code's manifest must not name its hooks file");
    assert.strictEqual(codexManifest.hooks, "./hooks/codex.json", "Codex must read its own hooks file");

    const regen = `node -e 'const h=require("./src/hooks"),fs=require("fs");for(const[f,a]of Object.entries(h.PLUGIN_FILES))fs.writeFileSync(f,JSON.stringify(h.pluginHooksFile(a),null,2)+"\\n")'`;
    for (const [file, agents] of Object.entries(hooks.PLUGIN_FILES)) {
      const declared = readJson(file).hooks;
      assert.deepStrictEqual(readJson(file), hooks.pluginHooksFile(agents), `${file} is stale; regenerate it: ${regen}`);
      for (const id of agents) {
        for (const event of hooks.expectedEvents(id)) assert.ok(declared[event], `${file} misses ${id}'s ${event}`);
      }
      for (const [event, entries] of Object.entries(declared)) {
        const command = entries[0].hooks[0].command;
        assert.ok(hooks.VIBE_HOOK_FLAG.test(command), `not a vibe hook: ${command}`);
        assert.ok(command.endsWith(` --plugin --event ${event}`), "every plugin hook yields to installed ones and names its event");
        assert.ok(command.includes('"${CLAUDE_PLUGIN_ROOT}/bin/vibeaudio.js"'), "the path must be quoted for spaces");
      }
    }
    // Claude Code rejects an unknown event and then loads none of the file.
    const claudeKnown = new Set([...hooks.expectedEvents("claude"), "Notification"]);
    for (const event of Object.keys(readJson("hooks/hooks.json").hooks)) {
      assert.ok(claudeKnown.has(event), `Claude Code would refuse hooks/hooks.json over ${event}`);
    }
    assert.deepStrictEqual([...hooks.PLUGIN_AGENTS].sort(), ["claude", "codex", "copilot", "qwen"]);

    assert.strictEqual(parseArgs(["node", "vibe", "--hook-start", "--plugin"]).plugin, true);
    assert.strictEqual(parseArgs(["node", "vibe", "--hook-wait", "--plugin", "--event", "Notification"]).hookEvent, "Notification");
    assert.strictEqual(hooks.pluginAgent({ CLAUDE_PLUGIN_ROOT: "/p" }), "claude");
    assert.strictEqual(hooks.pluginAgent({ CLAUDE_PLUGIN_ROOT: "/p", PLUGIN_ROOT: "/p" }), "codex");
    assert.strictEqual(hooks.pluginAgent({ CLAUDE_PLUGIN_ROOT: "/p", PLUGIN_ROOT: "/p", COPILOT_PLUGIN_ROOT: "/p" }), "copilot");
    assert.strictEqual(hooks.pluginAgent({ CLAUDE_PLUGIN_ROOT: "/p", QWEN_PROJECT_DIR: "/w" }), "qwen");

    const home = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-plugin-"));
    const bin = path.join(root, "bin", "vibeaudio.js");
    const env = (extra) => ({ ...process.env, HOME: home, USERPROFILE: home, VIBE_DISABLE: "1", ...extra });
    try {
      // A PermissionRequest is a wait for Claude Code; Copilot fires it before
      // every permission check, so there it must do nothing.
      const sessions = path.join(home, ".vibeaudio", "sessions");
      const waiting = (extra) => {
        fs.mkdirSync(sessions, { recursive: true });
        fs.writeFileSync(path.join(sessions, "plug.json"), JSON.stringify({ started: Date.now(), waiting: null, ts: Date.now() }));
        const run = spawnSync(process.execPath, [bin, "--hook-wait", "--plugin", "--event", "PermissionRequest", "--no-chime"], {
          env: env(extra), input: JSON.stringify({ session_id: "plug", tool_name: "Bash" }), timeout: 10000
        });
        assert.strictEqual(run.status, 0, String(run.stderr));
        return JSON.parse(fs.readFileSync(path.join(sessions, "plug.json"), "utf8")).waiting;
      };
      assert.strictEqual(waiting({}), "Bash", "Claude Code's PermissionRequest is a wait");
      assert.strictEqual(waiting({ COPILOT_PLUGIN_ROOT: home, PLUGIN_ROOT: home }), null, "Copilot's PermissionRequest is not");
      fs.rmSync(path.join(home, ".vibeaudio"), { recursive: true, force: true });

      // Installed hooks win, per agent: --plugin must do nothing, not start a second stream.
      const settings = path.join(home, ".claude", "settings.json");
      assert.strictEqual(hooks.userHooksInstalled(settings), false, "no settings file: not installed");
      hooks.installHooks("lofi", 0.4, settings);
      assert.strictEqual(hooks.userHooksInstalled(settings), true);
      const codexFile = path.join(home, "codex-home", "hooks.json");
      hooks.installHooks("lofi", 0.4, codexFile, { id: "codex" });
      // Codex caps these two at 3s and warns on every run past it.
      for (const file of [codexFile, path.join(root, "hooks", "codex.json")]) {
        const written = JSON.parse(fs.readFileSync(file, "utf8")).hooks;
        for (const event of ["SessionEnd", "Interrupt"]) assert.ok(written[event][0].hooks[0].timeout <= 3, `${file}: ${event} over Codex's 3s cap`);
      }
      for (const extra of [{}, { PLUGIN_ROOT: home, CODEX_HOME: path.join(home, "codex-home") }]) {
        const run = spawnSync(process.execPath, [bin, "--hook-start", "--plugin", "--event", "UserPromptSubmit"], {
          env: env(extra), input: JSON.stringify({ session_id: "plug" }), timeout: 10000
        });
        assert.strictEqual(run.status, 0, String(run.stderr));
        assert.ok(!fs.existsSync(sessions), "the plugin hook must not start a turn when installed hooks exist");
      }
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
    console.log("   ✓ Manifests track the package, hooks files match TARGETS, and plugin hooks step aside per agent.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
