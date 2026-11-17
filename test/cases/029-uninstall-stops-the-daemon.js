const { fs, path, os, spawn, CLI, assert, TEST_DIR } = require("../helpers");

(async () => {
  // 29. Uninstalling must not strand a running player
  // Once the hooks are gone nothing sends Stop, and npm rm -g takes away the
  // only thing that could stop it - so the daemon would play to its 15min cap.
  console.log("29. Testing Uninstall Stops The Daemon...");
  if (process.platform === "win32") {
    console.log("   ✓ Skipped on Windows (daemon ownership check is Unix-only).");
  } else {
    const uninstallHome = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-uninst-"));
    // Waits on conditions, not fixed sleeps (#44): a daemon mid-render handles
    // SIGTERM late on a loaded machine. Each wait awaits rather than blocks, so
    // this probe - the daemon's parent - can reap it; a zombie still answers
    // kill(pid, 0).
    const probeSrc = `
      const hooks = require(process.argv[1]);
      const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return false; } };
      const until = async (ok) => { const end = Date.now() + 5000; while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); };
      hooks.installHooks("lofi", 0.05, hooks.settingsPath());
      const pid = hooks.hookStart("lofi", 0.05);
      (async () => {
        // Until the uninstall can recognise it: isOurDaemon() reads its argv.
        await until(() => hooks.isOurDaemon(pid));
        require("child_process").execFileSync(process.execPath, [process.argv[2], "--uninstall-hooks"], { stdio: "ignore" });
        await until(() => !alive(pid));
        console.log(JSON.stringify({ alive: alive(pid) }));
        if (alive(pid)) { try { process.kill(pid, "SIGTERM"); } catch (e) {} }
        process.exit(0);
      })();
    `;
    const result = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        ["-e", probeSrc, path.join(TEST_DIR, "..", "src", "hooks.js"), CLI],
        { env: { ...process.env, HOME: uninstallHome, USERPROFILE: uninstallHome }, stdio: ["ignore", "pipe", "inherit"] }
      );
      let out = "";
      child.stdout.on("data", (c) => (out += c));
      child.on("close", () => resolve(JSON.parse(out)));
    });

    assert.strictEqual(result.alive, false, "--uninstall-hooks must stop the running daemon");
    fs.rmSync(uninstallHome, { recursive: true, force: true });
    console.log("   ✓ Uninstalling the hooks also stops the player they started.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
