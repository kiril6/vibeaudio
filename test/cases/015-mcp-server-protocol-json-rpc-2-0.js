const { assert, TEST_DIR } = require("../helpers");

(async () => {
// 15. Model Context Protocol (MCP) Server Protocol
console.log("15. Testing MCP Server Protocol (JSON-RPC 2.0)...");
const { handleMessage, TOOLS } = require("../../src/mcp");
const mockPlayer = {
  isPlaying: false,
  genre: "lofi",
  volume: 0.4,
  currentTier: 1,
  startTime: 0,
  start(g, v) { this.isPlaying = true; this.genre = g; this.volume = v; this.startTime = Date.now(); return true; },
  stop(opts) { const was = this.isPlaying; this.isPlaying = false; return was; }
};

// 15a. initialize
const initRes = handleMessage(mockPlayer, { id: 1, method: "initialize", params: {} });
assert.strictEqual(initRes.result.serverInfo.name, "vibeaudio");
assert.ok(initRes.result.capabilities.tools);
// Nothing fires MCP tools automatically, so the usage nudge is the only thing
// keeping the server from sitting idle. Losing it would be silent.
assert.ok(/vibe_play/.test(initRes.result.instructions || ""), "initialize must tell the model when to call vibe_play");
assert.ok(/vibe_stop/.test(initRes.result.instructions || ""), "initialize must tell the model to call vibe_stop");

// 15b. tools/list
const listRes = handleMessage(mockPlayer, { id: 2, method: "tools/list", params: {} });
assert.strictEqual(listRes.result.tools.length, 3);
assert.deepStrictEqual(listRes.result.tools.map(t => t.name), ["vibe_play", "vibe_stop", "vibe_status"]);

// 15c. tools/call -> vibe_play
const playRes = handleMessage(mockPlayer, {
  id: 3,
  method: "tools/call",
  params: { name: "vibe_play", arguments: { genre: "jazz", volume: 50 } }
});
assert.strictEqual(mockPlayer.isPlaying, true);
assert.strictEqual(mockPlayer.genre, "jazz");
assert.ok(playRes.result.content[0].text.includes("jazz"));

// 15d. tools/call -> vibe_status
const statusRes = handleMessage(mockPlayer, {
  id: 4,
  method: "tools/call",
  params: { name: "vibe_status", arguments: {} }
});
const statusData = JSON.parse(statusRes.result.content[0].text);
assert.strictEqual(statusData.isPlaying, true);
assert.strictEqual(statusData.genre, "jazz");

// 15e. tools/call -> vibe_stop
const stopRes = handleMessage(mockPlayer, {
  id: 5,
  method: "tools/call",
  params: { name: "vibe_stop", arguments: { outcome: "success" } }
});
assert.strictEqual(mockPlayer.isPlaying, false);
assert.ok(stopRes.result.content[0].text.includes("success"));
console.log("   ✓ MCP Server protocol (initialize, tools/list, vibe_play, vibe_status, vibe_stop) verified.");


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
