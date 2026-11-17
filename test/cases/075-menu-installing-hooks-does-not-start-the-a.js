const { fs, path, os, assert, TEST_DIR } = require("../helpers");

(async () => {
  // [75] The menu's hook install is setup, not launch.
  console.log("\n\x1b[1m[75] Menu: installing hooks does not start the agent\x1b[0m");
  {
    const { applyMenuSelection } = require("../../src/cli");
    const hooks = require("../../src/hooks");
    const logs = [];
    const realLog = console.log;
    const realErr = console.error;
    const realExit = process.exit;
    console.log = (...a) => logs.push(a.join(" "));
    console.error = (...a) => logs.push(a.join(" "));
    try {
      const pick = { cmd: ["grok"], genre: "zen", volume: 0.3, installHooks: true, hookTarget: "grok", reactive: false };
      assert.strictEqual(applyMenuSelection(pick, 0.3), false, "installing hooks must not launch the tool");
      assert.ok(fs.existsSync(hooks.TARGETS.grok.file()), "but the hooks are written");
      assert.ok(logs.some((l) => /hooked into: Grok/.test(l) && /Nothing was started/.test(l) && /grok/.test(l)), "and it says so");
      assert.ok(logs.some((l) => /hooked into/.test(l) && /vibe --help/.test(l)), "the closing confirmation itself points at vibe --help, not only the install report above it");
      assert.ok(logs.some((l) => /vibe --speak/.test(l) && /vibe --no-speak/.test(l) && /hooked into/.test(logs.join("\n"))), "and tells the user speech exists and how to turn it off");
      assert.ok(logs.some((l) => /vibe --status/.test(l) && /vibe --mute/.test(l) && /vibe --help/.test(l)), "and points at the commands to use next");
      assert.ok(logs.some((l) => /vibe --install-hooks/.test(l)), "and at how to set up the other agents");

      // A second agent set up later: the line names every agent hooked, not only this pick.
      logs.length = 0;
      applyMenuSelection({ ...pick, cmd: ["codex"], hookTarget: "codex" }, 0.3);
      const line = logs.find((l) => /hooked into/.test(l));
      assert.ok(/hooked into: .*Codex.*/.test(line) && /Grok/.test(line), "the line lists every agent that is hooked");
      assert.ok(/any of them/.test(line) && /grok/.test(line) && /codex/.test(line), "and every command to open");
      fs.rmSync(path.join(os.homedir(), ".codex"), { recursive: true, force: true });

      assert.strictEqual(applyMenuSelection({ cmd: ["grok"], installHooks: false, reactive: false }, 0.3), true, "just launching, or this session only, still starts it");

      // --help says how to leave, in the order that strands no hook.
      const help = require("child_process").spawnSync(process.execPath, [path.join(TEST_DIR, "..", "bin", "vibeaudio.js"), "--help"], { encoding: "utf8" }).stdout;
      assert.ok(/UNINSTALL/.test(help) && help.indexOf("vibe --uninstall-hooks", help.indexOf("UNINSTALL")) < help.indexOf("npm rm -g vibeaudio"), "help lists the uninstall steps, hooks first");
      assert.ok(/VIBE_NOTIFY/.test(help) && /NO SOUND\?/.test(help) && /--doctor/.test(help) && /\/issues/.test(help) && /npm i -g vibeaudio/.test(help), "help covers update, notify, troubleshooting and where to ask");
      assert.ok(/INTEGRATIONS/.test(help) && /vibe --events/.test(help) && /announced/.test(help), "help points at the events stream and names its events");
      assert.ok(/vibe --speak\s+#/.test(help.replace(/\x1b\[[0-9;]*m/g, "")) && /Alerts & extras/.test(help) && /spoken too when --speak is on/.test(help), "help shows how to turn speech on, where the menu toggles are, and that --announce is spoken");
      assert.ok(/--notify\s+#/.test(help.replace(/\x1b\[[0-9;]*m/g, "")) && /looks stuck \(macOS and Linux; off by default\)/.test(help), "help says what a banner is for and where it works");

      // A failed install is an error, not a launch without the hooks that were asked for.
      const gemini = hooks.TARGETS.gemini.file();
      fs.mkdirSync(path.dirname(gemini), { recursive: true });
      fs.writeFileSync(gemini, "{ not json");
      process.exit = (code) => { throw new Error(`exit ${code}`); };
      assert.throws(() => applyMenuSelection({ ...pick, cmd: ["gemini"], hookTarget: "gemini" }, 0.3), /exit 1/, "a failed install exits 1 instead of launching");
    } finally {
      console.log = realLog;
      console.error = realErr;
      process.exit = realExit;
      fs.rmSync(path.join(os.homedir(), ".grok"), { recursive: true, force: true });
      fs.rmSync(path.join(os.homedir(), ".gemini"), { recursive: true, force: true });
    }
    console.log("   ✓ Hooks are installed and the tool is left unstarted; only launch choices start it; a failed install exits 1.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
