const { assert, os } = require("../helpers");

// The weekly drift check (#41) is only worth its CI minutes if it can fail.
(async () => {
  console.log("\n\x1b[1m[84] Drift check finds a renamed event\x1b[0m");
  const fs = require("fs");
  const path = require("path");
  const { distinctiveEvents, missingEvents, packageDirs } = require("../../scripts/drift-check");
  const { TARGETS } = require("../../src/hooks");

  assert.deepStrictEqual(
    distinctiveEvents(TARGETS.claude.events).sort(),
    ["PermissionRequest", "PostToolUse", "PostToolUseFailure", "PreToolUse", "SessionEnd", "StopFailure", "UserPromptSubmit", "ElicitationResult"].sort(),
    "plain Stop, Notification and Elicitation are in every bundle, so they prove nothing and are skipped"
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-drift-"));
  try {
    const pkg = path.join(root, "@acme", "agent");
    const native = path.join(root, "@acme", "agent-linux-x64");
    fs.mkdirSync(path.join(pkg, "node_modules", "dep"), { recursive: true });
    fs.mkdirSync(native, { recursive: true });
    fs.writeFileSync(path.join(pkg, "cli.js"), 'on("UserPromptSubmit"); on("PreToolUse");');
    fs.writeFileSync(path.join(pkg, "node_modules", "dep", "x.js"), 'emit("PostToolUse")');
    fs.writeFileSync(path.join(native, "agent"), Buffer.concat([Buffer.alloc(1000, 1), Buffer.from("SessionEnd"), Buffer.alloc(1000, 2)]));
    fs.mkdirSync(path.join(root, "@acme", "unrelated"), { recursive: true });

    const dirs = packageDirs(root, "@acme/agent");
    assert.deepStrictEqual(dirs.map((d) => path.basename(d)).sort(), ["agent", "agent-linux-x64"], "the package and its native sibling, not a neighbour");
    assert.deepStrictEqual(missingEvents(dirs, ["UserPromptSubmit", "PreToolUse", "PostToolUse", "SessionEnd"]), [], "found in source, a nested dependency and a binary");
    assert.deepStrictEqual(missingEvents(dirs, ["UserPromptSubmit", "SessionStop", "PostToolUseFailure"]).sort(), ["PostToolUseFailure", "SessionStop"], "a renamed or dropped event is reported by name");
    assert.deepStrictEqual(missingEvents([path.join(root, "nope")], ["PreToolUse"]), ["PreToolUse"], "a missing package finds nothing");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("   ✓ Distinctive event names are searched in source, nested dependencies and binaries; a missing one is named.");
})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
