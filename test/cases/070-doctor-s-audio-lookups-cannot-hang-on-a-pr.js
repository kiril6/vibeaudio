const { fs, path, os, assert, TEST_DIR } = require("../helpers");

(async () => {
  // [70] A stuck audio lookup cannot hang --doctor.
  console.log("\n\x1b[1m[70] --doctor's audio lookups cannot hang on a process that ignores SIGTERM\x1b[0m");
  {
    if (process.platform !== "darwin") {
      console.log("   ✓ Skipped: the output lookup only runs on macOS.");
    } else {
      const { spawnSync } = require("child_process");
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-stuck-lookup-"));
      // exec keeps the ignored-TERM disposition, so only SIGKILL can end it.
      for (const name of ["osascript", "system_profiler"]) {
        fs.writeFileSync(path.join(dir, name), "#!/bin/sh\ntrap '' TERM\nexec sleep 40\n", { mode: 0o755 });
      }
      const started = Date.now();
      const r = spawnSync(process.execPath, ["-e", `console.log(JSON.stringify(require(${JSON.stringify(path.join(TEST_DIR, "..", "src", "output.js"))}).macOutput()))`], {
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
        encoding: "utf8",
        timeout: 30000,
        killSignal: "SIGKILL"
      });
      fs.rmSync(dir, { recursive: true, force: true });
      assert.strictEqual(r.stdout.trim(), "null", "a lookup that never answers is no finding, not a failure");
      assert.ok(Date.now() - started < 15000, `returned in ${Date.now() - started}ms, not after the stuck process gave up`);
      console.log("   ✓ A lookup that ignores SIGTERM is killed at its timeout and yields no finding.");
    }
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
