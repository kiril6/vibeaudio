const { assert, fs, path, os, TEST_DIR } = require("../helpers");

(async () => {
  // [56] --notify: which session, not just that one did.
  {
    console.log("\n\x1b[1m[56] Notifications name the project, and stay off unless asked\x1b[0m");
    const h = require("../../src/hooks");

    assert.strictEqual(h.notifyEnabled({}, {}), false, "off by default");
    assert.strictEqual(h.notifyEnabled({}, { notify: true }), true, "saved setting turns it on");
    assert.strictEqual(h.notifyEnabled({ VIBE_NOTIFY: "0" }, { notify: true }), false, "an export beats the saved setting");
    assert.strictEqual(h.notifyEnabled({ VIBE_NOTIFY: "1" }, {}), true);

    assert.strictEqual(h.sessionLabel({ cwd: "/work/api/" }), "api");
    if (process.platform === "win32") assert.strictEqual(h.sessionLabel({ cwd: "C:\\work\\web" }), "web");
    assert.strictEqual(h.sessionLabel({}, "/x/fallback"), "fallback", "no cwd in the payload falls back to ours");

    // A project directory is user-controlled text: it must arrive as argv,
    // never inside a script string or as something notify-send reads as a flag.
    const evil = `-x"; do shell script "touch pwned"`;
    const mac = h.notifyCommand("darwin", "VibeAudio", evil);
    assert.ok(mac.args.includes(evil) && !mac.args.slice(0, -2).some((a) => a.includes("touch pwned")), "macOS body is an argument, not script text");
    const lin = h.notifyCommand("linux", "VibeAudio", evil);
    assert.deepStrictEqual(lin.args, ["--", "VibeAudio", evil], "notify-send gets `--` so a leading dash is text");
    assert.strictEqual(h.notifyCommand("win32", "t", "b"), null, "no built-in way on Windows, so it is skipped rather than failing");

    // End to end, where a stub stands in for the platform's notifier.
    const stubName = { darwin: "osascript", linux: "notify-send" }[process.platform];
    if (stubName) {
      const nHome = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-notify-"));
      const bin = path.join(nHome, "bin");
      const log = path.join(nHome, "argv.log");
      fs.mkdirSync(bin);
      fs.writeFileSync(path.join(bin, stubName), `#!/bin/sh\nfor a in "$@"; do echo "$a"; done > "${log}"\n`, { mode: 0o755 });
      fs.mkdirSync(path.join(nHome, ".vibeaudio", "sessions"), { recursive: true });
      fs.writeFileSync(path.join(nHome, ".vibeaudio", "sessions", "s1.json"), JSON.stringify({ waiting: null, ts: Date.now() }));

      const fire = (action, payload, extraEnv) => require("child_process").spawnSync(
        process.execPath, [path.join(TEST_DIR, "..", "bin", "vibeaudio.js"), action],
        { input: JSON.stringify(payload), encoding: "utf8",
          env: { PATH: bin, HOME: nHome, USERPROFILE: nHome, ...extraEnv } }
      );
      // The stub's shell creates the file before it writes to it, so wait for
      // the text, not the file: an existence check alone raced on a busy CI
      // runner. The 10s ceiling is only reached on failure.
      const read = (file) => { try { return fs.readFileSync(file, "utf8"); } catch (e) { return ""; } };
      const waitFor = (file, text = "") => { for (let i = 0; i < 200 && !(fs.existsSync(file) && read(file).includes(text) && read(file).length); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); return read(file).includes(text) && read(file).length > 0; };

      fire("--hook-stop", { session_id: "s1", cwd: "/work/api" }, {});
      assert.ok(!fs.existsSync(log), "without --notify nothing is shown");

      fs.writeFileSync(path.join(nHome, ".vibeaudio", "sessions", "s1.json"), JSON.stringify({ waiting: null, ts: Date.now() }));
      fire("--hook-stop", { session_id: "s1", cwd: "/work/api" }, { VIBE_NOTIFY: "1" });
      assert.ok(waitFor(log, "api: finished"), "with it on, a finished turn shows a notification");
      assert.ok(fs.readFileSync(log, "utf8").includes("api: finished"), "…that names the project");

      fs.rmSync(log);
      fs.writeFileSync(path.join(nHome, ".vibeaudio", "sessions", "s1.json"), JSON.stringify({ waiting: null, ts: Date.now() }));
      fire("--hook-wait", { session_id: "s1", cwd: "/work/api", tool_name: "Bash" }, { VIBE_NOTIFY: "1" });
      assert.ok(waitFor(log, "api: needs you (Bash)"), "a permission wait names the project and the tool");
      fs.rmSync(nHome, { recursive: true, force: true });
    }
    console.log("   ✓ Off by default; on, a turn that ends or blocks names its project - as argv, never script text.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
