const { assert, fs, path, os, sandboxPathWith, TEST_DIR } = require("../helpers");

(async () => {
  // [76] Spoken announcements (#33), vibe --announcements, and the "Alerts & extras" menu.
  console.log("\n\x1b[1m[76] Spoken announcements\x1b[0m");
  {
    const speech = require("../../src/speech");

    // a. The words: fixed phrases, a cleaned label, nothing the project can steer.
    assert.strictEqual(speech.speakMode({}, {}), "off", "off by default");
    assert.strictEqual(speech.speakMode({}, { speak: "auto" }), "auto");
    assert.strictEqual(speech.speakMode({}, { speak: "always" }), "always");
    assert.strictEqual(speech.speakMode({ VIBE_SPEAK: "off" }, { speak: "always" }), "off", "env beats the saved setting");
    assert.strictEqual(speech.speakMode({ VIBE_SPEAK: "1" }, {}), "auto");
    assert.strictEqual(speech.speakMode({}, { speak: "banana" }), "off", "an unknown value is off, not on");
    assert.ok(!speech.shouldSpeak("auto", 1) && speech.shouldSpeak("auto", 2), "auto needs two or more sessions");
    assert.ok(speech.shouldSpeak("always", 1) && !speech.shouldSpeak("off", 5));
    assert.strictEqual(speech.phrase("success", "my-app_v2"), "my app v2: done.");
    assert.strictEqual(speech.phrase("failure", "api"), "api: failed.");
    assert.strictEqual(speech.phrase("attention", "web", "apply_patch"), "web needs you: apply patch.");
    assert.strictEqual(speech.phrase("stuck", "web"), "web looks stuck.");
    assert.ok(!/\[\[|\]\]/.test(speech.cleanText("a [[volm 0]] b [[[[rate 500]]]] c")), "embedded speech commands are removed, nested ones too");
    assert.ok(!/[\u0000-\u001f]/.test(speech.cleanText("a\nb\x07c")) && speech.cleanText("x".repeat(999)).length === speech.SPEECH_MAX_CHARS);

    // b. The command: the text is an argument (or an environment variable on Windows), never a script.
    const has = (name) => name === "say" || name === "spd-say";
    const mac = speech.voiceCommand("darwin", "api: done.", 0.4, has);
    assert.strictEqual(mac.cmd, "say");
    assert.ok(mac.args[0] === "--" && mac.args[1].endsWith("api: done."), "say gets the text after --, so a name like -v is not a flag");
    assert.strictEqual(speech.voiceCommand("linux", "x", 0.4, has).cmd, "spd-say");
    assert.strictEqual(speech.voiceCommand("linux", "x", 0.4, (n) => n === "espeak").cmd, "espeak");
    assert.strictEqual(speech.voiceCommand("linux", "x", 0.4, () => false), null, "no voice, no command");
    const win = speech.voiceCommand("win32", "evil'; rm x; '", 0.4, () => false);
    assert.ok(!win.args.join(" ").includes("evil") && win.env.VIBE_SPEECH_TEXT === "evil'; rm x; '", "on Windows the text rides in the environment, not in the script");

    // c. One speaker at a time: a second caller waits, then gives up rather than talk over the first.
    {
      const release = await speech.acquireLock(500);
      assert.ok(release, "the first caller gets the lock");
      assert.strictEqual(await speech.acquireLock(300), null, "the second finds it held");
      release();
      const again = await speech.acquireLock(500);
      assert.ok(again, "and it is free once released");
      again();
    }

    if (process.platform === "win32") {
      console.log("   ✓ Words, commands and the lock checked (end-to-end skipped on Windows: needs a POSIX stub voice).");
    } else {
      const { spawnSync } = require("child_process");
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-speak-"));
      const chimes = path.join(dir, "chimes.log");
      const said = path.join(dir, "said.log");
      fs.writeFileSync(chimes, "");
      fs.writeFileSync(said, "");
      const voice = process.platform === "darwin" ? "say" : "spd-say";
      fs.writeFileSync(path.join(dir, "afplay"), `#!/bin/sh\necho "$@" >> ${chimes}\nexit 0\n`, { mode: 0o755 });
      fs.writeFileSync(path.join(dir, voice), `#!/bin/sh\necho "$@" >> ${said}\nexit 0\n`, { mode: 0o755 });
      fs.writeFileSync(path.join(dir, "which"), `#!/bin/sh\n[ -x "${dir}/$1" ] && echo "${dir}/$1" || exit 1\n`, { mode: 0o755 });
      const CLI = path.join(TEST_DIR, "..", "bin", "vibeaudio.js");
      const env = { ...process.env, PATH: `${dir}:/bin:/usr/bin`, HOME: dir, USERPROFILE: dir, VIBE_DISABLE: "", VIBE_MUSIC: "off", VIBE_NO_FADE: "1", VIBE_NO_UPDATE_CHECK: "1" };
      const vibe = (args, extra = {}, input = "") => spawnSync(process.execPath, [CLI, ...args], { env: { ...env, ...extra }, encoding: "utf8", input, timeout: 20000 });
      const hook = (flag, session, cwd, extra = {}, payload = {}) =>
        vibe([flag], extra, JSON.stringify({ session_id: session, cwd, ...payload }));
      const heard = async (needle, ms = 6000) => {
        for (let t = 0; t < ms / 50 && !fs.readFileSync(said, "utf8").includes(needle); t++) await new Promise((r) => setTimeout(r, 50));
        return fs.readFileSync(said, "utf8").includes(needle);
      };
      const silent = async () => { await new Promise((r) => setTimeout(r, 700)); return fs.readFileSync(said, "utf8") === ""; };
      const reset = () => fs.writeFileSync(said, "");
      try {
        // d. The flags save the mode.
        assert.ok(/Spoken announcements on/.test(vibe(["--speak"]).stdout), "--speak saves auto");
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, ".vibeaudio", "config.json"), "utf8")).speak, "auto");
        assert.ok(/status|speak/.test(vibe(["--status"]).stdout) && /speak\s+auto/.test(vibe(["--status"]).stdout.replace(/\x1b\[[0-9;]*m/g, "")), "--status reports it");

        // e. auto: one session says nothing, two say which finished.
        hook("--hook-start", "a", "/work/api");
        hook("--hook-start", "b", "/work/web");
        hook("--hook-stop", "a", "/work/api");
        assert.ok(await heard("api: done."), "with two sessions going, the one that finished is named");
        assert.ok(fs.readFileSync(chimes, "utf8").includes("chime_success"), "after its chime, not instead of it");
        reset();
        hook("--hook-stop", "b", "/work/web");
        assert.ok(await silent(), "the last session finishing alone is not worth a sentence in auto");

        // f. always: even alone.
        vibe(["--speak-always"]);
        hook("--hook-start", "solo", "/work/solo");
        hook("--hook-stop", "solo", "/work/solo");
        assert.ok(await heard("solo: done."), "--speak-always speaks with one session");

        // g. The same sentence again inside the window is dropped.
        reset();
        hook("--hook-start", "solo", "/work/solo");
        hook("--hook-stop", "solo", "/work/solo");
        assert.ok(await silent(), "a repeat inside five seconds is dropped");

        // h. A mute silences the voice with the rest.
        hook("--hook-start", "m", "/work/muted", { VIBE_DISABLE: "1" });
        hook("--hook-stop", "m", "/work/muted", { VIBE_DISABLE: "1" });
        assert.ok(await silent(), "nothing is said while muted");

        // i. Waiting: a built-in tool is named, an MCP tool is not, and a hostile directory steers nothing.
        hook("--hook-start", "w", "/work/waiter");
        hook("--hook-wait", "w", "/work/waiter", {}, { hook_event_name: "PermissionRequest", tool_name: "Bash" });
        assert.ok(await heard("waiter needs you: Bash."), "needs-you names a built-in tool");
        assert.ok(fs.readFileSync(chimes, "utf8").includes("chime_attention"));
        reset();
        hook("--hook-resume", "w", "/work/waiter", {}, { hook_event_name: "PostToolUse", tool_name: "Bash" });
        hook("--hook-wait", "w", "/work/waiter", {}, { hook_event_name: "PermissionRequest", tool_name: "mcp__evil__tool" });
        assert.ok(await heard("waiter needs you."), "an MCP tool's name is third-party text and is not spoken");
        assert.ok(!fs.readFileSync(said, "utf8").includes("evil"));
        hook("--hook-stop", "w", "/work/waiter");
        await new Promise((r) => setTimeout(r, 300));
        reset();
        hook("--hook-start", "h", "/work/[[volm 0]] -v evil");
        hook("--hook-stop", "h", "/work/[[volm 0]] -v evil");
        assert.ok(await heard("v evil: done."), "a hostile name is spoken as words");
        assert.ok(!fs.readFileSync(said, "utf8").includes("[[volm 0]]") && /--/.test(fs.readFileSync(said, "utf8")), "its embedded command is gone and it arrived after --");

        // j. vibe --announce speaks its own text, and --announcements off makes it inert.
        reset();
        vibe(["--announce", "deploy finished"]);
        assert.ok(await heard("deploy finished"), "--announce is spoken when speech is on");
        assert.ok(/--announce is off/.test(vibe(["--announcements", "off"]).stdout));
        const eventsBefore = () => { try { return fs.readFileSync(path.join(dir, ".vibeaudio", "events.jsonl"), "utf8").trim().split("\n").length; } catch (e) { return 0; } };
        const n = eventsBefore();
        reset();
        fs.writeFileSync(chimes, "");
        const r = vibe(["--announce", "off one"]);
        assert.strictEqual(r.status, 0, "an announce that is switched off still exits 0");
        assert.ok(await silent() && fs.readFileSync(chimes, "utf8") === "" && eventsBefore() === n, "switched off: no chime, no voice, no event");
        vibe(["--announcements", "on"]);
        fs.writeFileSync(chimes, "");
        vibe(["--announce", "back on"], { VIBE_ANNOUNCE: "off" });
        assert.ok(fs.readFileSync(chimes, "utf8") === "", "VIBE_ANNOUNCE=off wins over the saved setting");
        assert.strictEqual(vibe(["--announcements", "maybe"]).status, 1);
        assert.strictEqual(vibe(["--announcements"]).status, 1, "a trailing --announcements is an error, not a wrapped command");

        // j2. A setting flag followed by a command used to save the setting and drop the command, exit 0:
        //     `vibe --notify npm test && deploy` deployed without running the tests.
        const marker = path.join(dir, "ran.txt");
        for (const flagArgs of [["--speak"], ["--speak-always"], ["--no-speak"], ["--notify"], ["--no-notify"], ["--mute"], ["--unmute"]]) {
          const out = vibe([...flagArgs, process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')`]);
          assert.strictEqual(out.status, 1, `${flagArgs[0]} with a command must fail, not exit 0`);
          assert.ok(/was not run/.test(out.stderr), out.stderr);
          assert.ok(!fs.existsSync(marker), "and the command must not have been run either");
        }
        assert.strictEqual(vibe(["--announce", "hi", "echo", "x"]).status, 1, "--announce with a command after it is an error, not a silent drop");
        vibe(["--unmute"]);

        // j3. The doctor says when banners are on and nothing can show one.
        const banner = vibe(["--doctor"], { VIBE_NOTIFY: "1", PATH: dir }).stdout.replace(/\x1b\[[0-9;]*m/g, "");
        if (process.platform === "darwin") assert.ok(/Desktop banners\s+on, through osascript/.test(banner), banner);
        else assert.ok(/Desktop banners\s+on, but notify-send was not found/.test(banner), banner);
        assert.ok(!/Desktop banners/.test(vibe(["--doctor"], { VIBE_NOTIFY: "", PATH: dir }).stdout), "and says nothing while banners are off");

        // k. --no-speak turns it off; the doctor says when there is no voice to use.
        vibe(["--no-speak"]);
        reset();
        hook("--hook-start", "x", "/work/x");
        hook("--hook-stop", "x", "/work/x");
        assert.ok(await silent(), "--no-speak");
        vibe(["--speak"]);
        fs.rmSync(path.join(dir, voice));
        assert.ok(/no voice was found/.test(vibe(["--doctor"], { PATH: dir }).stdout.replace(/\x1b\[[0-9;]*m/g, "")), "--doctor warns when there is nothing to speak with");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }

      // l. The menu: "Alerts & extras" is the last launcher entry, flips and saves, and starts nothing.
      const { promptInteractive } = require("../../src/interactive");
      const { loadConfig, saveConfig, muteState, setMuted } = require("../../src/player");
      const binDir = sandboxPathWith(["grok"]);
      const realPath = process.env.PATH;
      const realStdin = Object.getOwnPropertyDescriptor(process, "stdin");
      const realWrite = process.stdout.write.bind(process.stdout);
      const realLog = console.log;
      const realSpeak = process.env.VIBE_SPEAK;
      delete process.env.VIBE_SPEAK;
      process.env.PATH = binDir;
      process.stdout.write = () => true;
      console.log = () => {};
      // One list of keys per menu that opens: the launcher list needs arrows to reach its last entry.
      const driveMenus = (menus) => {
        const queue = menus.map((m) => [...m]);
        const fake = new (require("events").EventEmitter)();
        Object.assign(fake, { isTTY: true, setRawMode() {}, resume() {}, pause() {}, setEncoding() {} });
        const realOn = fake.on.bind(fake);
        fake.on = (event, fn) => {
          const out = realOn(event, fn);
          if (event === "data" && queue.length) {
            const keys = queue.shift();
            setImmediate(() => keys.forEach((k) => fake.emit("data", k)));
          }
          return out;
        };
        Object.defineProperty(process, "stdin", { value: fake, configurable: true });
      };
      const before = loadConfig();
      try {
        // launcher: Up wraps to the last entry; settings: banners, speak, announce, music, mute, done.
        driveMenus([["\u001b[A", "\r"], ["1"], ["2"], ["3"], ["4"], ["5"], ["6"]]);
        const picked = await promptInteractive({});
        assert.deepStrictEqual(picked, { settings: true }, "the settings entry returns without a command to launch");
        const saved = loadConfig();
        assert.strictEqual(saved.notify, true, "banners flipped on");
        assert.strictEqual(saved.speak, "auto", "speak went off -> auto");
        assert.strictEqual(saved.announce, false, "announce flipped off");
        assert.strictEqual(saved.music, false, "music flipped off");
        assert.notStrictEqual(muteState(), null, "the mute was set");
      } finally {
        process.stdout.write = realWrite;
        console.log = realLog;
        process.env.PATH = realPath;
        if (realSpeak !== undefined) process.env.VIBE_SPEAK = realSpeak;
        Object.defineProperty(process, "stdin", realStdin);
        fs.rmSync(binDir, { recursive: true, force: true });
        setMuted(false);
        saveConfig({ notify: before.notify ?? null, speak: before.speak ?? null, announce: before.announce ?? null, music: before.music ?? null });
      }
      console.log("   ✓ Flag, auto/always, repeat window, mute, tool names, hostile names, --announce, --announcements and the menu all hold.");
    }
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
