const { fs, path, os, assert, TEST_DIR } = require("../helpers");

(async () => {
  // [63] Config dirs that move with an env var, and Codex's Interrupt.
  console.log("\n\x1b[1m[63] CLAUDE_CONFIG_DIR, CODEX_HOME and Codex interrupts\x1b[0m");
  {
    const { spawnSync } = require("child_process");
    const hooks = require("../../src/hooks");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-cfgdir-"));
    const claudeDir = path.join(home, "elsewhere", "claude");
    const codexDir = path.join(home, "elsewhere", "codex");
    try {
      assert.strictEqual(hooks.TARGETS.claude.file(), path.join(os.homedir(), ".claude", "settings.json"), "unset: the default");
      process.env.CLAUDE_CONFIG_DIR = claudeDir;
      process.env.CODEX_HOME = codexDir;
      assert.strictEqual(hooks.TARGETS.claude.file(), path.join(claudeDir, "settings.json"), "settings follow CLAUDE_CONFIG_DIR");
      assert.strictEqual(hooks.TARGETS.codex.file(), path.join(codexDir, "hooks.json"), "hooks follow CODEX_HOME");
      process.env.CLAUDE_CONFIG_DIR = "";
      process.env.CODEX_HOME = "";
      assert.strictEqual(hooks.TARGETS.claude.file(), path.join(os.homedir(), ".claude", "settings.json"), "an empty variable is unset, never a relative path");
      assert.strictEqual(hooks.codexHome(), path.join(os.homedir(), ".codex"));
      // Claude Code NFC-normalizes the directory; a decomposed é must land in the same place.
      process.env.CLAUDE_CONFIG_DIR = path.join(home, "cafe\u0301");
      assert.strictEqual(hooks.claudeConfigDir(), path.join(home, "caf\u00e9"));
    } finally {
      delete process.env.CLAUDE_CONFIG_DIR;
      delete process.env.CODEX_HOME;
    }

    // End to end: an install with both set writes there, and nothing under HOME.
    const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: claudeDir, CODEX_HOME: codexDir, VIBE_DISABLE: "1", VIBE_NO_UPDATE_CHECK: "1" };
    const CLI = path.join(TEST_DIR, "..", "bin", "vibeaudio.js");
    try {
      const install = spawnSync(process.execPath, [CLI, "--install-hooks", "--tools", "claude,codex"], { env, encoding: "utf8", timeout: 20000 });
      assert.strictEqual(install.status, 0, install.stderr);
      assert.ok(fs.existsSync(path.join(claudeDir, "settings.json")), "Claude Code hooks land in CLAUDE_CONFIG_DIR");
      assert.ok(fs.existsSync(path.join(claudeDir, "commands", "vibe.md")), "and so does /vibe, which Claude Code loads from there too");
      assert.ok(fs.existsSync(path.join(codexDir, "hooks.json")), "Codex hooks land in CODEX_HOME");
      assert.ok(!fs.existsSync(path.join(home, ".claude")) && !fs.existsSync(path.join(home, ".codex")), "nothing is written to the default paths");
      const status = spawnSync(process.execPath, [CLI, "--status"], { env, encoding: "utf8" }).stdout.replace(/\x1b\[[0-9;]*m/g, "");
      assert.ok(/✔ UserPromptSubmit/.test(status) && !/Claude Code\s+not installed/.test(status), "--status reads the hooks from CLAUDE_CONFIG_DIR");

      // Codex's Interrupt ends the turn silently and is reported as one.
      const hook = (action, payload) => spawnSync(process.execPath, [CLI, `--hook-${action}`], { input: JSON.stringify(payload), env, timeout: 10000 });
      const log = path.join(home, ".vibeaudio", "events.jsonl");
      hook("start", { session_id: "cx", cwd: "/work/api", hook_event_name: "UserPromptSubmit" });
      hook("end", { session_id: "cx", cwd: "/work/api", hook_event_name: "Interrupt", turn_id: "t1" });
      const last = JSON.parse(fs.readFileSync(log, "utf8").trim().split("\n").pop());
      assert.strictEqual(last.event, "interrupted", "an Interrupt is an interrupt, not a session ending");
      assert.strictEqual(last.status, "idle");
      assert.ok(!fs.existsSync(path.join(home, ".vibeaudio", "sessions", "cx.json")), "the turn is over");
      // A Stop arriving after it (it should not, but) finds nothing to chime for.
      assert.strictEqual(hooks.outcomeFromPayload("{}"), "success");
      const stop = spawnSync(process.execPath, [CLI, "--hook-stop"], { input: JSON.stringify({ session_id: "cx" }), env, timeout: 10000 });
      assert.strictEqual(stop.status, 0);
      assert.strictEqual(JSON.parse(fs.readFileSync(log, "utf8").trim().split("\n").pop()).event, "interrupted", "no finished after an interrupt");

      // An install from before Interrupt/SessionEnd existed: hook files outlive
      // upgrades, so --doctor and --status must say what a reinstall would add.
      const codexFile = path.join(codexDir, "hooks.json");
      const old = JSON.parse(fs.readFileSync(codexFile, "utf8"));
      delete old.hooks.Interrupt;
      delete old.hooks.SessionEnd;
      fs.writeFileSync(codexFile, JSON.stringify(old));
      const strip = (out) => out.replace(/\x1b\[[0-9;]*m/g, "");
      const doctor = strip(spawnSync(process.execPath, [CLI, "--doctor"], { env, encoding: "utf8" }).stdout);
      assert.ok(/Codex hooks\s+installed by an older version, missing SessionEnd, Interrupt/.test(doctor), "--doctor names the events an older install lacks");
      assert.ok(/fix: vibe --install-hooks/.test(doctor));
      assert.ok(/\+ SessionEnd, Interrupt added since this install/.test(strip(spawnSync(process.execPath, [CLI, "--status"], { env, encoding: "utf8" }).stdout)), "--status says it too");
      assert.ok(!/Claude Code hooks\s+installed by an older/.test(doctor), "a current install is not flagged");
      spawnSync(process.execPath, [CLI, "--install-hooks", "--tools", "codex"], { env, encoding: "utf8", timeout: 20000 });
      assert.ok(!/missing SessionEnd/.test(strip(spawnSync(process.execPath, [CLI, "--doctor"], { env, encoding: "utf8" }).stdout)), "a reinstall clears it");

      const un = spawnSync(process.execPath, [CLI, "--uninstall-hooks"], { env, encoding: "utf8", timeout: 20000 });
      assert.strictEqual(un.status, 0, un.stderr);
      assert.ok(!fs.existsSync(path.join(claudeDir, "commands", "vibe.md")), "uninstall removes /vibe from CLAUDE_CONFIG_DIR");
      assert.ok(!/--hook-/.test(fs.readFileSync(path.join(codexDir, "hooks.json"), "utf8")), "and our Codex hooks from CODEX_HOME");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
    console.log("   ✓ Hooks and /vibe follow CLAUDE_CONFIG_DIR and CODEX_HOME; Codex's Interrupt ends a turn silently; an outdated install is named.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
