const { os, assert, CLI, TEST_DIR } = require("../helpers");

(async () => {
  // 46. Gemini CLI, Copilot CLI and Qwen Code in their own dialects; a dry run
  //     that writes nothing; and /vibe, which must never touch a user's file.
  {
    const fs = require("fs");
    const path = require("path");
    const { spawnSync } = require("child_process");
    const hooks = require("../../src/hooks");
    console.log("\n\x1b[1m[46] Gemini, Copilot and Qwen hooks; --dry-run; /vibe\x1b[0m");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-agents-"));
    try {
      // Gemini keeps settings (not events) inside `hooks`; they must survive,
      // and must not be mistaken for a malformed event list.
      const gemini = path.join(dir, "gemini.json");
      fs.writeFileSync(gemini, JSON.stringify({ theme: "dark", hooks: { enabled: true, AfterTool: [{ hooks: [{ type: "command", command: "other-tool" }] }] } }));
      hooks.installHooks("zen", 0.3, gemini, { id: "gemini", reactive: true });
      const g = JSON.parse(fs.readFileSync(gemini, "utf8"));
      for (const event of ["BeforeAgent", "AfterAgent", "BeforeTool", "Notification", "AfterTool", "SessionEnd"]) {
        assert.ok(g.hooks[event], `gemini must write ${event}`);
      }
      const gEntry = g.hooks.BeforeAgent[0].hooks[0];
      assert.strictEqual(gEntry.timeout, 5000, "Gemini timeouts are milliseconds");
      assert.strictEqual(g.hooks.enabled, true, "Gemini's hooks.enabled setting must survive the install");
      assert.strictEqual(g.hooks.AfterTool[0].hooks[0].command, "other-tool", "another tool's AfterTool hook stays first");
      assert.strictEqual(hooks.uninstallHooks(gemini, { id: "gemini" }).removed, 6, "gemini: all six of ours removed");
      const gAfter = JSON.parse(fs.readFileSync(gemini, "utf8"));
      assert.deepStrictEqual(gAfter, { theme: "dark", hooks: { enabled: true, AfterTool: [{ hooks: [{ type: "command", command: "other-tool" }] }] } },
        "gemini: uninstall must leave exactly the user's settings behind");

      // Copilot: a file of our own, schema version, flat entries, PascalCase
      // events (which select the Claude-compatible payloads).
      const copilot = path.join(dir, "copilot", "hooks", "vibeaudio.json");
      hooks.installHooks("zen", 0.3, copilot, { id: "copilot" });
      const c = JSON.parse(fs.readFileSync(copilot, "utf8"));
      assert.deepStrictEqual(Object.keys(c).sort(), ["hooks", "version"], "copilot: root is version + hooks");
      assert.strictEqual(c.version, 1);
      assert.deepStrictEqual(Object.keys(c.hooks).sort(),
        ["Notification", "PostToolUse", "PostToolUseFailure", "SessionEnd", "Stop", "UserPromptSubmit"],
        "copilot: its verified events, and no PermissionRequest - that one fires without a prompt");
      assert.strictEqual(c.hooks.Stop[0].timeoutSec, 5, "copilot entries are flat, with timeoutSec");
      assert.strictEqual(hooks.uninstallHooks(copilot, { id: "copilot" }).removed, 6);
      assert.ok(!fs.existsSync(copilot), "copilot: uninstall deletes our file");

      const qwen = path.join(dir, "qwen.json");
      hooks.installHooks("zen", 0.3, qwen, { id: "qwen" });
      const q = JSON.parse(fs.readFileSync(qwen, "utf8"));
      for (const event of ["UserPromptSubmit", "Stop", "PermissionRequest", "PostToolUse", "PostToolUseFailure", "StopFailure", "SessionEnd"]) {
        assert.ok(q.hooks[event], `qwen must write ${event}`);
      }
      assert.strictEqual(q.hooks.Stop[0].hooks[0].timeout, 5000, "Qwen timeouts are milliseconds");
      assert.strictEqual(hooks.uninstallHooks(qwen, { id: "qwen" }).removed, 7);

      // Windsurf: flat {command} entries, and the conversation is `trajectory_id`.
      const ws = path.join(dir, "windsurf.json");
      hooks.installHooks("zen", 0.3, ws, { id: "windsurf" });
      const w = JSON.parse(fs.readFileSync(ws, "utf8"));
      assert.deepStrictEqual(Object.keys(w), ["hooks"]);
      assert.ok(/--hook-start/.test(w.hooks.pre_user_prompt[0].command), "windsurf start event");
      assert.ok(/--hook-stop/.test(w.hooks.post_cascade_response[0].command), "windsurf stop event");
      assert.strictEqual(w.hooks.pre_run_command, undefined, "tool hook only in reactive mode");
      assert.strictEqual(hooks.uninstallHooks(ws, { id: "windsurf" }).removed, 2);

      // Dry run: the result is computed, nothing is written - not the file,
      // not its directory, not a backup.
      const existing = path.join(dir, "existing.json");
      const original = JSON.stringify({ model: "opus" });
      fs.writeFileSync(existing, original);
      const plan = hooks.installHooks("jazz", 0.4, existing, { id: "claude", dryRun: true });
      assert.strictEqual(fs.readFileSync(existing, "utf8"), original, "a dry run must not modify the file");
      assert.ok(!fs.existsSync(`${existing}.vibeaudio.bak`), "a dry run must not write a backup");
      assert.ok(plan.backup, "but it must say one would be written");
      assert.ok(JSON.parse(plan.after).hooks.UserPromptSubmit, "and return what would be written");
      const fresh = path.join(dir, "not-yet", "settings.json");
      hooks.installHooks("jazz", 0.4, fresh, { id: "claude", dryRun: true });
      assert.ok(!fs.existsSync(path.dirname(fresh)), "a dry run must not create directories");

      // End to end, through the flag, against a disposable HOME.
      const home = path.join(dir, "home");
      fs.mkdirSync(home);
      const run = spawnSync(process.execPath, [CLI, "--install-hooks", "--tools", "claude", "--dry-run"],
        { env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: "utf8", timeout: 20000 });
      assert.strictEqual(run.status, 0, `--dry-run failed: ${run.stderr}`);
      assert.ok(/Dry run/.test(run.stdout) && /\+ add\s+\x1b\[0m UserPromptSubmit/.test(run.stdout), "--dry-run must list what it would add");
      assert.deepStrictEqual(fs.readdirSync(home), [], "--dry-run must leave HOME untouched, /vibe included");

      // /vibe: ours is replaced and removed; a user's own vibe.md is neither.
      const slash = path.join(dir, "commands", "vibe.md");
      assert.strictEqual(hooks.installSlashCommand({ file: slash }).installed, true);
      const text = fs.readFileSync(slash, "utf8");
      assert.ok(text.startsWith("---\n") && /--mute/.test(text) && text.includes(path.join(TEST_DIR, "..", "bin", "vibeaudio.js")),
        "/vibe must be a command file that runs this CLI");
      assert.strictEqual(hooks.uninstallSlashCommand({ file: slash }), true);
      assert.ok(!fs.existsSync(slash));
      fs.writeFileSync(slash, "my own vibe command");
      assert.strictEqual(hooks.installSlashCommand({ file: slash }).installed, false, "a user's vibe.md must not be overwritten");
      assert.strictEqual(hooks.uninstallSlashCommand({ file: slash }), false, "nor deleted");
      assert.strictEqual(fs.readFileSync(slash, "utf8"), "my own vibe command");

      // $vibe for Codex (#27): a skill folder with implicit invocation off, the
      // same rules as /vibe, and a folder holding anything else is left behind.
      const skillDir = path.join(dir, "codex", "skills", "vibe");
      const skillFile = path.join(skillDir, "SKILL.md");
      assert.strictEqual(hooks.installAgentSkill("codex", { dir: skillDir, dryRun: true }).installed, true);
      assert.ok(!fs.existsSync(skillDir), "a dry run must not write the skill");
      assert.strictEqual(hooks.installAgentSkill("codex", { dir: skillDir }).installed, true);
      const skill = fs.readFileSync(skillFile, "utf8");
      assert.ok(skill.startsWith("---\nname: vibe\n") && /--mute/.test(skill) && skill.includes(path.join(TEST_DIR, "..", "bin", "vibeaudio.js")),
        "$vibe must be a skill that runs this CLI");
      assert.ok(!skill.includes("$ARGUMENTS"), "Codex substitutes no $ARGUMENTS, so the skill must not rely on it");
      assert.ok(/allow_implicit_invocation: false/.test(fs.readFileSync(path.join(skillDir, "agents", "openai.yaml"), "utf8")),
        "the model must not invoke $vibe on its own");
      assert.strictEqual(hooks.uninstallAgentSkill("codex", { dir: skillDir }), true);
      assert.ok(!fs.existsSync(skillDir), "uninstall removes the folder it made");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(skillFile, "my own vibe skill");
      assert.strictEqual(hooks.installAgentSkill("codex", { dir: skillDir }).installed, false, "a user's vibe skill must not be overwritten");
      assert.strictEqual(hooks.uninstallAgentSkill("codex", { dir: skillDir }), false, "nor deleted");
      assert.strictEqual(fs.readFileSync(skillFile, "utf8"), "my own vibe skill");
      fs.rmSync(skillFile);
      hooks.installAgentSkill("codex", { dir: skillDir });
      fs.writeFileSync(path.join(skillDir, "notes.md"), "mine");
      assert.strictEqual(hooks.uninstallAgentSkill("codex", { dir: skillDir }), true);
      assert.deepStrictEqual(fs.readdirSync(skillDir), ["notes.md"], "only our files go; the user's stay");

      // /vibe for Antigravity (#28): same skill, its own switch in the front
      // matter, no extra files.
      const agyDir = path.join(dir, "agy", "skills", "vibe");
      assert.strictEqual(hooks.installAgentSkill("antigravity", { dir: agyDir }).installed, true);
      const agySkill = fs.readFileSync(path.join(agyDir, "SKILL.md"), "utf8");
      assert.ok(/^disable-model-invocation: true$/m.test(agySkill.split("\n---\n")[0]),
        "the model must not invoke /vibe on its own in Antigravity");
      assert.ok(agySkill.includes("after `/vibe`") && !agySkill.includes("$ARGUMENTS") && /--mute/.test(agySkill));
      assert.deepStrictEqual(fs.readdirSync(agyDir), ["SKILL.md"]);
      assert.strictEqual(hooks.uninstallAgentSkill("antigravity", { dir: agyDir }), true);
      assert.ok(!fs.existsSync(agyDir));

      // /vibe for Gemini CLI and Qwen Code (#28): a TOML command, `{{args}}`
      // substituted by the agent, marked as ours, a user's own vibe.toml kept.
      for (const id of ["gemini", "qwen"]) {
        const cmdDir = path.join(dir, id, "commands");
        const tomlFile = path.join(cmdDir, "vibe.toml");
        assert.strictEqual(hooks.installAgentSkill(id, { dir: cmdDir }).installed, true);
        const toml = fs.readFileSync(tomlFile, "utf8");
        assert.ok(/^description = ".+"$/m.test(toml) && /^prompt = """\n/m.test(toml) && toml.includes("{{args}}") && /--mute/.test(toml)
          && toml.includes(path.join(TEST_DIR, "..", "bin", "vibeaudio.js").replace(/\\/g, "\\\\")), `${id}: /vibe must be a TOML command that runs this CLI`); // TOML doubles a Windows path's backslashes
        assert.ok(!/!\{|@\{/.test(toml), `${id}: no shell or file injection syntax in the prompt`);
        assert.strictEqual(hooks.uninstallAgentSkill(id, { dir: cmdDir }), true);
        assert.ok(!fs.existsSync(tomlFile) && !fs.existsSync(cmdDir), `${id}: uninstall removes the folder it made`);
        fs.mkdirSync(cmdDir, { recursive: true });
        fs.writeFileSync(tomlFile, "mine");
        assert.strictEqual(hooks.installAgentSkill(id, { dir: cmdDir }).installed, false, `${id}: a user's vibe.toml must not be overwritten`);
        assert.strictEqual(hooks.uninstallAgentSkill(id, { dir: cmdDir }), false, `${id}: nor deleted`);
      }

      // Through the flags: the Codex install writes it, uninstall takes it away.
      const codexHomeDir = path.join(dir, "home2");
      fs.mkdirSync(codexHomeDir);
      const cenv = { ...process.env, HOME: codexHomeDir, USERPROFILE: codexHomeDir };
      const homeSkill = path.join(codexHomeDir, ".codex", "skills", "vibe", "SKILL.md");
      const inst = spawnSync(process.execPath, [CLI, "--install-hooks", "--tools", "codex"], { env: cenv, encoding: "utf8", timeout: 20000 });
      assert.strictEqual(inst.status, 0, `codex install failed: ${inst.stderr}`);
      assert.ok(fs.existsSync(homeSkill) && /\$vibe/.test(inst.stdout), "the Codex install must write $vibe and say so");
      const uninst = spawnSync(process.execPath, [CLI, "--uninstall-hooks"], { env: cenv, encoding: "utf8", timeout: 20000 });
      assert.strictEqual(uninst.status, 0, `uninstall failed: ${uninst.stderr}`);
      assert.ok(!fs.existsSync(homeSkill), "--uninstall-hooks must remove $vibe");
      const agyHome = path.join(codexHomeDir, ".gemini", "config", "skills", "vibe", "SKILL.md");
      const ainst = spawnSync(process.execPath, [CLI, "--install-hooks", "--tools", "antigravity"], { env: cenv, encoding: "utf8", timeout: 20000 });
      assert.strictEqual(ainst.status, 0, `antigravity install failed: ${ainst.stderr}`);
      assert.ok(fs.existsSync(agyHome) && /\/vibe .*Antigravity/.test(ainst.stdout), "the Antigravity install must write /vibe and say so");
      spawnSync(process.execPath, [CLI, "--uninstall-hooks"], { env: cenv, encoding: "utf8", timeout: 20000 });
      assert.ok(!fs.existsSync(agyHome), "--uninstall-hooks must remove Antigravity's /vibe");

      // The mod hint: shown until Claude Code lists the plugin as installed.
      const plugins = path.join(dir, "installed_plugins.json");
      assert.strictEqual(hooks.modInstalled(plugins), false, "no plugins file: not installed");
      fs.writeFileSync(plugins, JSON.stringify({ plugins: { "vibeaudio-mod@vibeaudio": [{}] } }));
      assert.strictEqual(hooks.modInstalled(plugins), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    console.log("   ✓ Three more dialects merge and uninstall cleanly; --dry-run writes nothing; /vibe spares a user's own file.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
