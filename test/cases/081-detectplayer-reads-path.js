const { fs, path, os, assert, TEST_DIR } = require("../helpers");

(async () => {
  console.log("\n\x1b[1m[81] detectPlayer reads PATH\x1b[0m");
  // [81] detectPlayer() reads PATH off the disk (#85): a PATH with a fake
  // backend and no `which` still finds it. Fails when it spawns `which`.
  if (process.platform !== "win32") {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-detect-"));
    try {
      fs.writeFileSync(path.join(dir, "paplay"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      const run = (bin) =>
        require("child_process").spawnSync(process.execPath, ["-e", `process.stdout.write(String((require(${JSON.stringify(path.join(TEST_DIR, "..", "src", "player.js"))}).detectPlayer()||{}).cmd))`], {
          env: { ...process.env, PATH: bin, VIBE_CACHE_DIR: dir },
          encoding: "utf8",
          timeout: 20000,
          killSignal: "SIGKILL"
        }).stdout;
      assert.strictEqual(run(dir), "paplay", "found with no `which` on PATH");
      assert.strictEqual(run(path.join(dir, "empty")), "undefined", "nothing on PATH means no backend");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    console.log("   ✓ detectPlayer() scans PATH itself: no `which` spawn to hang.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
