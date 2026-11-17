const { assert, AVAILABLE_GENRES, fs, path, os, parseArgs, TEST_DIR } = require("../helpers");

(async () => {
  // [57] The chime resolves onto the music's key; --report reads what hooks log.
  {
    console.log("\n\x1b[1m[57] Key-matched chime, turn history and --report\x1b[0m");
    const { generateSuccessChime, DEFAULT_CHIME_KEY, SUCCESS_CHIME_NOTES } = require("../../src/synth/chime");
    const { chimeKeyFor, getChimePath, GENRE_KEYS } = require("../../src/player");

    // The default chime is the original one, byte for byte: a project that
    // never plays a keyed genre must not hear a change.
    assert.ok(generateSuccessChime().equals(generateSuccessChime(1.6, DEFAULT_CHIME_KEY)), "default key is the original chime");
    assert.ok(generateSuccessChime(1.6, "not a key").equals(generateSuccessChime()), "an unknown key falls back to the default");
    const rendered = Object.keys(SUCCESS_CHIME_NOTES).map((k) => generateSuccessChime(1.6, k).toString("hex"));
    assert.strictEqual(new Set(rendered).size, Object.keys(SUCCESS_CHIME_NOTES).length, "every key sounds different");

    // Every genre's chime is a chord of its own key: root first, fifth second.
    const semis = (n) => { const m = /^([A-G])(#|b)?(\d)$/.exec(n); return ({C:0,D:2,E:4,F:5,G:7,A:9,B:11})[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + 12 * +m[3]; };
    for (const [key, notes] of Object.entries(SUCCESS_CHIME_NOTES)) {
      assert.strictEqual(semis(notes[1]) - semis(notes[0]), 7, `${key}: second note is a fifth over the root`);
      assert.strictEqual(semis(notes[2]) - semis(notes[0]), 12, `${key}: third note is the octave`);
      const third = semis(notes[3]) - semis(notes[2]);
      assert.strictEqual(third, key.endsWith("minor") ? 3 : 4, `${key}: the third has the right quality`);
    }
    assert.strictEqual(chimeKeyFor("synthwave"), "D minor");
    assert.strictEqual(chimeKeyFor("chill"), "C major", "aliases resolve first (chill = lofi)");
    assert.strictEqual(chimeKeyFor("random"), DEFAULT_CHIME_KEY, "random is not rolled a second time for the chime");
    assert.strictEqual(chimeKeyFor("rain"), DEFAULT_CHIME_KEY, "noise has no key to match");
    for (const g of Object.keys(GENRE_KEYS)) assert.ok(AVAILABLE_GENRES.includes(g), `${g} is a real genre`);

    const cached = [getChimePath("success", 1), getChimePath("success", 1, "D minor"), getChimePath("failure", 1, "D minor")];
    assert.ok(cached[0].endsWith("chime_success.wav"), "the default keeps its original file name");
    assert.ok(cached[1].endsWith("chime_success_Dminor.wav"), "a keyed chime is cached apart");
    assert.ok(cached[2].endsWith("chime_failure.wav"), "only the success chime has keys");

    // History + report, in a child with HOME redirected (the real log is the user's).
    const { spawnSync: run } = require("child_process");
    const hHome = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-history-"));
    const histFile = path.join(hHome, ".vibeaudio", "history.jsonl");
    fs.mkdirSync(path.join(hHome, ".vibeaudio", "sessions"), { recursive: true });
    const cli = path.join(TEST_DIR, "..", "bin", "vibeaudio.js");
    const env = { ...process.env, HOME: hHome, USERPROFILE: hHome, VIBE_DISABLE: "1", VIBE_NO_UPDATE_CHECK: "1" };
    const now = Date.now();
    const stop = (session, payload, extra = {}) => {
      fs.writeFileSync(path.join(hHome, ".vibeaudio", "sessions", "s1.json"), JSON.stringify({ ...session, ts: now }));
      return run(process.execPath, [cli, "--hook-stop"], { input: JSON.stringify({ session_id: "s1", ...payload }), encoding: "utf8", env: { ...env, ...extra } });
    };

    stop({ started: now - 90000, blockedMs: 20000, waiting: null }, { cwd: "/work/api" });
    stop({ started: now - 50000, blockedMs: 0, waiting: "Bash", waitStart: now - 30000 }, { cwd: "/work/web", status: "error" });
    const logged = fs.readFileSync(histFile, "utf8").trim().split("\n").map(JSON.parse);
    assert.strictEqual(logged.length, 2);
    assert.strictEqual(logged[0].project, "/work/api");
    assert.ok(Math.abs(logged[0].ms - 90000) < 5000 && logged[0].blockedMs === 20000, "duration and the time blocked on you are logged");
    assert.ok(Math.abs(logged[1].blockedMs - 30000) < 5000, "a turn that ends still paused counts the wait");
    assert.strictEqual(logged[1].outcome, "failure", "the outcome is logged");
    assert.strictEqual(logged[0].session, "s1", "the session is logged, so return times pair within it");
    assert.strictEqual(logged[0].chimed, false, "VIBE_DISABLE means no chime announced the turn");

    fs.rmSync(histFile);
    stop({ started: now - 1000, waiting: null }, { cwd: "/x" }, { VIBE_NO_HISTORY: "1" });
    assert.ok(!fs.existsSync(histFile), "VIBE_NO_HISTORY=1 logs nothing");
    stop({ waiting: null }, { cwd: "/x" });
    assert.ok(!fs.existsSync(histFile), "a session with no start time is not guessed at");

    const rep = (args) => run(process.execPath, [cli, "--report", ...args], { encoding: "utf8", env }).stdout.replace(/\x1b\[[0-9;]*m/g, "");
    assert.ok(/No turns recorded yet/.test(rep([])), "an empty log says how to start one");
    fs.writeFileSync(histFile, [
      { at: now - 3600e3, project: "/work/api", ms: 600000, blockedMs: 120000, outcome: "success" },
      { at: now - 7200e3, project: "/work/api", ms: 300000, blockedMs: 0, outcome: "failure" },
      { at: now - 3 * 86400e3, project: "/oss/cli", ms: 60000, blockedMs: 0, outcome: "success" },
      { at: now - 40 * 86400e3, project: "/old/project", ms: 999000, blockedMs: 0, outcome: "success" }
    ].map((t) => JSON.stringify(t)).join("\n") + "\nnot json\n");
    const week = rep([]);
    assert.ok(/Turns\s+3\s+1 failed/.test(week), "counts the turns in the window, skips the bad line");
    assert.ok(/You waited\s+14m 00s/.test(week), "working time is turn time minus time blocked on you");
    assert.ok(/Agents waited\s+2m 00s/.test(week), "…and the blocked time is its own line");
    assert.ok(/api\s+13m 00s/.test(week) && /cli/.test(week) && !/\bproject\b/.test(week), "per project, and the old turn is outside the window");
    assert.ok(/Turns\s+4\b/.test(rep(["60"])) && /\bproject\b/.test(rep(["60"])), "a longer window brings it in");
    assert.ok(!/Back to it/.test(week), "no turn follows another in its project closely enough to pair");

    // Return time: done -> next prompt, paired per session, breaks left out.
    const { returnTimes, RETURN_WINDOW_MS } = require("../../src/history");
    const T = (session, endS, durS, chimed, project = "/p") => ({ session, project, at: now + endS * 1000, ms: durS * 1000, chimed });
    const gaps = returnTimes([
      T("a", 100, 60, true), T("a", 200, 60, false), // a: back 40s after a chimed turn
      T("b", 150, 120, true),                           // b interleaves with a in the same repo
      T("a", 200 + RETURN_WINDOW_MS / 1000 + 100, 50),  // a: a break, not a return
      { project: "/old", at: now, ms: 10e3 }, { project: "/old", at: now + 30e3, ms: 10e3 } // pre-session lines pair by project
    ]);
    assert.deepStrictEqual(gaps.map((g) => g.ms).sort((x, y) => x - y), [20000, 40000], "only same-session gaps under the window count");
    assert.strictEqual(gaps.find((g) => g.ms === 40000).chimed, true, "the gap carries the chime of the turn it answered");

    // Turns end every 10 minutes; even ones chime. After a chimed turn the next
    // prompt comes 30s later, after a silent one 9 minutes later.
    const back = [];
    for (let i = 0; i < 12; i++) back.push(T("c", i * 600, i % 2 ? 570 : 60, i % 2 === 0));
    fs.writeFileSync(histFile, back.map((t) => JSON.stringify({ ...t, at: t.at - 86400e3, blockedMs: 0, outcome: "success" })).join("\n") + "\n");
    const withBack = rep([]);
    assert.ok(/Back to it\s+\S+\s+median from done to your next prompt, 11 times/.test(withBack), "--report shows the median return time");
    assert.ok(/30s with a chime\s+9m 00s without/.test(withBack), "…and splits it by chime once both sides have five");

    assert.strictEqual(parseArgs(["node", "vibe", "--report"]).report, 7);
    assert.strictEqual(parseArgs(["node", "vibe", "--report", "30"]).report, 30);
    assert.strictEqual(parseArgs(["node", "vibe", "npm", "test", "--report"]).report, null, "after the command it is the child's flag");
    fs.rmSync(hHome, { recursive: true, force: true });

    console.log("   ✓ The chime lands on the music's key; hooks log each turn; --report totals it without guessing.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
