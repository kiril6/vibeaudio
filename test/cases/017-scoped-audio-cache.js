const { assert, CACHE_DIR, REAL_CACHE_ROOT, os, TEST_DIR } = require("../helpers");

(async () => {
// 17. Cache Is Scoped To The Audio It Holds
// Regression: an unversioned cache meant synth changes never reached upgraders.
// Keying on the version alone did not fix that - it just moved the failure to
// "someone must remember to bump it", which went 0 for 40. The key now carries
// a hash of the generators as well; test 34d covers that half.
console.log("17. Testing Scoped Audio Cache...");
assert.ok(
  new RegExp(`v${require("../../package.json").version.replace(/\./g, "\\.")}-[0-9a-f]{8}$`).test(CACHE_DIR),
  `cache dir must be keyed by version and synth hash, got ${CACHE_DIR}`
);
console.log(`   ✓ Cache is scoped to ${require("path").basename(CACHE_DIR)}.`);

// 17b. The suite's cache is its own (#38), children included, and clearing a
// cache root that holds something else deletes only our own entries.
{
  const fs = require("fs");
  const path = require("path");
  const { spawnSync } = require("child_process");
  assert.ok(CACHE_DIR.startsWith(process.env.VIBE_CACHE_DIR + path.sep), `the suite must not render into ${REAL_CACHE_ROOT}, got ${CACHE_DIR}`);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-clear-"));
  try {
    fs.mkdirSync(path.join(root, "v0.0.1-deadbeef", "s1"), { recursive: true });
    fs.writeFileSync(path.join(root, "loop_old.wav"), "");
    fs.writeFileSync(path.join(root, "notes.txt"), "not ours");
    const run = spawnSync(process.execPath, [path.join(TEST_DIR, "..", "bin", "vibeaudio.js"), "--clear-cache"], {
      env: { ...process.env, VIBE_CACHE_DIR: root, HOME: root, USERPROFILE: root }, encoding: "utf8", timeout: 10000
    });
    assert.strictEqual(run.status, 0, run.stderr);
    assert.ok(run.stdout.includes(root), "a child resolves the cache from VIBE_CACHE_DIR");
    assert.deepStrictEqual(fs.readdirSync(root), ["notes.txt"], "--clear-cache removes our entries and nothing else");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("   ✓ The suite renders into its own cache, and --clear-cache deletes only what it wrote.");
}


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
