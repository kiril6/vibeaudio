const { assert, TEST_DIR } = require("../helpers");

(async () => {
  // [80] Custom chime files (#29).
  {
    console.log("\n\x1b[1m[80] Custom chime files\x1b[0m");
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const { spawnSync } = require("child_process");
    const { getChimePath, applyGain, wavDurationMs, saveConfig, loadConfig } = require("../../src/player");
    const chimefile = require("../../src/chimefile");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-chimefile-"));

    // A real-world WAV: stereo, 22.05 kHz, a LIST chunk ahead of the data, so the header is not 44 bytes.
    const wavWith = (ms, { bits = 16, tag = 1 } = {}) => {
      const frames = Math.round(22050 * ms / 1000);
      const pcm = Buffer.alloc(frames * 4);
      for (let i = 0; i < frames * 2; i++) pcm.writeInt16LE(i % 2 ? 8000 : -8000, i * 2);
      const list = Buffer.concat([Buffer.from("LIST"), Buffer.from([4, 0, 0, 0]), Buffer.from("INFO")]);
      const fmt = Buffer.alloc(24);
      fmt.write("fmt ", 0); fmt.writeUInt32LE(16, 4); fmt.writeUInt16LE(tag, 8); fmt.writeUInt16LE(2, 10);
      fmt.writeUInt32LE(22050, 12); fmt.writeUInt32LE(22050 * 4, 16); fmt.writeUInt16LE(4, 20); fmt.writeUInt16LE(bits, 22);
      const dataHead = Buffer.concat([Buffer.from("data"), Buffer.alloc(4)]);
      dataHead.writeUInt32LE(pcm.length, 4);
      const body = Buffer.concat([Buffer.from("WAVE"), fmt, list, dataHead, pcm]);
      const head = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4)]);
      head.writeUInt32LE(body.length, 4);
      return Buffer.concat([head, body]);
    };
    const put = (name, buf) => { const f = path.join(dir, name); fs.writeFileSync(f, buf); return f; };

    const good = put("done.wav", wavWith(200));
    const read = chimefile.readChimeWav(good);
    assert.ok(!read.error, read.error);
    assert.strictEqual(read.wav.length, 44 + 4410 * 4, "re-emitted with the canonical 44-byte header, LIST dropped");
    assert.ok(Math.abs(read.durationMs - 200) < 1);

    // Rejections: each one is a reason the built-in plays instead.
    assert.match(chimefile.readChimeWav(put("long.wav", wavWith(3500))).error, /longer than the 3 s limit/);
    assert.match(chimefile.readChimeWav(put("24.wav", wavWith(200, { bits: 24 }))).error, /16-bit PCM/);
    assert.match(chimefile.readChimeWav(put("float.wav", wavWith(200, { tag: 3 }))).error, /16-bit PCM/);
    assert.match(chimefile.readChimeWav(put("x.mp3", Buffer.from("ID3 not a wav at all"))).error, /not a WAV/);
    assert.match(chimefile.readChimeWav(path.join(dir, "gone.wav")).error, /not found/);
    assert.strictEqual(chimefile.expandChimePath("relative/x.wav"), null, "a relative path is never guessed");
    assert.strictEqual(chimefile.expandChimePath("~/x.wav"), path.join(os.homedir(), "x.wav"));

    // Playback path: setting -> file in the cache, built-in otherwise.
    const builtin = getChimePath("success", 1);
    assert.ok(!path.basename(builtin).includes("custom"));
    const env = (k) => { for (const n of ["VIBE_CHIME_SUCCESS", "VIBE_CHIME_FAILURE", "VIBE_CHIME_ATTENTION"]) delete process.env[n]; if (k) Object.assign(process.env, k); };
    try {
      env({ VIBE_CHIME_SUCCESS: good });
      const custom = getChimePath("success", 1);
      assert.match(path.basename(custom), /^chime_custom_success_/);
      assert.ok(Math.abs(wavDurationMs(custom) - 200) < 1, "wavDurationMs reads the normalised file");
      assert.strictEqual(getChimePath("failure", 1), getChimePath("failure", 1));
      assert.ok(!path.basename(getChimePath("failure", 1)).includes("custom"), "failure was not replaced");
      assert.ok(!path.basename(getChimePath("attention", 1)).includes("custom"), "attention was not replaced");
      assert.ok(!path.basename(getChimePath("stuck", 1)).includes("custom"), "stuck is never replaceable");
      env({ VIBE_CHIME_SUCCESS: good, VIBE_CHIME_ATTENTION: good });
      assert.match(path.basename(getChimePath("attention", 1)), /^chime_custom_attention_/, "the 'needs you' chime can be replaced");
      env({ VIBE_CHIME_STUCK: good });
      assert.ok(!path.basename(getChimePath("stuck", 1)).includes("custom"), "VIBE_CHIME_STUCK does nothing");
      delete process.env.VIBE_CHIME_STUCK;
      // The spoken line waits out a chime of the user's own, not ours.
      const speech = require("../../src/speech");
      env({ VIBE_CHIME_ATTENTION: good });
      assert.strictEqual(speech.chimeDelayMs("attention"), wavDurationMs(getChimePath("attention", 1)) + 150, "speech starts after the custom chime");
      env({ VIBE_CHIME_SUCCESS: good });
      assert.strictEqual(speech.chimeDelayMs("attention"), 1450, "built-in attention keeps its own length");
      env({ VIBE_CHIME_SUCCESS: good });

      // Gain exactly once: a backend that cannot attenuate gets a pre-scaled copy, and only that copy.
      const quiet = getChimePath("success", 0.5);
      assert.match(path.basename(quiet), /_g50\.wav$/);
      const full = fs.readFileSync(custom);
      const half = fs.readFileSync(quiet);
      assert.strictEqual(half.readInt16LE(44 + 2), Math.round(full.readInt16LE(44 + 2) * 0.5), "scaled once");
      assert.strictEqual(fs.readFileSync(getChimePath("success", 1)).readInt16LE(46), full.readInt16LE(46), "gain 1 leaves the file alone");

      // Editing the file renders a fresh copy; a broken file falls back, never to silence.
      fs.writeFileSync(good, wavWith(400));
      fs.utimesSync(good, new Date(), new Date(Date.now() + 5000));
      assert.ok(Math.abs(wavDurationMs(getChimePath("success", 1)) - 400) < 1, "an edited file is picked up");
      fs.writeFileSync(good, Buffer.from("garbage"));
      fs.utimesSync(good, new Date(), new Date(Date.now() + 9000));
      assert.strictEqual(getChimePath("success", 1), builtin, "an unusable file falls back to the built-in chime");
      env({ VIBE_CHIME_SUCCESS: path.join(dir, "gone.wav") });
      assert.strictEqual(getChimePath("success", 1), builtin, "a missing file falls back too");
      env({ VIBE_CHIME_SUCCESS: "default" });
      assert.strictEqual(getChimePath("success", 1), builtin, "'default' means the built-in");

      // Precedence: env > project > global.
      const a = put("a.wav", wavWith(100));
      const b = put("b.wav", wavWith(150));
      const c = put("c.wav", wavWith(250));
      env();
      saveConfig({ chimes: { success: a }, projects: { [process.cwd()]: { chimes: { success: b } } } });
      assert.ok(Math.abs(wavDurationMs(getChimePath("success", 1)) - 150) < 1, "this project beats the global setting");
      env({ VIBE_CHIME_SUCCESS: c });
      assert.ok(Math.abs(wavDurationMs(getChimePath("success", 1)) - 250) < 1, "an export beats both");
    } finally {
      env();
      saveConfig({ chimes: null, projects: null });
    }

    // End to end through the CLI, under a throwaway HOME: save, refuse bad input, restore.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-chimecli-"));
    const cenv = { ...process.env, HOME: home, USERPROFILE: home, VIBE_NO_UPDATE_CHECK: "1", VIBE_NO_HISTORY: "1" };
    for (const n of ["VIBE_CHIME_SUCCESS", "VIBE_CHIME_FAILURE", "VIBE_CHIME_ATTENTION", "VIBE_DISABLE"]) delete cenv[n];
    const CLI = path.join(TEST_DIR, "..", "bin", "vibeaudio.js");
    const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { env: cenv, encoding: "utf8", timeout: 20000 });
    const saved = () => { try { return JSON.parse(fs.readFileSync(path.join(home, ".vibeaudio", "config.json"), "utf8")); } catch (e) { return {}; } };
    try {
      const fresh = put("fresh.wav", wavWith(120));
      assert.strictEqual(cli("--success-chime", fresh).status, 0);
      assert.deepStrictEqual(saved().chimes, { success: fresh });
      assert.strictEqual(cli("--failure-chime", fresh).status, 0);
      assert.deepStrictEqual(saved().chimes, { success: fresh, failure: fresh }, "the second flag keeps the first");
      assert.strictEqual(cli("--attention-chime", fresh).status, 0);
      assert.deepStrictEqual(saved().chimes, { success: fresh, failure: fresh, attention: fresh }, "attention saves like the others");
      assert.strictEqual(cli("--attention-chime", "default").status, 0);
      assert.deepStrictEqual(saved().chimes, { success: fresh, failure: fresh });
      assert.match(cli("--status").stdout, /success chime\s+\S*fresh\.wav/, "--status names the chime in effect");

      const bad = cli("--success-chime", "relative.wav");
      assert.strictEqual(bad.status, 1);
      assert.match(bad.stderr, /absolute path/);
      const long = cli("--success-chime", put("long2.wav", wavWith(3500)));
      assert.strictEqual(long.status, 1);
      assert.match(long.stderr, /nothing saved/);
      assert.deepStrictEqual(saved().chimes, { success: fresh, failure: fresh }, "a refused file changes nothing");

      cli("--here", "--success-chime", fresh);
      assert.ok(Object.values(saved().projects || {}).some((p) => p.chimes && p.chimes.success === fresh), "--here saves under the project");

      // A file that goes bad later: doctor warns, nothing throws.
      fs.writeFileSync(fresh, Buffer.from("broken"));
      const doctor = cli("--doctor").stdout.replace(/\x1b\[[0-9;]*m/g, "");
      assert.match(doctor, /Custom success chime[^\n]*not a WAV[^\n]*built-in/);

      assert.strictEqual(cli("--success-chime", "default").status, 0);
      assert.deepStrictEqual(saved().chimes, { failure: fresh }, "'default' removes the key");
      const trailing = cli("--success-chime");
      assert.strictEqual(trailing.status, 1, "a trailing flag is an error, not a wrapped command");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
    console.log("   ✓ Your own WAV replaces done, failed or needs-you: real headers read, 3 s cap, gain once, built-in on any fault.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
