const { fs, path, os, spawn, assert, TEST_DIR } = require("../helpers");

(async () => {
  // -------------------------------------------------------------------------
  {
    console.log("\n\x1b[1m[53] A prune must never take the directory out from under a render\x1b[0m");

    // The crash this covers is cross-process: A prunes a seed directory
    // between B's mkdir and B's write, and B throws ENOENT on the playback
    // path. Both halves of the fix are checked - the mtime floor that makes
    // it rare, and the retry that survives it happening anyway.
    const raceHome = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-prune-"));
    const probe = `
      const fs = require("fs");
      const path = require("path");
      const player = require(process.argv[1]);

      fs.mkdirSync(player.CACHE_DIR, { recursive: true });
      const made = [];
      for (let i = 0; i < 6; i++) {
        const d = path.join(player.CACHE_DIR, "s" + (100 + i));
        fs.mkdirSync(d, { recursive: true });
        fs.writeFileSync(path.join(d, "loop.wav"), "x");
        made.push(d);
      }
      // Age three of them past the floor; the other three are "in flight".
      const old = Date.now() - 60_000;
      for (const d of made.slice(0, 3)) fs.utimesSync(d, old / 1000, old / 1000);

      player.pruneSeedDirs();
      const survived = made.filter((d) => fs.existsSync(d));

      // Now the race itself: write into a directory that has just been removed.
      const gone = path.join(player.CACHE_DIR, "s999", "loop.wav");
      fs.mkdirSync(path.dirname(gone), { recursive: true });
      fs.rmSync(path.dirname(gone), { recursive: true, force: true });
      let threw = null;
      try {
        player.writeCacheFileAtomic(gone, Buffer.from("hello"));
      } catch (e) {
        threw = e.code || e.message;
      }

      console.log(JSON.stringify({
        survived: survived.length,
        freshKept: made.slice(3).every((d) => fs.existsSync(d)),
        threw,
        wrote: fs.existsSync(gone) && fs.readFileSync(gone, "utf8"),
        strays: fs.readdirSync(path.dirname(gone)).filter((f) => f.endsWith(".tmp")).length
      }));
    `;
    const raceOut = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        ["-e", probe, path.join(TEST_DIR, "..", "src", "player.js")],
        { env: { ...process.env, HOME: raceHome, USERPROFILE: raceHome }, stdio: ["ignore", "pipe", "inherit"] }
      );
      let out = "";
      child.stdout.on("data", (c) => (out += c));
      child.on("close", () => resolve(JSON.parse(out)));
    });
    fs.rmSync(raceHome, { recursive: true, force: true });

    assert.ok(raceOut.freshKept, "a directory touched moments ago may be mid-render - prune must skip it");
    assert.strictEqual(raceOut.survived, 3, "the aged directories past the keep count are still pruned");
    assert.strictEqual(raceOut.threw, null, "a vanished seed directory must not throw on the playback path");
    assert.strictEqual(raceOut.wrote, "hello", "…the write must land, not be silently dropped");
    assert.strictEqual(raceOut.strays, 0, "and it must leave no .tmp behind");

    console.log("   ✓ Prune leaves in-flight directories alone, and a write into a pruned one recovers instead of throwing.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
