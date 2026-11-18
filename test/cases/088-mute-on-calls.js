const { assert, fs, path, os, TEST_DIR } = require("../helpers");

(async () => {
  // [88] --mute-on-calls: quiet while the microphone is in use, music back after.
  console.log("\n\x1b[1m[88] Mute on calls\x1b[0m");

  // The readings of each system, as the tools print them.
  {
    const { parsePactl, parseReg } = require("../../src/callwatch");
    const sources = "3\talsa_input.pci\tmodule-alsa-card.c\ts16le\n9\talsa_output.pci.monitor\tmodule-alsa-card.c\ts16le\n";
    const block = (n, corked, source, app) => `Source Output #${n}\n\tDriver: protocol-native.c\n\tCorked: ${corked}\n\tSource: ${source}\n\tProperties:\n\t\tapplication.name = "${app}"\n`;
    assert.deepStrictEqual(parsePactl(block(5, "no", 3, "Microsoft Teams"), sources), ["Microsoft Teams"]);
    assert.deepStrictEqual(parsePactl("", sources), [], "nothing recording");
    assert.deepStrictEqual(parsePactl(block(5, "yes", 3, "Idle app"), sources), [], "a paused stream is not recording");
    assert.deepStrictEqual(parsePactl(block(6, "no", 9, "OBS"), sources), [], "capturing what plays is not a voice");
    const meter = block(7, "no", 3, "PulseAudio Volume Control").replace("Properties:", 'Properties:\n\t\tmedia.name = "Peak detect"');
    assert.deepStrictEqual(parsePactl(meter, sources), [], "a volume meter is not a call");
    const loop = block(8, "no", 3, "").replace("protocol-native.c", "module-echo-cancel.c");
    assert.deepStrictEqual(parsePactl(loop, sources), [], "a module's own stream is there all day");
    assert.deepStrictEqual(parsePactl(block(5, "no", 3, "Microsoft Teams") + block(9, "no", 3, "Zoom"), sources), ["Microsoft Teams", "Zoom"], "two apps, both named");

    const key = "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone";
    const now = Date.parse("2026-11-18T12:00:00Z");
    const ft = (ms) => "0x" + (BigInt(ms + 11644473600000) * 10000n).toString(16);
    const q = (name, start, stop) => [`${key}\\${name}`, "    Value    REG_SZ    Allow", `    LastUsedTimeStart    REG_QWORD    ${start}`, `    LastUsedTimeStop    REG_QWORD    ${stop}`, ""];
    const reg = [
      key, "    Value    REG_SZ    Allow", "",
      ...q("NonPackaged\\C:#Program Files#Zoom#bin#Zoom.exe", ft(now - 600000), "0x0"),
      ...q("NonPackaged\\C:#Apps#old.exe", ft(now - 7200000), ft(now - 3600000)),
      ...q("NonPackaged\\C:#Apps#never.exe", "0x0", "0x0"),
      ...q("NonPackaged\\C:#Apps#crashed.exe", ft(now - 48 * 3600000), "0x0"),
      ...q("MSTeams_8wekyb3d8bbwe", ft(now - 60000), "0x0")
    ].join("\r\n");
    assert.deepStrictEqual(parseReg(reg, now), ["Zoom.exe", "MSTeams_8wekyb3d8bbwe"], "started and not stopped is on the mic; an app that never used it, stopped, or died on it days ago is not");
    assert.deepStrictEqual(parseReg("", now), []);

    const { cleanApps } = require("../../src/callwatch");
    assert.deepStrictEqual(cleanApps(["Zoom\x1b[31m\nrm -rf", 7, "x".repeat(100)]), ["Zoom [31m rm -rf", "x".repeat(40)], "third-party names carry no control characters and a bounded length");
    assert.strictEqual(cleanApps(new Array(20).fill("a")).length, 5);
    assert.deepStrictEqual(cleanApps("nope"), []);
  }

  // The state: shared, refreshed once per interval, and a short grace before it clears.
  {
    const { callState, callActive, CALL_FILE, GONE_MS, PROBE_TTL_MS } = require("../../src/callwatch");
    fs.rmSync(CALL_FILE, { force: true });
    let calls = 0;
    let reading = { inUse: true, apps: ["Zoom"] };
    const probe = () => { calls++; return reading; };
    assert.strictEqual(callActive(1000, probe), true, "mic in use is a call");
    assert.strictEqual(callActive(1000 + PROBE_TTL_MS - 1, probe), true);
    assert.strictEqual(calls, 1, "a fresh answer is read from the file, not asked of the system again");
    reading = { inUse: false, apps: [] };
    assert.strictEqual(callActive(1000 + PROBE_TTL_MS, probe), true, "off the mic a moment: still the call (a headset swap, an app's own mute)");
    assert.strictEqual(callActive(1000 + PROBE_TTL_MS + GONE_MS + PROBE_TTL_MS, probe), false, "off it for the grace: the call is over");
    assert.deepStrictEqual(callState(1000 + 100 * PROBE_TTL_MS, () => null).apps, [], "a probe that cannot tell is not a call");
    assert.strictEqual(callActive(1000 + 200 * PROBE_TTL_MS, () => null), false);
    // A clock that went backwards must not freeze the answer or pin a call.
    fs.rmSync(CALL_FILE, { force: true });
    reading = { inUse: true, apps: ["Zoom"] };
    assert.strictEqual(callActive(10 * PROBE_TTL_MS, probe), true);
    reading = { inUse: false, apps: [] };
    assert.strictEqual(callActive(10 * PROBE_TTL_MS - 3600000, probe), false, "an answer from the future is stale, and so is the grace it left");
    // A file someone edited or half wrote is no state at all.
    fs.writeFileSync(CALL_FILE, JSON.stringify({ at: "now", inUse: true, apps: "x", lastInUse: 1 }));
    assert.strictEqual(callActive(1e12, () => ({ inUse: false, apps: [] })), false, "a malformed file is re-read from the system");
    fs.rmSync(CALL_FILE, { force: true });
  }

  if (process.platform !== "win32") {
    const { spawnSync } = require("child_process");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-calls-"));
    const log = path.join(dir, "played.log");
    const probe = path.join(dir, "mic");
    fs.writeFileSync(log, "");
    fs.writeFileSync(probe, "0");
    fs.writeFileSync(path.join(dir, "afplay"), `#!/bin/sh\necho "$@" >> ${log}\nexit 0\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, "which"), `#!/bin/sh\n[ -x "${dir}/$1" ] && echo "${dir}/$1" || exit 1\n`, { mode: 0o755 });
    const CLI = path.join(TEST_DIR, "..", "bin", "vibeaudio.js");
    const env = { ...process.env, PATH: `${dir}:/bin:/usr/bin`, HOME: dir, USERPROFILE: dir, VIBE_DISABLE: "", VIBE_NO_FADE: "1", VIBE_NO_STREAM: "1", VIBE_NO_HISTORY: "1", VIBE_NO_UPDATE_CHECK: "1", VIBE_CALL_PROBE: probe };
    const run = (args, payload) => spawnSync(process.execPath, [CLI, ...args], { input: JSON.stringify(payload || {}), env, encoding: "utf8", timeout: 20000 });
    const loops = () => (fs.readFileSync(log, "utf8").match(/loop_/g) || []).length;
    const mic = (on) => fs.writeFileSync(probe, on ? "1" : "0");
    const settle = async (what, check, tries = 150) => {
      for (let i = 0; i < tries && !check(); i++) await new Promise((r) => setTimeout(r, 100));
      assert.ok(check(), what);
    };
    const why = () => run(["--why"]).stdout.replace(/\x1b\[[0-9;]*m/g, "").trim();
    try {
      // Off by default: a live mic changes nothing until it is turned on.
      mic(true);
      run(["--hook-start"], { session_id: "s0", cwd: "/w" });
      await settle("off by default: the music plays on a call", () => loops() >= 1);
      run(["--hook-stop", "--no-chime"], { session_id: "s0" });
      run(["--stop"]);

      const saved = run(["--mute-on-calls"]);
      assert.strictEqual(saved.status, 0);
      assert.match(run(["--status"]).stdout, /mute on a call/, "--status shows it");
      assert.strictEqual(run(["--mute-on-calls", process.execPath, "-e", "0"]).status, 1, "a setting flag with a command is an error, like the others");
      assert.ok(/mute-on-calls/.test(run(["--help"]).stdout));

      // A prompt during a call: the daemon starts and waits, nothing plays.
      const before = loops();
      run(["--hook-start"], { session_id: "s1", cwd: "/w" });
      await new Promise((r) => setTimeout(r, 1500));
      assert.strictEqual(loops(), before, "no music while the microphone is in use");
      assert.match(why(), /on a call/, "--why says so and names the way out");

      // The call ends and the turn is still working: the music comes back by itself.
      mic(false);
      await settle("music resumes after the call, no new prompt needed", () => loops() > before, 250);
      assert.doesNotMatch(why(), /on a call/);

      // A call that starts mid-turn pauses it, and the end brings it back again.
      const playing = loops();
      mic(true);
      await settle("a call mid-turn is seen", () => /on a call/.test(why()), 80);
      const paused = loops();
      await new Promise((r) => setTimeout(r, 1500));
      assert.strictEqual(loops(), paused, "no new loop during the call");
      mic(false);
      await settle("and music is back once it is over", () => loops() > paused, 250);
      assert.ok(loops() > playing);

      // The turn finishing mid-call is quiet: no chime over a call.
      const beforeChime = (fs.readFileSync(log, "utf8").match(/chime_/g) || []).length;
      mic(true);
      await settle("call seen again", () => /on a call/.test(why()), 80);
      run(["--hook-stop"], { session_id: "s1" });
      await new Promise((r) => setTimeout(r, 800));
      assert.strictEqual((fs.readFileSync(log, "utf8").match(/chime_/g) || []).length, beforeChime, "the done chime waits out a call: it is silent");

      // The install report points at the setting until it is on.
      const install = (extra) => spawnSync(process.execPath, [CLI, "--install-hooks", "--tools", "claude"], { env: { ...env, ...extra }, encoding: "utf8", timeout: 20000 }).stdout;
      assert.match(install({ VIBE_MUTE_ON_CALLS: "off" }), /vibe --mute-on-calls pauses the music/, "the install report offers it while it is off");
      assert.doesNotMatch(install({}), /vibe --mute-on-calls pauses the music/, "and stops offering it once it is on");

      // A wrapper started during a call stays quiet, then plays once the call is over.
      const { spawn } = require("child_process");
      run(["--stop"]);
      mic(true);
      const baseline = loops();
      const wrapped = spawn(process.execPath, [CLI, "--grace", "100", process.execPath, "-e", "setTimeout(()=>{},30000)"], { env, stdio: "ignore" });
      try {
        await new Promise((r) => setTimeout(r, 2000));
        assert.strictEqual(loops(), baseline, "a wrapper started on a call plays nothing");
        mic(false);
        await settle("the wrapper's music starts when the call ends", () => loops() > baseline, 300);
        const resumed = loops();
        mic(true);
        await new Promise((r) => setTimeout(r, 4000));
        const held = loops();
        await new Promise((r) => setTimeout(r, 2500));
        assert.strictEqual(loops(), held, "a call mid-run holds the wrapper's music");
        mic(false);
        await settle("and it comes back again", () => loops() > held, 300);
        assert.ok(loops() > resumed);
      } finally {
        wrapped.kill("SIGKILL");
      }
    } finally {
      run(["--stop"]);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  console.log("   ✓ Mic readings parsed per OS; a call pauses music, chimes and speech, and music resumes while a turn still works.");
})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
