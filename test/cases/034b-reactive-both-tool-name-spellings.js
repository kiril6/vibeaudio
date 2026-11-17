const { fs, path, os, assert, spawn, CLI, TEST_DIR } = require("../helpers");

(async () => {
  // --- 34b. Grok spells the tool name differently ---
  console.log("\n\x1b[1m[34b] Reactive: both tool-name spellings\x1b[0m");
  {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-grokpayload-"));
    const runTool = (payload) =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [CLI, "--hook-tool"], {
          env: { ...process.env, HOME: home, USERPROFILE: home },
          stdio: ["pipe", "ignore", "ignore"]
        });
        child.stdin.end(JSON.stringify(payload));
        child.on("close", () => resolve(fs.readFileSync(path.join(home, ".vibeaudio", "intensity"), "utf8")));
      });

    // Claude/Codex/Cursor send tool_name; Grok sends toolName. Both must land
    // on the same tier - reading one spelling would pin Grok to the fallback.
    assert.strictEqual(await runTool({ tool_name: "Bash" }), "3", "tool_name must be read");
    assert.strictEqual(await runTool({ toolName: "Bash" }), "3", "toolName (Grok) must be read");
    assert.strictEqual(await runTool({ toolName: "Read" }), "1", "Grok payloads must reach the full tier map");
    // `Task` was renamed to `Agent`; handing work to a subagent is the
    // heaviest thing in a turn and was landing on the fallback tier.
    assert.strictEqual(await runTool({ tool_name: "Agent" }), "3", "the subagent tool must be peak tier");
    assert.strictEqual(await runTool({ tool_name: "AskUserQuestion" }), "1", "waiting on the human is not work");
    // A third of real calls are MCP tools, which cannot be enumerated.
    assert.strictEqual(await runTool({ tool_name: "mcp__server__thing" }), "2", "MCP calls keep the middle tier");
    assert.strictEqual(await runTool({ nothing: true }), "2", "an unrecognised payload falls back to the middle");

    fs.rmSync(home, { recursive: true, force: true });
    console.log("   ✓ Both tool-name spellings reach the tier map.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
