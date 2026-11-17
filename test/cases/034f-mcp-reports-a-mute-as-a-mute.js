const { fs, path, os, spawn, CLI, assert, TEST_DIR } = require("../helpers");

(async () => {
  // --- 34f. A muted MCP server must not blame the audio stack ---
  console.log("\n\x1b[1m[34f] MCP reports a mute as a mute\x1b[0m");
  {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-mcpmute-"));
    const ask = (env) =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [CLI, "--mcp"], {
          env: { ...process.env, HOME: home, USERPROFILE: home, ...env },
          stdio: ["pipe", "pipe", "ignore"]
        });
        let out = "";
        child.stdout.on("data", (c) => (out += c));
        child.on("close", () => resolve(out));
        child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
        child.stdin.write('{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"vibe_play","arguments":{"genre":"jazz","volume":5}}}\n');
        child.stdin.write('{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"vibe_status","arguments":{}}}\n');
        child.stdin.end();
      });

    const pick = (out, wanted) => {
      for (const line of out.split("\n")) {
        let msg;
        try { msg = JSON.parse(line); } catch (e) { continue; }
        if (msg.id === wanted) return msg.result.content[0].text;
      }
      return "";
    };

    const muted = await ask({ VIBE_DISABLE: "1" });
    const playText = pick(muted, 2);
    // start() returns false for three unrelated reasons and the model repeats
    // whatever we say. Blaming the audio stack sends the user debugging afplay.
    assert.ok(/muted/i.test(playText), `vibe_play must name the mute, said: ${playText}`);
    assert.ok(
      !/no supported audio player/i.test(playText),
      "a deliberate mute must never be reported as a missing audio player"
    );
    assert.strictEqual(JSON.parse(pick(muted, 3)).muted, true, "vibe_status must expose the mute");

    fs.rmSync(home, { recursive: true, force: true });
    console.log("   ✓ A muted server says so, instead of blaming the user's sound setup.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
