const { fs, path, os, assert, TEST_DIR } = require("../helpers");

(async () => {
  // [65] Antigravity (#47): named hooks in ~/.gemini/config/hooks.json, a start
  // that fires before every model call, and no pre-tool hook ever.
  console.log("\n\x1b[1m[65] Antigravity hooks\x1b[0m");
  {
    const { spawnSync } = require("child_process");
    const hooks = require("../../src/hooks");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-agy-"));
    try {
      const file = path.join(home, ".gemini", "config", "hooks.json");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const theirs = { "lint-checker": { PostToolUse: [{ matcher: "run_command", hooks: [{ type: "command", command: "./lint.sh" }] }] } };
      fs.writeFileSync(file, JSON.stringify(theirs));

      // Reactive is asked for and must still write no PreToolUse: a hook there
      // has to approve or deny, and one that answers nothing denies the tool.
      hooks.installHooks("lofi", 0.4, file, { id: "antigravity", reactive: true });
      hooks.installHooks("lofi", 0.4, file, { id: "antigravity", reactive: true });
      const written = JSON.parse(fs.readFileSync(file, "utf8"));
      assert.deepStrictEqual(written["lint-checker"], theirs["lint-checker"], "someone else's named hook is left exactly as it was");
      assert.deepStrictEqual(Object.keys(written.vibeaudio).sort(), ["PreInvocation", "Stop"], "ours live under our own name: start and stop only");
      assert.ok(!JSON.stringify(written).includes("--hook-tool"), "never a pre-tool hook, even with --reactive");
      assert.ok(!JSON.stringify(written).includes("--reactive"), "and reactive is off, not carried as a flag that does nothing");
      assert.strictEqual(hooks.installHooks("lofi", 0.4, file, { id: "antigravity", reactive: true, dryRun: true }).reactive, false,
        "the result says so, which is what the install report reads");
      assert.strictEqual(written.vibeaudio.PreInvocation.length, 1, "a reinstall replaces our entry rather than adding one");
      assert.strictEqual(written.vibeaudio.PreInvocation[0].timeout, 5, "flat handler, timeout in seconds");
      assert.ok(fs.existsSync(`${file}.vibeaudio.bak`), "the user's file is backed up before the first edit");
      assert.ok(hooks.userHooksInstalled(file, "antigravity"), "our entries are found under our key");

      // The payload, as agy 1.1.25 sent it.
      const pay = (extra) => JSON.stringify({ conversationId: "c-1", workspacePaths: ["/work/api"], initialNumSteps: 1, ...extra });
      const first = hooks.newTurn(pay({ invocationNum: 0 }));
      assert.deepStrictEqual([first.session, first.project, first.continues], ["c-1", "/work/api", false], "the first model call starts a turn");
      assert.strictEqual(hooks.newTurn(pay({ invocationNum: 2 })).continues, true, "a later call in the same turn does not");
      assert.strictEqual(hooks.outcomeFromPayload(pay({ terminationReason: "NO_TOOL_CALL" })), "success", "the normal end");
      assert.strictEqual(hooks.outcomeFromPayload(pay({ terminationReason: "error" })), "failure");
      assert.strictEqual(hooks.outcomeFromPayload(pay({ terminationReason: "MAX_STEPS_EXCEEDED" })), "failure");

      // A whole turn through the installed commands: three model calls, one start.
      const env = { ...process.env, HOME: home, USERPROFILE: home, VIBE_DISABLE: "1" };
      const run = (event, extra) => {
        const r = spawnSync(written.vibeaudio[event][0].command, { shell: true, env, input: pay(extra), timeout: 10000 });
        assert.strictEqual(r.status, 0, String(r.stderr));
      };
      for (const n of [0, 1, 2]) run("PreInvocation", { invocationNum: n });
      run("Stop", { terminationReason: "NO_TOOL_CALL", executionNum: 0, fullyIdle: true, error: "" });
      const events = fs.readFileSync(path.join(home, ".vibeaudio", "events.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
      assert.deepStrictEqual(events.map((e) => e.event), ["started", "finished"], "one start for three model calls, then the finish");
      assert.strictEqual(events[1].outcome, "success");
      assert.strictEqual(events[0].project, "/work/api", "the project is the first workspace");

      hooks.uninstallHooks(file, { id: "antigravity" });
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, "utf8")), theirs, "uninstall removes our name and nothing else");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
    console.log("   ✓ Installs beside other named hooks, never a pre-tool hook, starts once per turn and reads Antigravity's payload.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
