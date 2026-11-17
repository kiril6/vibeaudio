const assert = require("assert");
// An agent's config dir can be moved by env var, and every child below inherits
// process.env. Left set, a test that redirects only HOME would install into
// the developer's real config. Tests that exercise them set them explicitly.
delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.CODEX_HOME;
delete process.env.COPILOT_HOME;
delete process.env.GEMINI_CLI_HOME;
delete process.env.QWEN_HOME;
delete process.env.GROK_HOME;
const os = require("os");
// Run against an empty home: player.js and hooks.js resolve ~/.vibeaudio from
// os.homedir() at require time, so a developer's own mute, config or daemon
// would otherwise change what the suite asserts (an active mute failed test
// 31). Set before anything under src/ loads; every child inherits it.
{
  const fakeHome = require("fs").mkdtempSync(require("path").join(os.tmpdir(), "vibe-home-"));
  process.env.HOME = process.env.USERPROFILE = fakeHome;
  process.on("exit", () => require("fs").rmSync(fakeHome, { recursive: true, force: true }));
}
// The suite's own audio cache, set before anything requires player.js and
// inherited by every child. In the real one, live hooks running from this
// checkout prune seed directories mid-run, and the suite evicts real
// projects' audio (#38).
const REAL_CACHE_ROOT = require("path").join(os.homedir(), ".vibeaudio", "cache");
process.env.VIBE_CACHE_DIR = require("fs").mkdtempSync(require("path").join(os.tmpdir(), "vibe-cache-"));
process.on("exit", () => require("fs").rmSync(process.env.VIBE_CACHE_DIR, { recursive: true, force: true }));

module.exports = { assert, os, REAL_CACHE_ROOT };
