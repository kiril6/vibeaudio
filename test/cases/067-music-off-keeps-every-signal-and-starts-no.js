const { assert, parseArgs, fs, path, os, TEST_DIR } = require("../helpers");

(async () => {
  // [67] --music off: signals without the music.
  console.log("\n\x1b[1m[67] Music off keeps every signal and starts no player\x1b[0m");
  {
    const { spawnSync } = require("child_process");
    const { musicEnabled } = require("../../src/player");
    const cwd = process.cwd();
    assert.strictEqual(musicEnabled({}, {}), true, "on by default");
    assert.strictEqual(musicEnabled({}, { music: false }), false, "saved off");
    assert.strictEqual(musicEnabled({ VIBE_MUSIC: "on" }, { music: false }), true, "env beats the file");
    assert.strictEqual(musicEnabled({ VIBE_MUSIC: "off" }, {}), false);
    assert.strictEqual(musicEnabled({}, { music: false, projects: { [cwd]: { music: true } } }), true, "--here beats the global setting");
    assert.strictEqual(musicEnabled({}, { music: "off" }), false, "a hand-edited string works too");
    assert.strictEqual(parseArgs(["node", "vibe", "--music", "off", "npm", "test"]).music, false, "a flag applies to the run it is on");
    assert.strictEqual(parseArgs(["node", "vibe", "--music", "off"]).typed.music, false, "and with no command it is saved");

    const home = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-music-"));
    const base = { ...process.env, HOME: home, USERPROFILE: home, VIBE_DISABLE: "1", VIBE_NO_UPDATE_CHECK: "1", VIBE_NO_HISTORY: "1" };
    delete base.VIBE_MUSIC;
    const CLI = path.join(TEST_DIR, "..", "bin", "vibeaudio.js");
    const cli = (args, env = base, input) => spawnSync(process.execPath, [CLI, ...args], { env, input, encoding: "utf8", timeout: 10000 });
    const pidFile = path.join(home, ".vibeaudio", "daemon.pid");
    const config = () => JSON.parse(fs.readFileSync(path.join(home, ".vibeaudio", "config.json"), "utf8"));
    const events = () => fs.readFileSync(path.join(home, ".vibeaudio", "events.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    const s1 = JSON.stringify({ session_id: "s1", cwd: "/work/api" });
    try {
      // The control: music on starts the player, so the absence below means something.
      cli(["--hook-start"], base, s1);
      assert.ok(fs.existsSync(pidFile), "music on spawns the daemon");
      cli(["--hook-stop"], base, s1);
      cli(["--stop"]);
      fs.rmSync(pidFile, { force: true });

      assert.strictEqual(cli(["--music", "maybe"]).status, 1, "only on or off");
      assert.strictEqual(cli(["--music"]).status, 1, "a value is required");
      assert.strictEqual(cli(["--music", "off"]).status, 0);
      assert.strictEqual(config().music, false, "saved as a setting of its own");
      assert.ok(!("genre" in config()), "the genre is not touched, so it is still there when music returns");

      cli(["--hook-start"], base, s1);
      assert.ok(!fs.existsSync(pidFile), "music off spawns no daemon");
      assert.strictEqual(JSON.parse(cli(["--state"]).stdout).status, "working", "the turn is still tracked");

      const wait = JSON.stringify({ session_id: "s1", cwd: "/work/api", tool_name: "Bash" });
      cli(["--hook-wait"], base, wait);
      cli(["--hook-resume"], base, JSON.stringify({ session_id: "s1", tool_name: "Bash", hook_event_name: "PostToolUse" }));
      assert.ok(!fs.existsSync(pidFile), "a resume does not bring the music back");
      cli(["--hook-stop"], base, s1);
      assert.deepStrictEqual(events().slice(-4).map((e) => e.event), ["started", "waiting", "resumed", "finished"], "events still fire for every transition");

      assert.strictEqual(cli(["--hook-start"], { ...base, VIBE_MUSIC: "on" }, s1).status, 0);
      assert.ok(fs.existsSync(pidFile), "an exported VIBE_MUSIC=on beats the saved off");
      cli(["--stop"]);

      assert.ok(/music\s+.*off/.test(cli(["--status"]).stdout.replace(/\x1b\[[0-9;]*m/g, "")), "--status says why there is no music");
      assert.strictEqual(cli(["--music", "on", "--here"]).status, 0);
      assert.strictEqual(config().projects[cwd].music, true, "--here saves for the directory it ran in");
      assert.strictEqual(config().music, false, "and leaves the global setting alone");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
    console.log("   ✓ Off is a setting of its own: hooks track the turn and fire events, no daemon starts, env and --here override it.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
