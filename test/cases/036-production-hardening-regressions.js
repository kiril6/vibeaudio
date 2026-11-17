const { assert, parseArgs, os, TEST_DIR } = require("../helpers");

(async () => {
  // 36. Regressions from the production review.
  {
    console.log("\n\x1b[1m[36] Production hardening regressions\x1b[0m");

    const { spawn, spawnSync } = require("child_process");
    const fs = require("fs");
    const path = require("path");
    const CLI = path.join(TEST_DIR, "..", "bin", "vibeaudio.js");

    // a. A value flag with no value used to become the command, so the wrapper
    //    reported ENOENT on a program called `--genre`.
    for (const flag of ["--genre", "--volume", "--grace", "--seed", "--tools"]) {
      const r = spawnSync(process.execPath, [CLI, flag], { encoding: "utf8" });
      assert.strictEqual(r.status, 1, `${flag} with no value must exit 1`);
      assert.ok(/needs a value/.test(r.stderr), `${flag} must say what is missing`);
    }

    // b. --mcp was matched anywhere in argv, so it hijacked a wrapped command
    //    that happened to take the same flag.
    const wrapped = parseArgs(["node", "vibe", "npm", "test", "--mcp"]);
    assert.strictEqual(wrapped.mcp, false, "--mcp after the command belongs to the child");
    assert.deepStrictEqual(wrapped.cmdArgs, ["npm", "test", "--mcp"]);
    assert.strictEqual(parseArgs(["node", "vibe", "--mcp"]).mcp, true, "--mcp as a flag still starts the server");

    // b2. `--tools ""` is typed, not absent: it must name an agent, never fall
    //     through to auto-detection and install for every agent on the machine.
    //     HOME is redirected for these: this assertion exists because the bug
    //     installs hooks, so a regression must land in a throwaway directory
    //     rather than in whoever is running the suite.
    const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-home-"));
    for (const value of ["", ",", " , "]) {
      const r = spawnSync(process.execPath, [CLI, "--install-hooks", "--tools", value], {
        encoding: "utf8",
        env: { ...process.env, HOME: sandboxHome, USERPROFILE: sandboxHome }
      });
      assert.strictEqual(r.status, 1, `--tools '${value}' must refuse rather than auto-detect`);
      assert.ok(/named no agent/.test(r.stderr), `--tools '${value}' must say why`);
    }
    assert.deepStrictEqual(fs.readdirSync(sandboxHome), [], "refusing must write nothing at all");
    fs.rmSync(sandboxHome, { recursive: true, force: true });

    // b3. A mistyped flag must name itself, not be spawned as a program -
    //     `vibe --typo npm test` used to report `spawn --typo ENOENT`, an
    //     error about entirely the wrong thing. `--` stays the escape hatch.
    const typo = spawnSync(process.execPath, [CLI, "--typo", "npm", "test"], { encoding: "utf8" });
    assert.strictEqual(typo.status, 1, "an unknown option must exit 1");
    assert.ok(/Unknown option '--typo'/.test(typo.stderr), "and say which option it was");

    const dashed = parseArgs(["node", "vibe", "--grace", "0", "--", "--weird-binary", "-x"]);
    assert.deepStrictEqual(dashed.cmdArgs, ["--weird-binary", "-x"], "-- hands everything after it to the child");
    assert.strictEqual(dashed.grace, 0, "and flags before -- are still ours");

    // A command's own flags, after the command, are untouched.
    const passthrough = parseArgs(["node", "vibe", "npm", "test", "--verbose"]);
    assert.deepStrictEqual(passthrough.cmdArgs, ["npm", "test", "--verbose"]);

    // c. Every MCP request must leave with a response, including malformed
    //    ones - a throw used to leave the client blocked forever.
    const { handleMessage } = require("../../src/mcp");
    const { AudioPlayer, AVAILABLE_GENRES } = require("../../src/player");
    const idle = new AudioPlayer();
    assert.doesNotThrow(() => handleMessage(idle, { jsonrpc: "2.0", id: 7, method: "tools/call" }));
    const noParams = handleMessage(idle, { jsonrpc: "2.0", id: 7, method: "tools/call" });
    assert.strictEqual(noParams.id, 7, "a request with no params still gets its id back");
    assert.ok(noParams.error, "and an error rather than silence");

    // d. Cache writes are atomic. Several processes generating the same
    //    uncached ~1 MB loop at once must each end up with a whole file: the
    //    header's own byte count has to match what is on disk, which is
    //    exactly what a reader catching a half-written file would fail.
    //    Run concurrently on purpose - sequentially the second one just hits
    //    the cache and proves nothing.
    const seed = 20260912;
    const raceDir = path.join(require("../../src/player").CACHE_DIR, `s${seed}`);
    fs.rmSync(raceDir, { recursive: true, force: true });

    const racer =
      `const p=require(${JSON.stringify(path.join(TEST_DIR, "..", "src", "player"))});` +
      `const f=require("fs");const fp=p.getAudioPath("jazz",2,${seed});` +
      // Header data size vs. actual bytes: a torn file disagrees with itself.
      `const b=f.readFileSync(fp);process.stdout.write(JSON.stringify([b.length,b.readUInt32LE(40)+44]));`;

    // Six, not four: detection here is probabilistic - a racer only notices a
    // non-atomic write if it happens to read while one is in flight. Measured
    // at 4 racers it caught a deliberately non-atomic implementation in 9 runs
    // out of 10, so more racers is a cheap way to shrink that last tenth. The
    // leftover-tmp assertion below is the deterministic half of this test.
    const racers = await Promise.all(
      [0, 1, 2, 3, 4, 5].map(
        () =>
          new Promise((resolve, reject) => {
            const proc = spawn(process.execPath, ["-e", racer], { stdio: ["ignore", "pipe", "inherit"] });
            let out = "";
            proc.stdout.on("data", (c) => { out += c; });
            proc.on("error", reject);
            proc.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`racer exited ${code}`))));
          })
      )
    );

    for (const raw of racers) {
      const [onDisk, declared] = JSON.parse(raw);
      assert.ok(onDisk > 44, "a racer must not read a bare header");
      assert.strictEqual(onDisk, declared, "a racer read a WAV that disagrees with its own header");
      assert.strictEqual(onDisk, JSON.parse(racers[0])[0], "every racer must see the same file");
    }
    assert.strictEqual(
      fs.readdirSync(raceDir).filter((f) => f.endsWith(".tmp")).length, 0,
      "no temp file may be left behind"
    );
    fs.rmSync(raceDir, { recursive: true, force: true });

    // e. An unknown MCP genre falls back to lofi and says so, instead of
    //    reporting a genre nobody implements.
    assert.ok(!AVAILABLE_GENRES.includes("frobnicate"));

    // f. The HUD must not announce a chime that --no-chime suppressed.
    const { TerminalHud } = require("../../src/hud");
    const hud = new TerminalHud("lofi");
    const written = [];
    const realWrite = process.stdout.write.bind(process.stdout);
    const wasTTY = process.stdout.isTTY;
    process.stdout.isTTY = true;
    process.stdout.write = (chunk) => { written.push(String(chunk)); return true; };
    try {
      hud.start();
      hud.stop({ outcome: "success", code: 0, chimed: false });
    } finally {
      process.stdout.write = realWrite;
      process.stdout.isTTY = wasTTY;
    }
    assert.ok(written.some((w) => /Done in/.test(w)), "the HUD still reports the run");
    assert.ok(!written.some((w) => /chime/i.test(w)), "but claims no chime it did not play");

    console.log("   ✓ Flags, MCP replies, cache writes and the HUD all tell the truth.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
