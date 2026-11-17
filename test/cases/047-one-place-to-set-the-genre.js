const { fs, path, os, CLI, assert, TEST_DIR } = require("../helpers");

(async () => {
  // 47. Saved settings are the single source of truth
  {
    console.log("\n\x1b[1m[47] One place to set the genre\x1b[0m");
    const { spawnSync } = require("child_process");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-config-"));
    try {
      const home = path.join(dir, "home");
      fs.mkdirSync(home);
      const configFile = path.join(home, ".vibeaudio", "config.json");
      // A child process, never process.env.HOME in this suite: player.js
      // resolves CONFIG_FILE from os.homedir() at require time, so an
      // in-process override would write to whoever is running the tests.
      const vibe = (args) => spawnSync(process.execPath, [CLI, ...args],
        { env: { ...process.env, HOME: home, USERPROFILE: home, VIBE_GENRE: "", VIBE_VOLUME: "" }, encoding: "utf8", timeout: 20000 });

      // Settings with no command to run are a request to change the default,
      // not to open the launcher - which is what used to happen.
      const saved = vibe(["--genre", "jazz", "--volume", "25"]);
      assert.strictEqual(saved.status, 0, `saving defaults failed: ${saved.stderr}`);
      assert.ok(/Saved: genre jazz, volume 25%/.test(saved.stdout), "a bare setting flag must save and say so");
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(configFile, "utf8")), { genre: "jazz", volume: 25 });

      // Read back by the next process - this is what reaches an installed hook.
      const status = vibe(["--status"]);
      assert.ok(/genre\s+\x1b\[32mjazz/.test(status.stdout), "--status must report the saved genre");
      assert.ok(/volume\s+\x1b\[32m25%/.test(status.stdout), "--status must report the saved volume");

      // An export still wins: the file sits below the environment, as the
      // wrapper's users have always had it.
      const overridden = spawnSync(process.execPath, [CLI, "--status"],
        { env: { ...process.env, HOME: home, USERPROFILE: home, VIBE_GENRE: "zen" }, encoding: "utf8", timeout: 20000 });
      assert.ok(/genre\s+\x1b\[32mzen/.test(overridden.stdout), "VIBE_GENRE must beat the saved file");

      // Installing writes the settings it just reported, and pins nothing.
      const installed = vibe(["--genre", "piano", "--volume", "35", "--install-hooks", "--tools", "claude"]);
      assert.strictEqual(installed.status, 0, `install failed: ${installed.stderr}`);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(configFile, "utf8")).genre, "piano");
      const settings = JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));
      for (const entries of Object.values(settings.hooks)) {
        for (const entry of entries) {
          for (const h of entry.hooks) {
            assert.ok(!/--genre|--volume/.test(h.command), `a hook must not pin settings: ${h.command}`);
          }
        }
      }

      // The whole point: changing it afterwards edits nothing in the agent's
      // config, and the installed hooks still pick it up.
      const before = fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8");
      vibe(["--genre", "drone"]);
      assert.strictEqual(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"), before,
        "a genre change must not touch the agent's settings file");
      assert.strictEqual(JSON.parse(fs.readFileSync(configFile, "utf8")).genre, "drone");

      // A typo must not overwrite the default the user already had - the run
      // path still falls back to lofi, but a save refuses and changes nothing.
      const typo = vibe(["--genre", "nonsens"]);
      assert.strictEqual(typo.status, 1, "an unknown genre with nothing to run must fail");
      assert.ok(/nothing saved/.test(typo.stderr), "and must say it saved nothing");
      assert.strictEqual(JSON.parse(fs.readFileSync(configFile, "utf8")).genre, "drone", "the saved genre must survive a typo");
      const typoRun = vibe(["--genre", "nonsens", process.execPath, "-e", "0"]);
      assert.strictEqual(typoRun.status, 0, "a typo must not take down a wrapped command");
      assert.ok(/falling back to lofi/.test(typoRun.stderr), "the run path still falls back");

      // --here saves for one directory and, crucially, for the subdirectories an
      // agent is actually launched from - an exact-match lookup would make the
      // setting vanish one `cd` deeper.
      const proj = path.join(dir, "repo");
      const deep = path.join(proj, "src", "inner");
      fs.mkdirSync(deep, { recursive: true });
      const inDir = (cwd, args) => spawnSync(process.execPath, [CLI, ...args],
        { cwd, env: { ...process.env, HOME: home, USERPROFILE: home, VIBE_GENRE: "", VIBE_VOLUME: "" }, encoding: "utf8", timeout: 20000 });

      assert.strictEqual(inDir(proj, ["--genre", "zen", "--here"]).status, 0);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(configFile, "utf8")).projects[fs.realpathSync(proj)], { genre: "zen" });
      assert.strictEqual(JSON.parse(fs.readFileSync(configFile, "utf8")).genre, "drone", "--here must leave the global default alone");
      assert.ok(/genre\s+\x1b\[32mzen/.test(inDir(deep, ["--status"]).stdout), "a subdirectory must inherit its project's genre");
      assert.ok(/genre\s+\x1b\[32mdrone/.test(vibe(["--status"]).stdout), "elsewhere still gets the global default");

      // Migrating off an older install must not change what is playing. Those
      // entries pin the settings the user has actually been hearing, while the
      // config file may hold nothing but a default they never chose - so an
      // untyped reinstall inherits from the entries it replaces. Reported live
      // as "installed lofi @ 40%" over somebody's synthwave, which is the one
      // moment a migration must not be silent.
      const claudeSettings = path.join(home, ".claude", "settings.json");
      const pinned = JSON.parse(fs.readFileSync(claudeSettings, "utf8"));
      for (const entries of Object.values(pinned.hooks)) {
        for (const entry of entries) {
          for (const h of entry.hooks) {
            if (/--hook-start|--hook-resume/.test(h.command)) h.command += " --genre synthwave --volume 25";
          }
        }
      }
      fs.writeFileSync(claudeSettings, JSON.stringify(pinned, null, 2));
      // The migration case is a user who never saved anything: the pin is the
      // only record of what they have been hearing.
      fs.rmSync(configFile, { force: true });

      const migrated = vibe(["--install-hooks", "--tools", "claude"]);
      assert.strictEqual(migrated.status, 0, `migration install failed: ${migrated.stderr}`);
      assert.ok(/Keeping your current genre synthwave and volume 25%/.test(migrated.stdout), "a migration must say what it kept");
      assert.strictEqual(JSON.parse(fs.readFileSync(configFile, "utf8")).genre, "synthwave", "the pinned genre must survive the migration");
      assert.strictEqual(JSON.parse(fs.readFileSync(configFile, "utf8")).volume, 25, "and the pinned volume with it");

      // Naming one still means naming it, and a saved setting is not a gap:
      // once synthwave is on record, the same pin must stop being consulted.
      fs.writeFileSync(claudeSettings, JSON.stringify(pinned, null, 2));
      assert.strictEqual(vibe(["--genre", "piano", "--install-hooks", "--tools", "claude"]).status, 0);
      const afterTyped = JSON.parse(fs.readFileSync(configFile, "utf8"));
      assert.strictEqual(afterTyped.genre, "piano", "an explicit genre must beat the pin");
      assert.strictEqual(afterTyped.volume, 25, "and the volume saved by the migration stands");

      // The bug this guards: four legacy installs agreeing on lofi must not
      // outvote the genre the user chose a minute ago.
      vibe(["--genre", "synthwave", "--volume", "25"]);
      const wouldOverride = vibe(["--install-hooks", "--tools", "claude"]);
      assert.ok(!/Keeping your current/.test(wouldOverride.stdout), "a pin must not override a saved setting");
      assert.strictEqual(JSON.parse(fs.readFileSync(configFile, "utf8")).genre, "synthwave");

      // Two agents pinned to different genres have no single answer, and the
      // saved config is one value for the machine: inheriting whichever was
      // found first would let an untouched install for some other tool
      // overwrite the genre the user actually chose.
      const codexHooks = path.join(home, ".codex", "hooks.json");
      fs.mkdirSync(path.dirname(codexHooks), { recursive: true });
      fs.writeFileSync(codexHooks, JSON.stringify({
        hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "node vibeaudio.js --hook-start --genre 8bit --volume 90" }] }] }
      }, null, 2));
      fs.writeFileSync(claudeSettings, JSON.stringify(pinned, null, 2));
      vibe(["--genre", "zen", "--volume", "55"]);
      const disagreeing = vibe(["--install-hooks", "--tools", "claude,codex"]);
      assert.strictEqual(disagreeing.status, 0, `install failed: ${disagreeing.stderr}`);
      assert.ok(!/Keeping your current/.test(disagreeing.stdout), "disagreeing pins must not be inherited");
      const afterDisagree = JSON.parse(fs.readFileSync(configFile, "utf8"));
      assert.strictEqual(afterDisagree.genre, "zen", "the user's own setting must survive disagreeing pins");
      assert.strictEqual(afterDisagree.volume, 55);

      // A command after the flags is still a command, not a save.
      vibe(["--genre", "drone"]);
      const wrapped = vibe(["--genre", "zen", process.execPath, "-e", "0"]);
      assert.strictEqual(wrapped.status, 0);
      assert.ok(!/Saved:/.test(wrapped.stdout), "flags before a command must not be saved");
      assert.strictEqual(JSON.parse(fs.readFileSync(configFile, "utf8")).genre, "drone", "and must not change the file");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    console.log("   ✓ One file decides the genre; --here scopes it to a project tree; flags and exports still win; installed hooks follow it without a reinstall.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
