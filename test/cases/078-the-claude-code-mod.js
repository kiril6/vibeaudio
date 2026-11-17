const { path, fs, assert, TEST_DIR } = require("../helpers");

(async () => {
  // [78] The Claude Code mod (mods/vibe): versioned with the package, listed in
  // the marketplace, and its genre list is the player's.
  {
    console.log("\n\x1b[1m[78] The Claude Code mod\x1b[0m");
    const root = path.join(TEST_DIR, "..");
    const readJson = (f) => JSON.parse(fs.readFileSync(path.join(root, f), "utf8"));
    const pkgJson = readJson("package.json");
    const mod = readJson("mods/vibe/.claude-plugin/plugin.json");
    const market = readJson(".claude-plugin/marketplace.json");
    assert.strictEqual(mod.version, pkgJson.version, "the mod's version must track package.json, or `claude plugin update` ships nothing");
    const entry = market.plugins.find((p) => p.name === mod.name);
    assert.ok(entry, "the marketplace must list the mod");
    assert.strictEqual(entry.source, "./mods/vibe");
    assert.deepStrictEqual(readJson("mods/vibe/hooks/hooks.json").modules, ["./register.js"], "a mod is the plugin whose hooks.json names a module");
    // `npm version` and the publish check both have to know the third manifest.
    assert.ok(pkgJson.scripts.version.includes("mods/vibe/.claude-plugin/plugin.json"));
    assert.ok(fs.readFileSync(path.join(root, ".github/workflows/publish.yml"), "utf8").includes("mods/vibe/.claude-plugin/plugin.json"));
    // The mod cannot import the player, so its copy of the genre list is checked here.
    const source = fs.readFileSync(path.join(root, "mods/vibe/hooks/register.js"), "utf8");
    const listed = JSON.parse(source.match(/const GENRES = (\[.*?\])/)[1].replace(/'/g, '"'));
    assert.deepStrictEqual(listed, require("../../src/player").AVAILABLE_GENRES, "mods/vibe/hooks/register.js GENRES must equal AVAILABLE_GENRES");
    // It drives the CLI by argument list, never through a shell.
    assert.ok(!/\bsh\b|bash|cmd\.exe|powershell/i.test(source.replace(/\/\/.*$/gm, "")), "the mod must not build shell commands");
    console.log("   ✓ The mod tracks the package version, is in the marketplace, and lists the player's genres.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
