const { fs, path, os, assert, TEST_DIR } = require("../helpers");

(async () => {
  // 48. Auditioning a genre from the menu
  if (process.platform === "win32") {
    console.log("\n\x1b[1m[48] Menu audition\x1b[0m\n   ✓ Skipped on Windows (needs a POSIX executable bit).");
  } else {
    console.log("\n\x1b[1m[48] Menu audition\x1b[0m");
    const { spawnSync } = require("child_process");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-audition-"));
    try {
      // A fake backend that reports its own death. Counting live processes
      // with `ps` looked simpler and was wrong twice over: it is system-wide,
      // so this machine's real afplay - actual music, playing for reasons
      // that have nothing to do with the test - was counted too, and the
      // `ps | grep` pipeline matches its own command line. Asking the process
      // that gets killed to say so needs neither.
      const log = path.join(dir, "played.log");
      fs.writeFileSync(path.join(dir, "afplay"),
        `#!/bin/sh\ntrap 'echo "killed $*" >> ${log}; exit 0' TERM\necho "start $*" >> ${log}\nsleep 5 & wait\n`,
        { mode: 0o755 });
      fs.writeFileSync(path.join(dir, "which"), `#!/bin/sh\n[ -x "${dir}/$1" ] && echo "${dir}/$1" || exit 1\n`, { mode: 0o755 });

      const home = path.join(dir, "home");
      fs.mkdirSync(home);
      const driver = path.join(dir, "drive.js");
      fs.writeFileSync(driver, `
        const { playPreview, stopPreview } = require(${JSON.stringify(path.join(TEST_DIR, "..", "src", "interactive"))});
        const fs = require("fs");
        // Each step waits until the fake has logged the last one: it cannot
        // log a kill before its trap is set (#44).
        const logged = (re) => { try { return re.test(fs.readFileSync(${JSON.stringify(log)}, "utf8")); } catch (e) { return false; } };
        const until = async (re) => { for (const end = Date.now() + 10000; !logged(re) && Date.now() < end; ) await new Promise((r) => setTimeout(r, 50)); };
        (async () => {
          playPreview("jazz");
          await until(/^start .*loop_jazz_t2/m);
          // A second press has to silence the first: one pair of speakers.
          playPreview("zen");
          await until(/^start .*loop_zen_t2/m);
          stopPreview();
          await until(/^killed .*loop_zen_t2/m);
        })();
      `);

      // A pinned seed keeps this out of any real project's cache directory,
      // which pruneSeedDirs() would otherwise evict to make room for it.
      const SEED = "909090";
      const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, HOME: home, USERPROFILE: home, VIBE_DISABLE: "", VIBE_SEED: SEED };
      const out = spawnSync(process.execPath, [driver], { encoding: "utf8", env, timeout: 40000 });
      assert.strictEqual(out.status, 0, `audition driver failed: ${out.stderr}`);
      const played = fs.readFileSync(log, "utf8").trim().split("\n");

      const at = (re) => played.findIndex((l) => re.test(l));
      const startedJazz = at(/^start .*loop_jazz_t2/);
      const startedZen = at(/^start .*loop_zen_t2/);
      const killedJazz = at(/^killed .*loop_jazz_t2/);
      const killedZen = at(/^killed .*loop_zen_t2/);

      assert.ok(startedJazz === 0, `first press must play jazz, got ${played[0]}`);
      assert.ok(startedZen > startedJazz, `second press must play zen, got ${played.join(" | ")}`);
      // One pair of speakers: the second press has to silence the first, and
      // it has to happen before the second starts, not eventually.
      assert.ok(killedJazz > startedJazz && killedJazz < startedZen,
        `a second audition must stop the first, got ${played.join(" | ")}`);
      assert.ok(killedZen > startedZen, "leaving the menu must stop the audition");

      // A mute set for a call outranks a keypress, the same as it outranks a
      // hook: the point of --mute is that nothing surprises you mid-call.
      const muted = spawnSync(process.execPath, ["-e", `
        const { playPreview } = require(${JSON.stringify(path.join(TEST_DIR, "..", "src", "interactive"))});
        playPreview("lofi");
      `], { encoding: "utf8", env: { ...env, VIBE_DISABLE: "1" }, timeout: 20000 });
      assert.strictEqual(muted.status, 0);
      const starts = fs.readFileSync(log, "utf8").trim().split("\n").filter((l) => l.startsWith("start"));
      assert.strictEqual(starts.length, 2, "a mute must keep the audition silent");
    } finally {
      // The whole sandbox, cache included: HOME points inside it, so nothing
      // here can evict the cache of a project the user actually works in.
      fs.rmSync(dir, { recursive: true, force: true });
    }
    console.log("   ✓ p auditions the highlighted genre, replaces the last one, stops on exit, and honours a mute.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
