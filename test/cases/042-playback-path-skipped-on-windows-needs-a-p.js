const { os, assert, TEST_DIR } = require("../helpers");

(async () => {
  // 42. The playback path itself, driven through a fake audio backend - so
  //     --no-chime and a genre switch are checked against what was actually
  //     spawned rather than against a return value.
  if (process.platform === "win32") {
    console.log("\n\x1b[1m[42] Playback path\x1b[0m\n   ✓ Skipped on Windows (needs a POSIX executable bit).");
  } else {
    console.log("\n\x1b[1m[42] Playback path, via a fake audio backend\x1b[0m");
    const fs = require("fs");
    const path = require("path");

    // A backend that records what it was asked to play instead of playing it.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-play-"));
    const log = path.join(dir, "played.log");
    fs.writeFileSync(path.join(dir, "afplay"), `#!/bin/sh\necho "$@" >> ${log}\nexit 0\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, "which"), `#!/bin/sh\n[ -x "${dir}/$1" ] && echo "${dir}/$1" || exit 1\n`, { mode: 0o755 });

    // Run in a child: detectPlayer() caches at module scope, so the sandbox
    // PATH has to be in place before player.js is first required.
    const driver = path.join(dir, "drive.js");
    // spawn() is asynchronous, so each step waits until the backend has
    // recorded it before the next one tears it down - otherwise the fake is
    // SIGTERMed before it can record anything and the test fails on itself.
    // A wait on the log, not a fixed sleep: a loaded machine is slow (#44).
    fs.writeFileSync(driver, `
      const fs = require("fs");
      const { AudioPlayer } = require(${JSON.stringify(path.join(TEST_DIR, "..", "src", "player"))});
      const logged = (re) => { try { return re.test(fs.readFileSync(${JSON.stringify(log)}, "utf8")); } catch (e) { return false; } };
      const until = async (re) => { for (const end = Date.now() + 10000; !logged(re) && Date.now() < end; ) await new Promise((r) => setTimeout(r, 50)); };
      (async () => {
        const p = new AudioPlayer();
        const out = {};
        out.firstStart = p.start("jazz", 0.4);
        await until(/loop_jazz_/);
        out.sameAgain  = p.start("jazz", 0.4);   // identical settings: no restart
        out.switched   = p.start("zen", 0.4);    // different genre: must restart
        await until(/loop_zen_/);
        out.genre      = p.genre;
        p.stop({ playChime: true, outcome: "success" });
        p.stop({ playChime: false });
        await until(/chime_success/);
        console.log(JSON.stringify(out));
        process.exit(0);
      })();
    `);

    const run = require("child_process").spawnSync(process.execPath, [driver], {
      encoding: "utf8",
      timeout: 20000,
      env: { ...process.env, PATH: dir, HOME: dir, USERPROFILE: dir, VIBE_DISABLE: "" }
    });
    assert.strictEqual(run.status, 0, `driver failed: ${run.stderr}`);
    const out = JSON.parse(run.stdout.trim().split("\n").pop());

    assert.strictEqual(out.firstStart, true, "start() must report that it started");
    assert.strictEqual(out.sameAgain, false, "restarting with identical settings is a no-op");
    assert.strictEqual(out.switched, true, "a genre switch must restart, not be dropped");
    assert.strictEqual(out.genre, "zen", "and the player must be on the new genre");

    const played = fs.readFileSync(log, "utf8");
    assert.ok(/loop_jazz_/.test(played), "the jazz loop must actually reach the backend");
    assert.ok(/loop_zen_/.test(played), "and so must the genre we switched to");
    assert.ok(/chime_success/.test(played), "playChime:true must spawn the chime");

    // --no-chime, the other direction: nothing new may be played.
    fs.writeFileSync(log, "");
    const quiet = path.join(dir, "quiet.js");
    fs.writeFileSync(quiet, `
      const { AudioPlayer } = require(${JSON.stringify(path.join(TEST_DIR, "..", "src", "player"))});
      (async () => {
        const p = new AudioPlayer();
        p.start("jazz", 0.4);
        await new Promise((r) => setTimeout(r, 400));
        p.stop({ playChime: false });
        process.exit(0);
      })();
    `);
    require("child_process").spawnSync(process.execPath, [quiet], {
      timeout: 20000,
      env: { ...process.env, PATH: dir, HOME: dir, USERPROFILE: dir, VIBE_DISABLE: "" }
    });
    assert.ok(!/chime/.test(fs.readFileSync(log, "utf8")), "playChime:false must spawn no chime at all");

    // --no-chime is decided in cli.js, not in AudioPlayer, so it only counts
    // if the wrapper itself is driven. Asserting on stop({playChime:false})
    // tests the wrong layer and passes while the flag is ignored.
    const CLI_BIN = path.join(TEST_DIR, "..", "bin", "vibeaudio.js");
    const wrapper = (extra) => {
      fs.writeFileSync(log, "");
      require("child_process").spawnSync(
        process.execPath,
        [CLI_BIN, "--grace", "0", ...extra, process.execPath, "-e", "setTimeout(() => {}, 700)"],
        { timeout: 30000, stdio: "ignore", env: { ...process.env, PATH: dir, HOME: dir, USERPROFILE: dir, VIBE_DISABLE: "" } }
      );
      return fs.readFileSync(log, "utf8");
    };

    const withChime = wrapper([]);
    assert.ok(/loop_/.test(withChime), "the wrapper must start music once the grace window passes");
    assert.ok(/chime_success/.test(withChime), "a clean run past the grace window must chime");

    const noChime = wrapper(["--no-chime"]);
    assert.ok(/loop_/.test(noChime), "--no-chime silences the chime, not the music");
    assert.ok(!/chime/.test(noChime), "--no-chime must reach the chime decision in cli.js");

    fs.rmSync(dir, { recursive: true, force: true });
    console.log("   ✓ Loops and chimes reach the backend; a genre switch restarts; --no-chime is honoured end to end.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
