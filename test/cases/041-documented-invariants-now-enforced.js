const { os, assert, TEST_DIR } = require("../helpers");

(async () => {
  // 41. Invariants CLAUDE.md calls load-bearing that nothing was enforcing.
  //     Found by mutation testing: each assertion below fails against the
  //     specific one-line regression it names.
  {
    console.log("\n\x1b[1m[41] Documented invariants, now enforced\x1b[0m");
    const fs = require("fs");
    const path = require("path");
    const CLI = path.join(TEST_DIR, "..", "bin", "vibeaudio.js");

    // a. A hook must not outlive its work. Reading stdin resumes it, and a
    //    resumed stdin holds the event loop open by itself - so without the
    //    pause() in readPayload the hook sits there on EVERY turn until the
    //    agent times it out. Stdin is deliberately left open here: that is
    //    the case that hangs.
    //    Stdin is opened and deliberately never ended - spawnSync's `input`
    //    closes it for you, which makes the `end` event fire and hides the
    //    bug entirely. An agent holds the pipe open; that is the case that
    //    hangs, so it is the case to test.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-hook-"));
    const exitCode = await new Promise((resolve, reject) => {
      const child = require("child_process").spawn(process.execPath, [CLI, "--hook-stop"], {
        stdio: ["pipe", "ignore", "ignore"],
        env: { ...process.env, HOME: home, USERPROFILE: home, VIBE_DISABLE: "1" }
      });
      child.stdin.write('{"status":"completed"}');   // written, never ended
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve("HUNG");
      }, 6000);
      child.on("error", reject);
      child.on("close", (code) => { clearTimeout(timer); resolve(code); });
    });
    assert.notStrictEqual(exitCode, "HUNG", "--hook-stop hung: readPayload left stdin resumed");
    fs.rmSync(home, { recursive: true, force: true });

    // b. The intensity file must not carry one prompt's activity into the
    //    next: hookStart and hookStop both clear it. Both run in a child with
    //    HOME redirected - hookStart spawns a detached daemon, and hookStop
    //    consults every session on record, so in this process either would
    //    operate on the real ~/.vibeaudio: clobbering a live pid, or seeing the
    //    developer's own agent session as "another one still working".
    const startHome = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-start-"));
    const probe = path.join(startHome, "probe.js");
    fs.writeFileSync(probe, `
      const fs = require("fs"), path = require("path"), os = require("os");
      const file = path.join(os.homedir(), ".vibeaudio", "intensity");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "3");
      const hooks = require(${JSON.stringify(path.join(TEST_DIR, "..", "src", "hooks"))});
      hooks.hookStop({ noChime: true });
      const stopCleared = !fs.existsSync(file);
      fs.writeFileSync(file, "3");
      hooks.hookStart("lofi", 0.4, {});
      console.log(JSON.stringify({ stopCleared, cleared: !fs.existsSync(file) }));
      hooks.stopDaemon();
      process.exit(0);
    `);
    const probeRun = require("child_process").spawnSync(process.execPath, [probe], {
      encoding: "utf8",
      timeout: 20000,
      env: { ...process.env, HOME: startHome, USERPROFILE: startHome, VIBE_DISABLE: "1" }
    });
    assert.strictEqual(probeRun.status, 0, `intensity probe failed: ${probeRun.stderr}`);
    const probeOut = JSON.parse(probeRun.stdout.trim().split("\n").pop());
    assert.strictEqual(probeOut.stopCleared, true, "hookStop must clear the intensity file");
    assert.strictEqual(
      probeOut.cleared, true,
      "hookStart must clear the intensity file so the last prompt's activity cannot leak in"
    );
    fs.rmSync(startHome, { recursive: true, force: true });

    // c. cleanup() can be reached from the signal path and the close path, so
    //    the HUD's stop must be idempotent - without the guard it prints twice.
    const { TerminalHud } = require("../../src/hud");
    const hud = new TerminalHud("lofi");
    const lines = [];
    const realWrite = process.stdout.write.bind(process.stdout);
    const wasTTY = process.stdout.isTTY;
    process.stdout.isTTY = true;
    process.stdout.write = (c) => { lines.push(String(c)); return true; };
    try {
      hud.start();
      hud.stop({ outcome: "success", code: 0, chimed: true });
      hud.stop({ outcome: "success", code: 0, chimed: true });
    } finally {
      process.stdout.write = realWrite;
      process.stdout.isTTY = wasTTY;
    }
    assert.strictEqual(
      lines.filter((l) => /Done in/.test(l)).length, 1,
      "a second hud.stop() must print nothing"
    );

    console.log("   ✓ The hook returns, the intensity file is cleared, the HUD prints once.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
