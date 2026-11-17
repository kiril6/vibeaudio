const { fs, path, os, spawn, assert, TEST_DIR } = require("../helpers");

(async () => {
  // 25. A recycled pid must never be signalled
  // Regression: stopDaemon killed whatever pid the file named. A pid file
  // outlives a daemon that died without cleanup, and pids get recycled, so
  // that eventually SIGTERMs an unrelated process - on every prompt.
  //
  // hooks.js resolves PID_FILE from os.homedir() at require time, so the fake
  // home has to be set before the module loads: this runs in a child process
  // rather than reaching into the real ~/.vibeaudio.
  console.log("25. Testing Daemon PID Ownership Guard...");
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-pid-"));
  const probe = `
    const fs = require("fs"), path = require("path");
    const { spawn } = require("child_process");
    const hooks = require(process.argv[1]);
    const stranger = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
    fs.mkdirSync(path.dirname(hooks.PID_FILE), { recursive: true });
    fs.writeFileSync(hooks.PID_FILE, String(stranger.pid));
    const claimedKill = hooks.stopDaemon();
    setTimeout(() => {
      let alive = true;
      try { process.kill(stranger.pid, 0); } catch (e) { alive = false; }
      console.log(JSON.stringify({
        home: hooks.PID_FILE,
        isOurs: hooks.isOurDaemon(stranger.pid),
        claimedKill,
        strangerAlive: alive,
        pidFileCleared: !fs.existsSync(hooks.PID_FILE)
      }));
      stranger.kill();
      process.exit(0);
    }, 200);
  `;
  const probeOut = await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["-e", probe, path.join(TEST_DIR, "..", "src", "hooks.js")],
      { env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome }, stdio: ["ignore", "pipe", "inherit"] }
    );
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.on("close", () => resolve(JSON.parse(out)));
  });

  assert.ok(
    probeOut.home.startsWith(fakeHome),
    `the probe must operate on a throwaway home, not ${probeOut.home}`
  );
  assert.ok(probeOut.pidFileCleared, "the stale pid file is still cleared");

  // isOurDaemon trusts the pid on Windows for want of a cheap command-line
  // lookup, so the ownership guarantee itself is Unix-only.
  if (process.platform === "win32") {
    console.log("   ✓ Stale pid file cleared (ownership guard is Unix-only, skipped here).");
  } else {
    assert.strictEqual(probeOut.isOurs, false, "an unrelated process is not our daemon");
    assert.strictEqual(probeOut.claimedKill, false, "stopDaemon must not claim a kill it did not make");
    assert.ok(probeOut.strangerAlive, "stopDaemon must not kill a process that is not its daemon");
    console.log("   ✓ A stale pid file cannot make stopDaemon signal an unrelated process.");
  }

  fs.rmSync(fakeHome, { recursive: true, force: true });


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
