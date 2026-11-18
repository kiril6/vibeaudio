const { path, assert, fs, TEST_DIR } = require("../helpers");

(async () => {
  // [87] The Windows helper (#17) plays until its pipe closes, then fades out and exits.
  console.log("\n\x1b[1m[87] The Windows player fades on end of input\x1b[0m");
  const script = fs.readFileSync(path.join(TEST_DIR, "..", "src", "win-player.ps1"), "utf8");
  assert.ok(/\^play /.test(script) && /\^volume /.test(script), "the helper speaks the macOS helper's protocol");
  if (process.platform === "win32") {
    const { spawn } = require("child_process");
    const { getAudioPath } = require("../../src/player");
    const file = getAudioPath("lofi", 1, 87, 1, 0);
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const helper = spawn("powershell", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encoded], { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
    let err = "";
    helper.stderr.on("data", (d) => (err += d));
    const exited = new Promise((resolve) => helper.on("exit", (code) => resolve({ code, at: Date.now() })));
    helper.stdin.write(`play 0 0 ${file}\n`); // Volume 0: the test makes no sound.
    await new Promise((r) => setTimeout(r, 4000)); // Cold start loads PresentationCore.
    assert.strictEqual(helper.exitCode, null, `the helper keeps running while its input is open: ${err}`);
    helper.stdin.write("volume 0 0.1\n");
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(helper.exitCode, null, `a volume change must not end the helper: ${err}`);
    const closed = Date.now();
    helper.stdin.end();
    const { code, at } = await Promise.race([exited, new Promise((r) => setTimeout(() => r({ code: "hung" }), 5000))]);
    helper.kill();
    assert.strictEqual(code, 0, `closing its input must end it: ${err}`);
    assert.ok(at - closed < 6000, `fade-out then exit, took ${at - closed}ms`);
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
    console.log("   ✓ The helper plays until its pipe closes, then fades out and exits.");
  } else {
    console.log("   ✓ Protocol present (the live run is Windows-only).");
  }
})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
