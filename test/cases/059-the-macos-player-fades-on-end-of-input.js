const { path, assert, parseArgs, fs, TEST_DIR } = require("../helpers");

(async () => {
  // [59] The macOS helper fades out on end of input instead of being killed.
  if (process.platform === "darwin") {
    console.log("\n\x1b[1m[59] The macOS player fades on end of input\x1b[0m");
    const { spawn } = require("child_process");
    const { getAudioPath } = require("../../src/player");
    const file = getAudioPath("lofi", 1, 59, 1, 0);
    const helper = spawn("osascript", ["-l", "JavaScript", path.join(TEST_DIR, "..", "src", "mac-player.jxa")], { stdio: ["pipe", "ignore", "ignore"] });
    const exited = new Promise((resolve) => helper.on("exit", (code) => resolve({ code, at: Date.now() })));
    helper.stdin.write(`play 0 0 ${file}\n`); // Volume 0: the test makes no sound.
    await new Promise((r) => setTimeout(r, 1500));
    assert.strictEqual(helper.exitCode, null, "the helper keeps running while its input is open");
    helper.stdin.write("volume 0 0.1\n"); // A live change is a command, not a restart.
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(helper.exitCode, null, "a volume change must not end the helper");
    assert.strictEqual(parseArgs(["node", "vibe", "--follow-volume"]).followVolume, true, "the hooks' internal flag parses");
    const closed = Date.now();
    helper.stdin.end();
    const { code, at } = await Promise.race([exited, new Promise((r) => setTimeout(() => r({ code: "hung" }), 3000))]);
    helper.kill("SIGKILL");
    assert.strictEqual(code, 0, "closing its input must end it");
    assert.ok(at - closed < 1500, `fade-out then exit, took ${at - closed}ms`);
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
    console.log("   ✓ The helper plays until its pipe closes, then fades out and exits - so a dead daemon cannot orphan music.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
