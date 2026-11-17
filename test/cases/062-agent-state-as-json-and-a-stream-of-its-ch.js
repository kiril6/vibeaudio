const { fs, path, os, assert, parseArgs, TEST_DIR } = require("../helpers");

(async () => {
  // [62] --state and --events: the agent states, for consumers other than the music.
  console.log("\n\x1b[1m[62] Agent state as JSON, and a stream of its changes\x1b[0m");
  {
    const { spawnSync, spawn } = require("child_process");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-events-"));
    const env = { ...process.env, HOME: home, USERPROFILE: home, VIBE_DISABLE: "1", VIBE_NO_UPDATE_CHECK: "1", VIBE_NO_HISTORY: "1" };
    const CLI = path.join(TEST_DIR, "..", "bin", "vibeaudio.js");
    const hook = (action, payload) => spawnSync(process.execPath, [CLI, `--hook-${action}`], { input: JSON.stringify(payload), env, timeout: 10000 });
    const state = () => JSON.parse(spawnSync(process.execPath, [CLI, "--state"], { env, encoding: "utf8" }).stdout);
    const eventsFile = path.join(home, ".vibeaudio", "events.jsonl");
    const events = () => fs.readFileSync(eventsFile, "utf8").trim().split("\n").map(JSON.parse);
    const s1 = (extra = {}) => ({ session_id: "s1", cwd: "/work/api", ...extra });

    try {
      assert.deepStrictEqual(state(), { v: 1, status: "idle", sessions: [] }, "nothing running is idle");

      hook("start", s1());
      assert.deepStrictEqual(state().sessions.map((s) => [s.session, s.project, s.state]), [["s1", "/work/api", "working"]]);
      hook("wait", s1({ tool_name: "Bash" }));
      assert.strictEqual(state().sessions[0].tool, "Bash", "a waiting session says what it waits on");

      // The machine's status is its most urgent session: waiting beats working.
      hook("start", { session_id: "s2", cwd: "/work/web" });
      assert.strictEqual(state().status, "waiting", "one session waiting on you outranks another working");

      hook("resume", s1({ tool_name: "Bash", hook_event_name: "PostToolUse" }));
      for (let i = 0; i < 4; i++) hook("resume", s1({ tool_name: "Bash", hook_event_name: "PostToolUseFailure" }));
      assert.strictEqual(state().status, "stuck", "stuck outranks working");
      for (let i = 0; i < 8; i++) hook("resume", s1({ tool_name: "Bash", hook_event_name: "PostToolUse" }));
      hook("stop", s1());
      hook("end", { session_id: "s2" });
      hook("end", { session_id: "nobody" });

      const log = events();
      assert.deepStrictEqual(log.map((e) => e.event), ["started", "waiting", "started", "resumed", "stuck", "recovered", "finished", "ended"],
        "each transition once - not one line per tool call, and nothing for a session never seen");
      assert.deepStrictEqual(log.map((e) => e.status), ["working", "waiting", "waiting", "working", "stuck", "working", "working", "idle"],
        "every line carries the status it left behind");
      assert.strictEqual(log[1].tool, "Bash");
      assert.strictEqual(log[6].outcome, "success");
      assert.ok(log.every((e) => e.v === 1 && Number.isFinite(e.at) && e.session), "versioned, timestamped, attributed");
      assert.strictEqual(log[7].project, "/work/web", "a session's project is remembered from its prompt");

      // A muted machine still reports state: a light is not sound.
      fs.writeFileSync(path.join(home, ".vibeaudio", "muted"), "0");
      hook("start", s1());
      assert.strictEqual(events().pop().event, "started", "muting silences sound, not state");

      // The stream: current state first, then new lines - including across a rotation.
      fs.writeFileSync(eventsFile, `${"x".repeat(300 * 1024)}\n`);
      const follower = spawn(process.execPath, [CLI, "--events"], { env });
      let out = "";
      follower.stdout.on("data", (d) => { out += d; });
      const until = async (what, check) => {
        for (let i = 0; i < 60 && !check(); i++) await new Promise((r) => setTimeout(r, 100));
        assert.ok(check(), what);
      };
      await until("--events opens with the current state", () => out.includes("\n"));
      const first = JSON.parse(out.split("\n")[0]);
      assert.strictEqual(first.event, "state");
      assert.strictEqual(first.status, "working");
      hook("stop", s1());
      await until("a new event reaches the stream", () => /"finished"/.test(out));
      follower.kill();
      assert.ok(!out.includes("xxx"), "a rotation starts the follower on the new file, not over the old one");
      assert.ok(fs.existsSync(`${eventsFile}.1`) && fs.statSync(eventsFile).size < 1024, "the log rotates past 256 KB");

      // #24: --mute keeps the turns in flight; --stop ends each one out loud.
      hook("start", s1());
      hook("start", { session_id: "s2", cwd: "/work/web" });
      const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { env, encoding: "utf8", timeout: 10000 });
      const before = events().length;
      assert.strictEqual(cli("--mute").status, 0);
      assert.strictEqual(state().sessions.length, 2, "a mute silences the music, not the turns");
      assert.strictEqual(events().length, before, "and ends nothing");
      // An unmute with a turn still running brings the music back at once, over a player the mute stopped.
      const pidFile = path.join(home, ".vibeaudio", "daemon.pid");
      assert.ok(!fs.existsSync(pidFile) || !(() => { try { process.kill(Number(fs.readFileSync(pidFile, "utf8")), 0); return true; } catch (e) { return false; } })(), "the mute stopped the player");
      const unmuted = cli("--unmute");
      assert.ok(/Music is back/.test(unmuted.stdout), "--unmute says the music is back when a turn is running");
      assert.ok(fs.existsSync(pidFile), "and a player was started for it");
      // A saved genre or music-off reaches the music already playing, not the next prompt; the turns stay.
      // Playback is not disabled here, so a fake backend stands in for the speakers.
      const bin = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-live-"));
      fs.writeFileSync(path.join(bin, "afplay"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      fs.writeFileSync(path.join(bin, "which"), `#!/bin/sh\n[ -x "${bin}/$1" ] && echo "${bin}/$1" || exit 1\n`, { mode: 0o755 });
      const liveEnv = { ...env, PATH: `${bin}:/bin:/usr/bin`, VIBE_DISABLE: "", VIBE_NO_FADE: "1" };
      const live = (...args) => spawnSync(process.execPath, [CLI, ...args], { env: liveEnv, encoding: "utf8", timeout: 10000 });
      const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return false; } };
      const pid1 = Number(fs.readFileSync(pidFile, "utf8"));
      assert.ok(/changed with it/.test(live("--genre", "zen").stdout), "a genre change says it reached the music");
      const pid2 = Number(fs.readFileSync(pidFile, "utf8"));
      assert.notStrictEqual(pid2, pid1, "a new genre replaces the player");
      assert.ok(alive(pid2), "and the replacement plays");
      live("--music", "off");
      await until("music off stops the player", () => !alive(pid2));
      assert.strictEqual(state().sessions.length, 2, "music off stops the sound, not the turns");
      live("--music", "on");
      assert.ok(alive(Number(fs.readFileSync(pidFile, "utf8"))), "music on starts it again for a running turn");
      fs.rmSync(bin, { recursive: true, force: true });
      assert.strictEqual(cli("--stop").status, 0);
      const ended = events().slice(before);
      assert.deepStrictEqual(ended.map((e) => [e.event, e.reason]).sort(), [["ended", "stop"], ["ended", "stop"]], "--stop ends every session it drops");
      assert.deepStrictEqual(ended.map((e) => e.session).sort(), ["s1", "s2"]);
      assert.deepStrictEqual(ended.map((e) => e.status), ["working", "idle"], "the last one leaves the machine idle");
      assert.deepStrictEqual(state(), { v: 1, status: "idle", sessions: [] });
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
    assert.strictEqual(parseArgs(["node", "vibe", "--events"]).events, true);
    assert.strictEqual(parseArgs(["node", "vibe", "npm", "--state"]).state, false, "after the command it is the child's flag");
    console.log("   ✓ One state vocabulary across agents: a JSON snapshot, and a stream that survives rotation.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
