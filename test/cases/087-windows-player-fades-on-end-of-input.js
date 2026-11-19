const { path, assert, fs, TEST_DIR } = require("../helpers");

(async () => {
  // [87] The Windows helper (#17) plays until its pipe closes, then fades out and exits.
  console.log("\n\x1b[1m[87] The Windows player fades on end of input\x1b[0m");
  const script = fs.readFileSync(path.join(TEST_DIR, "..", "src", "win-player.ps1"), "utf8");
  assert.ok(/\^play /.test(script) && /\^volume /.test(script), "the helper speaks the macOS helper's protocol");
  assert.ok(/\[Environment\]::Exit\(0\)\s*$/.test(script), "the helper ends the process itself: a lingering media thread must not keep it alive after the pipe closes");
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
    // The fade is 0.35 s and the rest is PowerShell teardown, 2.6 s seen on a loaded
    // runner. The cutoff for "never exits" sits above the bound on how long it may
    // take: the other way round (5 s against 6 s) made anything between them read as
    // a hang, which is how 'hung' failed this on Windows CI twice.
    const { code, at } = await Promise.race([exited, new Promise((r) => setTimeout(() => r({ code: "hung" }), 20000))]);
    helper.kill();
    // Always shown, so a hang's markers can be compared with a clean run's.
    console.log("   helper stderr (tail): " + JSON.stringify(err.split(/\r?\n/).filter((l) => l.startsWith("vibe:")).slice(-4)));
    assert.strictEqual(code, 0, `closing its input must end it: ${err}`);
    assert.ok(at - closed < 10000, `fade-out then exit, took ${at - closed}ms`);
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
    console.log("   ✓ The helper plays until its pipe closes, then fades out and exits.");
  } else {
    console.log("   ✓ Protocol present (the live run is Windows-only).");
  }
})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
