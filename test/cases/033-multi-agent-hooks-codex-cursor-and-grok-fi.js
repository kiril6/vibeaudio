const { fs, path, os, assert, TEST_DIR } = require("../helpers");

(async () => {
  // --- 33. Codex and Cursor get hooks in their own dialect ---
  console.log("\n\x1b[1m[33] Multi-agent hooks: Codex, Cursor and Grok file shapes\x1b[0m");
  {
    const { installHooks: install, uninstallHooks: remove, TARGETS } = require("../../src/hooks");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-targets-"));

    // Each tool's file already holds someone else's hook, in that tool's own
    // shape - the install must merge into it, not flatten it.
    const existing = {
      codex: { hooks: { Stop: [{ hooks: [{ type: "command", command: "other-tool" }] }] } },
      cursor: { version: 1, hooks: { preToolUse: [{ command: "other-tool" }] } }
    };

    for (const id of ["codex", "cursor"]) {
      const file = path.join(dir, `${id}.json`);
      fs.writeFileSync(file, JSON.stringify(existing[id]));

      install("jazz", 0.3, file, { id, reactive: true });
      install("jazz", 0.3, file, { id, reactive: true }); // must stay idempotent
      const after = JSON.parse(fs.readFileSync(file, "utf8"));
      const ev = TARGETS[id].events;

      assert.ok(after.hooks[ev.start], `${id} must write its own prompt event (${ev.start})`);
      assert.ok(after.hooks[ev.stop], `${id} must write its own stop event (${ev.stop})`);
      assert.strictEqual(
        after.hooks[ev.start].length, 1,
        `${id}: installing twice must not duplicate the entry`
      );
      // Codex rejects unknown root keys outright; Cursor needs its version.
      assert.deepStrictEqual(
        Object.keys(after).sort(),
        id === "cursor" ? ["hooks", "version"] : ["hooks"],
        `${id}: the root object must keep exactly the keys that tool accepts`
      );
      // Codex keys its per-hook trust records by index, so ours must append.
      assert.ok(
        JSON.stringify(after.hooks[ev.tool][0]).includes("other-tool") ||
          JSON.stringify(after.hooks[ev.stop][0]).includes("other-tool"),
        `${id}: the pre-existing hook must stay at index 0`
      );

      const { removed } = remove(file, { id });
      // start, stop, tool - plus Codex's PermissionRequest wait, PostToolUse
      // resume, and the Interrupt and SessionEnd it fires since 0.150 / 0.145
      if (id === "codex") {
        for (const event of ["Interrupt", "SessionEnd"]) {
          assert.ok(/--hook-end\b/.test(after.hooks[event][0].hooks[0].command), `codex: ${event} must run --hook-end`);
        }
      }
      const expected = id === "codex" ? 7 : 3;
      assert.strictEqual(removed, expected, `${id}: uninstall must remove all ${expected} of our hooks`);
      assert.ok(
        JSON.stringify(JSON.parse(fs.readFileSync(file, "utf8"))).includes("other-tool"),
        `${id}: uninstall must leave the other tool's hook alone`
      );
    }

    // Grok owns its whole file, so uninstall must delete it rather than leave
    // an empty husk in a directory Grok keeps scanning.
    {
      const grokFile = path.join(dir, "grok.json");
      install("jazz", 0.3, grokFile, { id: "grok", reactive: true });

      const after = JSON.parse(fs.readFileSync(grokFile, "utf8"));
      assert.deepStrictEqual(Object.keys(after), ["hooks"], "grok: root must hold hooks only");
      assert.ok(after.hooks.UserPromptSubmit && after.hooks.Stop, "grok must use Claude's event names");

      const { removed } = remove(grokFile, { id: "grok" });
      assert.strictEqual(removed, 3, "grok: uninstall must report all three hooks");
      assert.ok(!fs.existsSync(grokFile), "grok: uninstall must delete our file, not empty it");
    }

    fs.rmSync(dir, { recursive: true, force: true });
    console.log("   ✓ Codex and Cursor merge safely; Grok gets its own file and takes it with it.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
