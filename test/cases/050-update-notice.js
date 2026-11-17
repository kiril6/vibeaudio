const { assert, fs, path, os, TEST_DIR } = require("../helpers");

(async () => {
  // 50. The update notice. Offline by construction: it reads what the last
  // check saved and only *starts* a check, so a stubbed refresh stands in for
  // the network. It must never nag in CI, from npx, or about an older version.
  {
    console.log("\n\x1b[1m[50] Update notice\x1b[0m");
    const { updateNotice, isNewer } = require("../../src/update");

    assert.ok(isNewer("0.7.0", "0.6.3") && isNewer("1.0.0", "0.9.9") && isNewer("0.6.10", "0.6.9"));
    assert.ok(!isNewer("0.6.3", "0.6.3") && !isNewer("0.6.2", "0.6.3"), "an equal or older version is not an update");
    assert.ok(!isNewer("0.8.0-beta.1", "0.7.0") && !isNewer(undefined, "0.7.0"), "prereleases and garbage are ignored");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-update-"));
    const file = path.join(dir, "update.json");
    const now = Date.now();
    let refreshed = 0;
    const opts = { file, env: {}, now, current: "0.6.3", refresh: () => { refreshed++; } };

    assert.strictEqual(updateNotice(opts), null, "no check on record yet: nothing to say");
    assert.strictEqual(refreshed, 1, "a missing record starts a check");

    fs.writeFileSync(file, JSON.stringify({ checked: now, latest: "0.7.0" }));
    const line = updateNotice(opts);
    assert.ok(line && line.includes("0.6.3 → 0.7.0") && line.includes("npm i -g vibeaudio"), `unexpected notice: ${line}`);
    assert.strictEqual(refreshed, 1, "a check from today is not repeated");

    assert.strictEqual(updateNotice({ ...opts, current: "0.7.0" }), null, "up to date: silent");
    assert.strictEqual(updateNotice({ ...opts, ephemeral: true }), null, "npx already runs the latest");
    for (const key of ["CI", "NO_UPDATE_NOTIFIER", "VIBE_NO_UPDATE_CHECK"]) {
      assert.strictEqual(updateNotice({ ...opts, env: { [key]: "1" } }), null, `${key} must silence it`);
    }

    fs.writeFileSync(file, JSON.stringify({ checked: now - 25 * 3600 * 1000, latest: "0.7.0" }));
    assert.ok(updateNotice(opts), "a stale record still answers from what it knows");
    assert.strictEqual(refreshed, 2, "…and starts the next check");

    fs.rmSync(dir, { recursive: true, force: true });
    console.log("   ✓ Reads the saved answer, rechecks once a day, silent when current, disabled, in CI or under npx.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
