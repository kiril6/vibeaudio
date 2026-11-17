const { fs, path, os, assert, TEST_DIR } = require("../helpers");

(async () => {
  // --- 34d. The cache key is derived from the generators, not declared ---
  console.log("\n\x1b[1m[34d] Cache key tracks the synth sources\x1b[0m");
  {
    const { synthFingerprint, CACHE_DIR } = require("../../src/player");
    const pkgVersion = require("../../package.json").version;

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-fp-"));
    const write = (name, body) => fs.writeFileSync(path.join(dir, name), body);

    write("a.js", "const x = 1;");
    write("b.js", "const y = 2;");
    const base = synthFingerprint(dir);

    assert.strictEqual(synthFingerprint(dir), base, "the same sources must hash the same every time");
    assert.ok(/^[0-9a-f]{8}$/.test(base), `fingerprint must be 8 hex chars, got ${base}`);

    // The whole point: a changed generator must invalidate the cache without
    // anyone remembering to bump a version.
    write("a.js", "const x = 2;");
    assert.notStrictEqual(synthFingerprint(dir), base, "editing a generator must change the key");

    write("a.js", "const x = 1;");
    assert.strictEqual(synthFingerprint(dir), base, "reverting must restore the key, not just move it");

    // A new generator counts too, and a non-generator must not.
    write("c.js", "const z = 3;");
    assert.notStrictEqual(synthFingerprint(dir), base, "adding a generator must change the key");
    fs.rmSync(path.join(dir, "c.js"));
    write("notes.md", "# ignore me");
    assert.strictEqual(synthFingerprint(dir), base, "non-.js files must not affect the key");

    assert.ok(
      path.basename(CACHE_DIR).startsWith(`v${pkgVersion}-`),
      `the cache dir must carry the version and the hash, got ${path.basename(CACHE_DIR)}`
    );

    fs.rmSync(dir, { recursive: true, force: true });
    console.log("   ✓ Editing a generator invalidates the cache on its own.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
