const { assert, os, TEST_DIR } = require("../helpers");

(async () => {
  // 39. A hook command has to survive the shell that runs it.
  {
    console.log("\n\x1b[1m[39] Hook commands survive hostile paths\x1b[0m");
    const fs = require("fs");
    const path = require("path");
    const { shellQuote, installHooks, uninstallHooks } = require("../../src/hooks");

    if (process.platform === "win32") {
      assert.strictEqual(shellQuote("C:\\Program Files\\node.exe"), '"C:\\Program Files\\node.exe"');
      console.log("   ✓ Windows keeps cmd quoting (\" is not legal in a Windows path).");
    } else {
      // Double quotes let the shell rewrite the command: $ and ` expand, and a
      // " ends the quote. All three appear in legal POSIX paths.
      for (const [raw, quoted] of [
        ["/tmp/dollar$dir/x.js", "'/tmp/dollar$dir/x.js'"],
        ['/tmp/q"uote/x.js', `'/tmp/q"uote/x.js'`],
        ["/tmp/back`tick/x.js", "'/tmp/back`tick/x.js'"],
        ["/with space/x.js", "'/with space/x.js'"],
        ["/Users/O'Brien/x.js", "'/Users/O'\\''Brien/x.js'"]
      ]) {
        assert.strictEqual(shellQuote(raw), quoted, `shellQuote mangled ${raw}`);
      }

      // End to end: a real /bin/sh must run the command back and reach our CLI.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-sh-"));
      const file = path.join(dir, "settings.json");
      installHooks("lofi", 0.4, file, { id: "claude" });
      const command = JSON.parse(fs.readFileSync(file, "utf8"))
        .hooks.UserPromptSubmit[0].hooks[0].command;
      const ran = require("child_process").spawnSync("/bin/sh", ["-c", `${command} --version`], { encoding: "utf8" });
      assert.strictEqual(ran.status, 0, `a shell could not run the hook command: ${ran.stderr}`);
      assert.ok(/^\d+\.\d+\.\d+/.test(ran.stdout.trim()), "the hook command must reach our CLI");
      fs.rmSync(dir, { recursive: true, force: true });
      console.log("   ✓ $, backtick, quote and space all survive; a real shell runs the result.");
    }
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
