const { assert, TEST_DIR } = require("../helpers");

(async () => {
  // 44. The Windows branch of the atomic write, proven on any platform.
  //
  //     Windows rename fails with EPERM when another process holds the
  //     destination open - the exact case the atomic write exists to handle -
  //     so a losing racer must treat "the destination is there" as success
  //     rather than throwing. That branch shipped broken and CI caught it on
  //     one cell out of nine: windows/node20 failed while windows/node18 and
  //     22 passed the same commit on timing luck. A platform-specific path
  //     that only a third of its own CI cells exercise needs a deterministic
  //     test, not a probabilistic one.
  //
  //     renameSync is stubbed to do what Windows does under the race: the
  //     winner's file appears, and our rename fails.
  {
    console.log("\n\x1b[1m[44] A losing racer uses the winner's file\x1b[0m");
    const fs = require("fs");
    const path = require("path");
    const player = require("../../src/player");

    const seed = 44004400;
    const dir = path.join(player.CACHE_DIR, `s${seed}`);
    fs.rmSync(dir, { recursive: true, force: true });

    const realRename = fs.renameSync;
    const winner = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(64, 7)]);
    let sawRename = false;

    let produced;
    try {
      fs.renameSync = (from, to) => {
        sawRename = true;
        fs.writeFileSync(to, winner);          // the winner lands first...
        const err = new Error("EPERM: operation not permitted, rename");
        err.code = "EPERM";
        throw err;                              // ...and Windows refuses ours
      };
      produced = player.getAudioPath("jazz", 2, seed);
    } finally {
      fs.renameSync = realRename;
    }

    assert.ok(sawRename, "the stub must actually have been exercised");
    assert.ok(
      fs.readFileSync(produced).equals(winner),
      "the losing racer must hand back the winner's file, not throw"
    );
    assert.strictEqual(
      fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")).length, 0,
      "and must still clean up its own temp file"
    );

    // The other direction: a rename failure with nothing at the destination is
    // a real error and must not be swallowed.
    fs.rmSync(dir, { recursive: true, force: true });
    try {
      fs.renameSync = () => {
        const err = new Error("ENOSPC: no space left on device");
        err.code = "ENOSPC";
        throw err;
      };
      assert.throws(
        () => player.getAudioPath("jazz", 2, seed + 1),
        /ENOSPC/,
        "a rename failure with no file at the destination must still throw"
      );
    } finally {
      fs.renameSync = realRename;
    }

    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(path.join(player.CACHE_DIR, `s${seed + 1}`), { recursive: true, force: true });
    console.log("   ✓ EPERM with the file present is success; a real failure still throws.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
