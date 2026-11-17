const { assert, parseArgs, fs, path, os, TEST_DIR } = require("../helpers");

(async () => {
  // [66] --statusline: one plain line, nothing when idle.
  console.log("\n\x1b[1m[66] A status line for tmux and shell prompts\x1b[0m");
  {
    const hooks = require("../../src/hooks");
    const line = (status, ...sessions) => hooks.formatStatusline({ status, sessions: sessions.map(([state, project]) => ({ state, project })) });
    assert.strictEqual(line("idle"), "", "idle is empty, so a prompt segment disappears");
    assert.strictEqual(line("working", ["working", "/a/api"]), "working");
    assert.strictEqual(line("working", ["working", "/a"], ["working", "/b"]), "working ×2", "a count once more than one session is in the state");
    assert.strictEqual(line("stuck", ["stuck", "/a/api"], ["working", "/b"]), "stuck", "the count is of the urgent state, not of every session");
    assert.strictEqual(line("waiting", ["working", "/a"], ["waiting", "/work/web/"]), "waiting: web", "a waiting session names its project, trailing slash and all");
    assert.strictEqual(line("waiting", ["waiting", null]), "waiting", "no project, no name");
    assert.strictEqual(parseArgs(["node", "vibe", "--statusline"]).statusline, true);
    assert.strictEqual(parseArgs(["node", "vibe", "npm", "--statusline"]).statusline, false, "after the command it is the child's flag");

    const { spawnSync } = require("child_process");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-statusline-"));
    const env = { ...process.env, HOME: home, USERPROFILE: home, VIBE_DISABLE: "1", VIBE_NO_UPDATE_CHECK: "1", VIBE_NO_HISTORY: "1" };
    const CLI = path.join(TEST_DIR, "..", "bin", "vibeaudio.js");
    const hook = (action, payload) => spawnSync(process.execPath, [CLI, `--hook-${action}`], { input: JSON.stringify(payload), env, timeout: 10000 });
    const statusline = () => spawnSync(process.execPath, [CLI, "--statusline"], { env, encoding: "utf8", timeout: 10000 });
    try {
      assert.deepStrictEqual([statusline().status, statusline().stdout], [0, ""], "idle prints nothing at all, not even a newline");
      hook("start", { session_id: "s1", cwd: "/work/api" });
      assert.strictEqual(statusline().stdout, "working\n");
      hook("start", { session_id: "s2", cwd: "/work/web" });
      assert.strictEqual(statusline().stdout, "working ×2\n");
      hook("wait", { session_id: "s2", tool_name: "Bash" });
      assert.strictEqual(statusline().stdout, "waiting: web\n");
      assert.ok(!/\x1b/.test(statusline().stdout), "plain text: tmux and Starship do their own styling");
      spawnSync(process.execPath, [CLI, "--stop"], { env, timeout: 10000 });
      assert.strictEqual(statusline().stdout, "");

      // --why (#60): --status's first line, plain, for the mod.
      assert.strictEqual(parseArgs(["node", "vibe", "--why"]).why, true);
      assert.strictEqual(parseArgs(["node", "vibe", "npm", "--why"]).why, false, "after the command it is the child's flag");
      const why = spawnSync(process.execPath, [CLI, "--why"], { env: { ...env, VIBE_DISABLE: "" }, encoding: "utf8", timeout: 10000 });
      const status = spawnSync(process.execPath, [CLI, "--status"], { env: { ...env, VIBE_DISABLE: "" }, encoding: "utf8", timeout: 10000 });
      assert.strictEqual(why.status, 0);
      assert.ok(/^(playing|silent): [^\n]+\n$/.test(why.stdout) && !/\x1b/.test(why.stdout), "one plain line");
      assert.ok(status.stdout.replace(/\x1b\[[0-9;]*m/g, "").includes(`Now  ${why.stdout.trim()}`), "the same words --status opens with");
      assert.ok(/VIBE_DISABLE is set/.test(spawnSync(process.execPath, [CLI, "--why"], { env, encoding: "utf8", timeout: 10000 }).stdout), "the reasons follow explainMusic's order");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
    console.log("   ✓ Idle is empty; otherwise the most urgent state, counted, with the waiting project named.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
