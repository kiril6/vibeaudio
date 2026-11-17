const { os, assert, TEST_DIR } = require("../helpers");

(async () => {
  // 37. The hook backup is the user's pre-VibeAudio config, not our last install.
  {
    console.log("\n\x1b[1m[37] Reinstall must not clobber the backup\x1b[0m");
    const fs = require("fs");
    const path = require("path");
    const hooks = require("../../src/hooks");

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-backup-"));
    const file = path.join(tmp, "settings.json");
    const original = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "someone-elses-hook" }] }] } }, null, 2);
    fs.writeFileSync(file, original);

    hooks.installHooks("jazz", 0.4, file, { id: "claude" });
    hooks.installHooks("zen", 0.25, file, { id: "claude" });

    const backup = JSON.parse(fs.readFileSync(`${file}.vibeaudio.bak`, "utf8"));
    const commands = Object.values(backup.hooks).flat().flatMap((e) => (e.hooks || []).map((h) => h.command));
    assert.deepStrictEqual(commands, ["someone-elses-hook"], "the backup must stay the pre-VibeAudio file");

    // And the live file still has the other tool's hook plus ours.
    const live = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.ok(JSON.stringify(live).includes("someone-elses-hook"), "someone else's hook survives the install");
    assert.strictEqual(hooks.uninstallHooks(file, { id: "claude" }).removed, 9, "uninstall removes only ours");
    assert.ok(JSON.stringify(JSON.parse(fs.readFileSync(file, "utf8"))).includes("someone-elses-hook"));

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log("   ✓ The backup keeps naming the config it claims to be.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
