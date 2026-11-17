const { assert, fs, path, os, TEST_DIR } = require("../helpers");

(async () => {
  // [61] An agent that keeps failing changes the music's character, not its level.
  console.log("\n\x1b[1m[61] A stuck agent adds a heartbeat\x1b[0m");
  {
    const { spawnSync } = require("child_process");
    const { addTension, pulseFreq } = require("../../src/synth/tension");
    const { generateLoop, getAudioPath, GENRE_KEYS } = require("../../src/player");

    const loop = generateLoop("jazz", 2, 42, 0);
    const tense = addTension(loop, GENRE_KEYS.jazz);
    assert.strictEqual(tense.length, loop.length, "same length, so the loop timer and crossfade are untouched");
    assert.ok(loop.subarray(0, 44).equals(tense.subarray(0, 44)), "same header");
    assert.ok(!tense.equals(loop), "the heartbeat is actually in it");
    assert.ok(addTension(loop, GENRE_KEYS.jazz).equals(tense), "deterministic, or the cache file would churn");
    const edge = 44 + Math.round(0.15 * 44100) * 2 * loop.readUInt16LE(22);
    assert.ok(loop.subarray(44, edge).equals(tense.subarray(44, edge)) && loop.subarray(-edge + 44).equals(tense.subarray(-edge + 44)), "the loop's boundary fades are left alone, so seams stay clean");
    assert.ok(Buffer.from(generateLoop("jazz", 2, 42, 0)).equals(loop), "the input is not mixed in place");
    for (const key of [...Object.values(GENRE_KEYS), undefined]) {
      const f = pulseFreq(key);
      assert.ok(f >= 110 && f <= 220, `${key}: ${f.toFixed(1)} Hz is above where laptop speakers give out`);
    }
    assert.ok(Math.abs(pulseFreq("C major") - 130.81) < 0.1 && Math.abs(pulseFreq("D minor") - 146.83) < 0.1, "on the tonic");

    const plain = getAudioPath("lofi", 1, 9_876_543);
    const stuck = getAudioPath("lofi", 1, 9_876_543, 1, 0, true);
    assert.ok(stuck.endsWith("loop_lofi_t1_x.wav") && plain !== stuck, "the stuck loop is its own cache file");
    assert.ok(!fs.readFileSync(stuck).equals(fs.readFileSync(plain)), "…with the heartbeat in it");
    fs.rmSync(path.dirname(plain), { recursive: true, force: true });

    // Through the real hook: failures counted per session, interrupts not, and
    // the notification fires once, on the crossing.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-stuck-"));
    const bin = path.join(home, "bin");
    const note = path.join(home, "notes.log");
    fs.mkdirSync(bin);
    const stubName = { darwin: "osascript", linux: "notify-send" }[process.platform];
    if (stubName) fs.writeFileSync(path.join(bin, stubName), `#!/bin/sh\nfor a in "$@"; do echo "$a"; done >> "${note}"\n`, { mode: 0o755 });
    const sessions = path.join(home, ".vibeaudio", "sessions");
    fs.mkdirSync(sessions, { recursive: true });
    fs.writeFileSync(path.join(sessions, "s1.json"), JSON.stringify({ waiting: null, started: Date.now(), ts: Date.now() }));
    const recent = () => JSON.parse(fs.readFileSync(path.join(sessions, "s1.json"), "utf8")).recent;
    const tool = (event, extra = {}) => spawnSync(process.execPath, [path.join(TEST_DIR, "..", "bin", "vibeaudio.js"), "--hook-resume"], {
      input: JSON.stringify({ session_id: "s1", cwd: "/work/api", hook_event_name: event, tool_name: "Bash", ...extra }),
      env: { PATH: bin, HOME: home, USERPROFILE: home, VIBE_NOTIFY: "1", VIBE_NO_UPDATE_CHECK: "1" }, timeout: 10000
    });
    const hooks = require("../../src/hooks");
    try {
      tool("PostToolUseFailure", { is_interrupt: true });
      assert.deepStrictEqual(recent(), [0], "Esc mid-tool is the user, not a failure");
      // The usual loop: a failing run, an edit that works, run again...
      for (let i = 0; i < 3; i++) { tool("PostToolUseFailure"); tool("PostToolUse"); }
      assert.ok(!hooks.isStuck({ recent: recent() }), "three failures is not yet stuck");
      tool("PostToolUseFailure");
      assert.ok(hooks.isStuck({ recent: recent() }), "four of the last eight is - even with successes in between");
      tool("PostToolUseFailure");
      if (stubName) {
        // Wait for the text (the stub's shell creates the file before writing),
        // then a little longer, so a second, wrong banner would have landed too.
        const noteText = () => { try { return fs.readFileSync(note, "utf8"); } catch (e) { return ""; } };
        for (let i = 0; i < 200 && !noteText().includes("looks stuck"); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
        const lines = fs.readFileSync(note, "utf8").split("\n").filter((l) => l.includes("looks stuck"));
        assert.strictEqual(lines.length, 1, "the notification fires once, when it crosses, not on every failure after");
        assert.ok(lines[0].includes("api: looks stuck"), "and names the project");
      }
      assert.strictEqual(recent().length, hooks.STUCK_WINDOW, "the window stays bounded");
      for (let i = 0; i < hooks.STUCK_WINDOW; i++) tool("PostToolUse");
      assert.ok(!hooks.isStuck({ recent: recent() }), "a run of successes clears it");
      assert.ok(!fs.existsSync(path.join(home, ".vibeaudio", "daemon.pid")), "counting never starts music on its own");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
    console.log("   ✓ Four failures in eight calls adds a heartbeat on the tonic, clear of the seams; it notifies once and clears itself.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
