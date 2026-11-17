const { fs, path, os, spawn, CLI, assert, TEST_DIR } = require("../helpers");

(async () => {
  // --- 34e. The mute switch crosses process boundaries ---
  console.log("\n\x1b[1m[34e] Mute survives where an env var cannot\x1b[0m");
  {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-mute-"));
    const run = (args, env = {}) =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [CLI, ...args], {
          env: { ...process.env, HOME: home, USERPROFILE: home, VIBE_DISABLE: "", ...env },
          stdio: ["ignore", "pipe", "pipe"]
        });
        let out = "";
        child.stdout.on("data", (c) => (out += c));
        child.stderr.on("data", (c) => (out += c));
        child.on("close", (code) => resolve({ code, out }));
      });

    const muted = await run(["--mute"]);
    assert.strictEqual(muted.code, 0, "--mute must exit 0");
    assert.ok(fs.existsSync(path.join(home, ".vibeaudio", "muted")), "--mute must leave a flag a later process can see");

    // The whole point: a hook inherits the agent's environment from launch
    // time, so a variable set afterwards never reaches it. A file does.
    const started = await run(["--hook-start", "--genre", "zen", "--volume", "5"]);
    assert.strictEqual(started.code, 0, "a muted hook-start must still exit cleanly");
    const pidFile = path.join(home, ".vibeaudio", "daemon.pid");
    if (fs.existsSync(pidFile)) {
      const pid = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
      const alive = () => { try { process.kill(pid, 0); return true; } catch (e) { return false; } };
      // It exits once it has booted and found the mute; a loaded machine boots slowly (#44).
      for (const end = Date.now() + 5000; alive() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 50));
      assert.ok(!alive(), "no daemon may survive while muted");
    }

    assert.ok(/silent: muted/.test((await run(["--status"])).out), "--status must say it is muted");

    // A mute you forget about is worse than no mute, so it expires by default.
    const { DEFAULT_MUTE_MINUTES } = require("../../src/player");
    assert.strictEqual(DEFAULT_MUTE_MINUTES, 60, "the default mute must be bounded, not forever");

    const bounded = await run(["--mute", "15"]);
    assert.ok(/15 more minutes/.test(bounded.out), "--mute <n> must report the window it set");
    assert.ok(/music returns on its own/.test(bounded.out), "the user must be told it ends by itself");

    const forever = await run(["--mute", "0"]);
    assert.ok(/indefinitely/.test(forever.out), "--mute 0 must be the explicit opt-in to forever");

    const unmuted = await run(["--unmute"]);
    assert.strictEqual(unmuted.code, 0, "--unmute must exit 0");
    assert.ok(!fs.existsSync(path.join(home, ".vibeaudio", "muted")), "--unmute must clear the flag");

    fs.rmSync(home, { recursive: true, force: true });

    // Expiry must be self-healing: whoever reads it next clears it, so an
    // expired mute can never sit there looking live.
    // In a child with its own HOME: MUTE_FILE resolves from os.homedir() at
    // require time, and in-process this wrote - then cleared - the real one.
    const own = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-expiry-"));
    try {
      const expiry = require("child_process").spawnSync(process.execPath, ["-e", `
        const fs = require("fs"), path = require("path"), assert = require("assert");
        const { MUTE_FILE, muteState } = require(${JSON.stringify(path.join(TEST_DIR, "..", "src", "player"))});
        fs.mkdirSync(path.dirname(MUTE_FILE), { recursive: true });
        fs.writeFileSync(MUTE_FILE, JSON.stringify({ since: new Date().toISOString(), until: Date.now() - 1000 }));
        assert.strictEqual(muteState(), null, "an expired mute must read as not muted");
        assert.ok(!fs.existsSync(MUTE_FILE), "reading an expired mute must delete it");
        assert.ok(muteState() === null, "and stay deleted");
      `], { env: { ...process.env, HOME: own, USERPROFILE: own }, encoding: "utf8", timeout: 10000 });
      assert.strictEqual(expiry.status, 0, expiry.stderr);
    } finally {
      fs.rmSync(own, { recursive: true, force: true });
    }

    console.log("   ✓ Mute crosses process boundaries, and expires itself so it can't be forgotten.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
