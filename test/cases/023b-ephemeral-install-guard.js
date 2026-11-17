const { path, assert, fs, TEST_DIR } = require("../helpers");

(async () => {
// 23b. Hooks must refuse to record a path npm will delete.
// Hook commands are absolute paths; one written from an npx checkout breaks
// silently on every prompt once the cache is cleared.
console.log("23b. Testing Ephemeral Install Guard...");
const { ephemeralInstallReason } = require("../../src/hooks");
const sep = path.sep;
assert.strictEqual(
  ephemeralInstallReason(`${sep}home${sep}u${sep}.npm${sep}_npx${sep}a1b2${sep}node_modules${sep}vibeaudio${sep}bin${sep}vibeaudio.js`),
  "npx",
  "an npx checkout must be rejected"
);
assert.strictEqual(
  ephemeralInstallReason(`${sep}usr${sep}local${sep}lib${sep}node_modules${sep}vibeaudio${sep}bin${sep}vibeaudio.js`),
  null,
  "a real global install must be allowed"
);
assert.strictEqual(
  ephemeralInstallReason(`${sep}Users${sep}me${sep}src${sep}vibeaudio${sep}bin${sep}vibeaudio.js`),
  null,
  "a clone must be allowed"
);

// The guard runs before any mkdir/write, so a refusal cannot touch settings.
assert.ok(
  /ephemeralInstallReason\(\);?\s*\n\s*if \(ephemeral\)/.test(
    fs.readFileSync(path.join(TEST_DIR, "..", "src", "hook-install.js"), "utf8")
  ),
  "installHooks must check the guard first, before writing anything"
);
console.log("   ✓ Temporary npx checkouts are refused before settings are written.");


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
