const { assert, sandboxPathWith, TEST_DIR, UNLAUNCHABLE_TARGETS } = require("../helpers");

(async () => {
  // 38. The launcher list and the hook targets must not drift apart.
  {
    console.log("\n\x1b[1m[38] Launcher covers every hook target\x1b[0m");
    const fs = require("fs");
    const path = require("path");
    const { AI_TOOLS, hookTargetOf, promptInteractive } = require("../../src/interactive");
    const { TARGETS } = require("../../src/hooks");

    // a. Every id the menu names must be a real target. Grok was a complete
    //    hook target - own file, own events, its own row in the README - that
    //    the menu had no entry for at all.
    for (const tool of AI_TOOLS) {
      assert.doesNotThrow(() => hookTargetOf(tool), `${tool.name} names an unknown hook target`);
    }
    assert.throws(
      () => hookTargetOf({ name: "Bogus", hookTarget: "nope" }),
      /not one of/,
      "a typo'd target id must fail loudly rather than silently offer the wrapper"
    );

    // b. Every hook target must be reachable from the menu, or picking that
    //    agent offers the wrapper and nothing else.
    const menuTargets = AI_TOOLS.map(hookTargetOf).filter(Boolean);
    for (const id of Object.keys(TARGETS)) {
      assert.ok(
        menuTargets.includes(id) || UNLAUNCHABLE_TARGETS.includes(id),
        `hook target '${id}' has no launcher entry — add one, or list it in UNLAUNCHABLE_TARGETS with a reason`
      );
    }

    if (process.platform === "win32") {
      console.log("   ✓ List checks pass (menu drive skipped on Windows).");
    } else {
      // c. Drive the menu as a Grok user and confirm the hooks branch is
      //    offered at all, and that it reports the right target to install for.
      const binDir = sandboxPathWith(["grok"]);
      const realPath = process.env.PATH;
      const realStdin = Object.getOwnPropertyDescriptor(process, "stdin");
      const realWrite = process.stdout.write.bind(process.stdout);
      const realLog = console.log;
      process.env.PATH = binDir;
      process.stdout.write = () => true;
      console.log = () => {};

      const drive = (keys) => {
        const queue = [...keys];
        const fake = new (require("events").EventEmitter)();
        Object.assign(fake, { isTTY: true, setRawMode() {}, resume() {}, pause() {}, setEncoding() {} });
        const realOn = fake.on.bind(fake);
        fake.on = (event, fn) => {
          const out = realOn(event, fn);
          if (event === "data" && queue.length) setImmediate(() => fake.emit("data", queue.shift()));
          return out;
        };
        Object.defineProperty(process, "stdin", { value: fake, configurable: true });
      };

      let asked = null;
      try {
        // Grok is the only tool on PATH, so it sorts to position 1.
        // Grok -> hooks -> lofi -> Normal -> Steady
        drive(["1", "1", "1", "1", "1"]);
        const picked = await promptInteractive({
          hooksInstalledFor: (id) => { asked = id; return false; }
        });
        assert.deepStrictEqual(picked.cmd, ["grok"], "Grok must be selectable from the launcher");
        assert.strictEqual(picked.installHooks, true, "Grok must reach the hooks branch");
        assert.strictEqual(picked.hookTarget, "grok", "and install for Grok, not for Claude");
      } finally {
        process.stdout.write = realWrite;
        console.log = realLog;
        process.env.PATH = realPath;
        Object.defineProperty(process, "stdin", realStdin);
        fs.rmSync(binDir, { recursive: true, force: true });
      }

      // d. The "already installed?" question follows the picked tool. It used
      //    to be answered for Claude every time, so a Grok user with Grok
      //    hooks installed was told they had none.
      assert.strictEqual(asked, "grok", "hooksInstalledFor must be asked about the tool that was picked");

      console.log("   ✓ Grok is selectable, reaches hooks, and is asked about as itself.");
    }
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
