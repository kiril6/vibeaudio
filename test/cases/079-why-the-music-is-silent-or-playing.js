const { assert, fs, path, os, TEST_DIR } = require("../helpers");

(async () => {
  // [79] --status opens with why the music is silent or playing (#76).
  {
    console.log("\n\x1b[1m[79] Why the music is silent or playing\x1b[0m");
    const hooks = require("../../src/hooks");
    const base = { disabledByEnv: false, mute: null, backend: true, daemon: null, genre: "lofi", volume: null, music: true, musicSource: "", sessions: [] };
    const why = (f) => hooks.explainMusic({ ...base, ...f });
    const s = (state, project) => ({ state, project });
    const daemon = { genre: "jazz", volume: 40 };

    assert.deepStrictEqual(why({}), { playing: false, text: "silent: no agent is working; music starts with your next prompt" });
    assert.deepStrictEqual(why({ daemon, volume: 40, sessions: [s("working", "/w/api"), s("working", "/w/web")] }),
      { playing: true, text: "playing: jazz @ 40%, 2 sessions working (api, web)" });
    assert.strictEqual(why({ daemon, sessions: [s("stuck", "/w/api")] }).text, "playing: jazz, 1 session working (api); heartbeat on, api keeps failing");
    assert.strictEqual(why({ daemon, sessions: "abcde".split("").map((p) => s("working", `/w/${p}`)) }).text, "playing: jazz, 5 sessions working (a, b, c +2)");
    assert.strictEqual(why({ sessions: [s("waiting", "/w/web")] }).text, "silent: 1 session waiting on you (web); music resumes when you answer");
    assert.strictEqual(why({ music: false }).text, "silent: music is off; chimes still play (vibe --music on)");
    assert.strictEqual(why({ music: false, musicSource: "project" }).text, "silent: music is off for this project; chimes still play (vibe --music on --here)", "a saved global would not beat --here");
    assert.strictEqual(why({ music: false, musicSource: "env" }).text, "silent: music is off by VIBE_MUSIC in this shell; chimes still play (unset VIBE_MUSIC)", "nor an export");
    assert.strictEqual(why({ sessions: [s("working", "/w/api")] }).text, "silent: 1 session working (api) but the player is not running (vibe --doctor)");
    assert.strictEqual(why({ mute: 42 }).text, "silent: muted for 42 more min (vibe --unmute)");
    assert.strictEqual(why({ mute: Infinity }).text, "silent: muted until you unmute (vibe --unmute)");
    // The order: everything that silences all sound outranks the rest, and a player outranks why it might not run.
    assert.match(why({ disabledByEnv: true, mute: 5, backend: false, daemon }).text, /VIBE_DISABLE/, "VIBE_DISABLE first");
    assert.match(why({ mute: 5, backend: false, daemon }).text, /muted/, "a mute outranks a missing player");
    assert.match(why({ backend: false, daemon, music: false }).text, /no audio player/, "no player outranks a running daemon");
    assert.match(why({ daemon, music: false, sessions: [s("waiting", "/w/web")] }).text, /^playing/, "what is in the air outranks why it might stop");
    assert.match(why({ music: false, sessions: [s("waiting", "/w/web")] }).text, /waiting on you/, "a wait explains the silence before music off");

    // End to end: the first line of --status, from the files a mute writes.
    const { spawnSync } = require("child_process");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-why-"));
    const env = { ...process.env, HOME: home, USERPROFILE: home, VIBE_NO_UPDATE_CHECK: "1", VIBE_NO_HISTORY: "1" };
    delete env.VIBE_DISABLE;
    const CLI = path.join(TEST_DIR, "..", "bin", "vibeaudio.js");
    const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { env, encoding: "utf8", timeout: 20000 });
    try {
      run("--mute", "30");
      const line = run("--status").stdout.replace(/\x1b\[[0-9;]*m/g, "").split("\n").find((l) => l.startsWith("Now"));
      assert.strictEqual(line, "Now  silent: muted for 30 more min (vibe --unmute)");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
    console.log("   ✓ One line says why: mute, player, waits, music off and sessions, in that order.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
