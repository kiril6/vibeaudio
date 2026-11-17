const { assert, fs, path, os, TEST_DIR } = require("../helpers");

(async () => {
  // [68] The stuck pulse, for someone whose music is off.
  console.log("\n\x1b[1m[68] With music off, a stuck agent gets one pulse of its own\x1b[0m");
  {
    const { generateStuckChime, generateAttentionChime } = require("../../src/synth/chime");
    const wav = generateStuckChime();
    assert.ok(wav.equals(generateStuckChime()), "deterministic, like every generator");
    assert.ok(!wav.equals(generateAttentionChime()), "not the question chime");
    let peak = 0;
    for (let o = 44; o + 1 < wav.length; o += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(o)));
    assert.ok(peak / 32768 > 0.15 && peak / 32768 < 0.65, `quiet but audible, peak ${(peak / 32768).toFixed(2)}`);
    assert.ok(/chime_stuck/.test(require("../../src/player").getChimePath("stuck", 1)), "cached under its own name");

    if (process.platform !== "win32") {
      const { spawnSync } = require("child_process");
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-stuckchime-"));
      const log = path.join(dir, "played.log");
      fs.writeFileSync(log, "");
      fs.writeFileSync(path.join(dir, "afplay"), `#!/bin/sh\necho "$@" >> ${log}\nexit 0\n`, { mode: 0o755 });
      fs.writeFileSync(path.join(dir, "which"), `#!/bin/sh\n[ -x "${dir}/$1" ] && echo "${dir}/$1" || exit 1\n`, { mode: 0o755 });
      const CLI = path.join(TEST_DIR, "..", "bin", "vibeaudio.js");
      const env = { ...process.env, PATH: `${dir}:/bin:/usr/bin`, HOME: dir, USERPROFILE: dir, VIBE_DISABLE: "", VIBE_NO_FADE: "1", VIBE_NO_HISTORY: "1", VIBE_NO_UPDATE_CHECK: "1" };
      const run = (args, payload) => spawnSync(process.execPath, [CLI, ...args], { input: JSON.stringify(payload), env, timeout: 20000 });
      const played = () => fs.readFileSync(log, "utf8");
      const settle = async (what, check) => {
        for (let i = 0; i < 50 && !check(); i++) await new Promise((r) => setTimeout(r, 100));
        assert.ok(check(), what);
      };
      const failures = () => { for (let i = 0; i < 6; i++) run(["--hook-resume"], { session_id: "s1", tool_name: "Bash", hook_event_name: "PostToolUseFailure" }); };
      try {
        // Music on: the daemon's heartbeat covers it, so no separate pulse.
        run(["--hook-start"], { session_id: "s1", cwd: "/w" });
        failures();
        await new Promise((r) => setTimeout(r, 500));
        assert.ok(!/chime_stuck/.test(played()), "music on: the heartbeat layer, not a chime");
        run(["--hook-stop", "--no-chime"], { session_id: "s1" });
        run(["--stop"], {});

        run(["--music", "off"], {});
        run(["--hook-start"], { session_id: "s2", cwd: "/w" });
        for (let i = 0; i < 6; i++) run(["--hook-resume"], { session_id: "s2", tool_name: "Bash", hook_event_name: "PostToolUseFailure" });
        await settle("music off: the pulse plays", () => /chime_stuck/.test(played()));
        assert.strictEqual((played().match(/chime_stuck/g) || []).length, 1, "once, on the crossing, not per failure");
        assert.ok(!/loop_/.test(played().split("chime_stuck")[1] || ""), "and no music");
      } finally {
        run(["--stop"], {});
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
    console.log("   ✓ The heartbeat, standalone: quiet, deterministic, once per crossing, only when there is no music to carry it.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
