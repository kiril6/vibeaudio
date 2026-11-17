const { os, assert, TEST_DIR } = require("../helpers");

(async () => {
  // 40. Valid JSON in the wrong shape must name the key, not blame filter().
  {
    console.log("\n\x1b[1m[40] Malformed hook files fail legibly\x1b[0m");
    const fs = require("fs");
    const path = require("path");
    const hooks = require("../../src/hooks");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-shape-"));
    const cases = [
      [{ hooks: { Stop: { type: "command" } } }, /hooks\.Stop as object, not an array/],
      [{ hooks: [] }, /"hooks" key that is not an object/],
      [[1, 2], /does not contain a JSON object/]
    ];

    for (const [body, expected] of cases) {
      const file = path.join(dir, `${Math.random().toString(36).slice(2)}.json`);
      fs.writeFileSync(file, JSON.stringify(body));
      const before = fs.readFileSync(file, "utf8");
      // Both directions: neither may throw a TypeError from deep inside, and
      // neither may touch a file it could not understand.
      assert.throws(() => hooks.installHooks("lofi", 0.4, file, { id: "claude" }), expected);
      assert.throws(() => hooks.uninstallHooks(file, { id: "claude" }), expected);
      assert.strictEqual(fs.readFileSync(file, "utf8"), before, "a file we refuse must be left alone");
    }

    fs.rmSync(dir, { recursive: true, force: true });
    console.log("   ✓ The error names the offending key, and the file is left untouched.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
