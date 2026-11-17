const { fs, path, os, spawn, assert, TEST_DIR } = require("../helpers");

(async () => {
  // 29b. Two prompts at once must not leave two daemons playing (#42)
  // Each hookStart can find no daemon running and spawn one; the pid file then
  // names the last. Reproduced here without timing luck: the pid file is
  // removed between the two starts, which is what the second one saw when it
  // read it before the first one wrote it.
  console.log("29b. Testing Concurrent Starts Leave One Daemon...");
  if (process.platform === "win32") {
    console.log("   ✓ Skipped on Windows (fake backend needs a POSIX executable bit).");
  } else {
    const raceHome = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-race-"));
    // A silent backend, so nothing is audible on a developer's machine.
    fs.writeFileSync(path.join(raceHome, "afplay"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const probeSrc = `
      const fs = require("fs");
      const hooks = require(process.argv[1]);
      const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return false; } };
      const first = hooks.hookStart("lofi", 0.05, { turn: { session: "a" } });
      fs.rmSync(hooks.PID_FILE, { force: true });
      const second = hooks.hookStart("lofi", 0.05, { turn: { session: "b" } });
      (async () => {
        const deadline = Date.now() + 5000;
        while (alive(first) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
        const pidFile = parseInt(fs.readFileSync(hooks.PID_FILE, "utf8"), 10);
        console.log(JSON.stringify({ distinct: first !== second, firstAlive: alive(first), secondAlive: alive(second), named: pidFile === second }));
        for (const pid of [first, second]) { try { process.kill(pid, "SIGTERM"); } catch (e) {} }
        process.exit(0);
      })();
    `;
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, ["-e", probeSrc, path.join(TEST_DIR, "..", "src", "hooks.js")], {
        env: { ...process.env, HOME: raceHome, USERPROFILE: raceHome, PATH: `${raceHome}${path.delimiter}${process.env.PATH}` },
        stdio: ["ignore", "pipe", "inherit"]
      });
      let out = "";
      child.stdout.on("data", (c) => (out += c));
      child.on("close", () => resolve(JSON.parse(out)));
    });

    assert.ok(result.distinct, "the setup must actually produce two daemons");
    assert.strictEqual(result.firstAlive, false, "a daemon the pid file no longer names must stop");
    assert.strictEqual(result.secondAlive, true, "the daemon the pid file names keeps playing");
    assert.ok(result.named, "and the pid file still names it");
    fs.rmSync(raceHome, { recursive: true, force: true });
    console.log("   ✓ A superseded daemon stops within a poll, leaving the one the pid file names.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
