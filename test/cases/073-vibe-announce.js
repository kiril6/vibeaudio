const { fs, path, os, assert, TEST_DIR } = require("../helpers");

(async () => {
  // [73] vibe --announce: the signals for something that is not an agent (#35).
  console.log("\n\x1b[1m[73] vibe --announce\x1b[0m");
  if (process.platform === "win32") {
    console.log("   ✓ Skipped on Windows (needs a POSIX executable bit for the stub backend).");
  } else {
    const { spawnSync } = require("child_process");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-announce-"));
    const log = path.join(dir, "played.log");
    fs.writeFileSync(log, "");
    fs.writeFileSync(path.join(dir, "afplay"), `#!/bin/sh\necho "$@" >> ${log}\nexit 0\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, "which"), `#!/bin/sh\n[ -x "${dir}/$1" ] && echo "${dir}/$1" || exit 1\n`, { mode: 0o755 });
    const CLI = path.join(TEST_DIR, "..", "bin", "vibeaudio.js");
    const env = { ...process.env, PATH: `${dir}:/bin:/usr/bin`, HOME: dir, USERPROFILE: dir, VIBE_DISABLE: "", VIBE_NO_UPDATE_CHECK: "1" };
    const run = (args, extra = {}) => spawnSync(process.execPath, [CLI, ...args], { env: { ...env, ...extra }, encoding: "utf8", timeout: 20000 });
    const events = () => {
      try { return fs.readFileSync(path.join(dir, ".vibeaudio", "events.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse); }
      catch (e) { return []; }
    };
    const played = () => fs.readFileSync(log, "utf8");
    const heard = async (needle) => {
      for (let t = 0; t < 100 && !played().includes(needle); t++) await new Promise((r) => setTimeout(r, 50));
      return played().includes(needle);
    };
    const quiet = async () => { await new Promise((r) => setTimeout(r, 400)); return played() === ""; };
    try {
      // The chime follows the outcome; --exit-code maps 0 to success, anything else to failure.
      let r = run(["--announce", "CI green"]);
      assert.strictEqual(r.status, 0, r.stderr);
      assert.ok(await heard("chime_success"), "the default outcome is success");
      fs.writeFileSync(log, "");
      run(["--announce", "deploy", "--outcome", "attention"]);
      assert.ok(await heard("chime_attention"), "--outcome attention");
      fs.writeFileSync(log, "");
      run(["--announce", "ci", "--exit-code", "3"]);
      assert.ok(await heard("chime_failure"), "a non-zero --exit-code is a failure");
      fs.writeFileSync(log, "");
      run(["--announce", "ci ok", "--exit-code", "0"]);
      assert.ok(await heard("chime_success"), "--exit-code 0 is a success");

      // Every announcement is an event, with its source, text and outcome, and no session.
      const last = events().pop();
      assert.deepStrictEqual(
        [last.event, last.source, last.text, last.outcome, last.session, last.status],
        ["announced", "cli", "ci ok", "success", null, "idle"]);

      // The same text again within a few seconds is dropped whole.
      fs.writeFileSync(log, "");
      const before = events().length;
      run(["--announce", "ci ok"]);
      assert.ok(await quiet(), "a repeat must not chime again");
      assert.strictEqual(events().length, before, "or log again");

      // Mute silences the sound; the event is still written, like every event.
      run(["--announce", "muted one"], { VIBE_DISABLE: "1" });
      assert.ok(await quiet(), "nothing plays while muted");
      assert.strictEqual(events().pop().text, "muted one");

      // --no-chime, control characters and length.
      run(["--announce", "silent", "--no-chime"]);
      assert.ok(await quiet(), "--no-chime");
      run(["--announce", `a\nb\x07${"x".repeat(500)}`]);
      const text = events().pop().text;
      assert.ok(!/[\u0000-\u001f]/.test(text) && text.length === require("../../src/hooks").ANNOUNCE_MAX_CHARS, "control characters go and the length is capped");

      // It never starts music or opens a session.
      assert.ok(!fs.existsSync(path.join(dir, ".vibeaudio", "daemon.pid")) && !fs.existsSync(path.join(dir, ".vibeaudio", "sessions")), "no daemon, no session");

      // Misuse is an error, not a wrapped command.
      r = run(["--announce"]);
      assert.strictEqual(r.status, 1);
      assert.ok(/--announce needs a value/.test(r.stderr), r.stderr);
      assert.strictEqual(run(["--announce", "x", "--outcome", "nope"]).status, 1);
      assert.strictEqual(run(["--announce", "x", "--exit-code", "abc"]).status, 1);
      assert.strictEqual(run(["--announce", "x", "--outcome", "success", "--exit-code", "1"]).status, 1);
      assert.strictEqual(run(["--exit-code", "1"]).status, 1, "--exit-code alone has nothing to apply to");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    console.log("   ✓ Each outcome picks its chime; --exit-code maps; the event is written; repeats, mute and --no-chime stay quiet; misuse is an error.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
