const { assert, TEST_DIR } = require("../helpers");

(async () => {
// 20. Custom Command Tokenizing
// Regression: the interactive "Custom command..." prompt split on whitespace,
// so quoted arguments were shredded into separate argv entries.
console.log("20. Testing Custom Command Tokenizing...");
const { tokenizeCommand } = require("../../src/interactive");
assert.deepStrictEqual(tokenizeCommand("claude"), ["claude"]);
assert.deepStrictEqual(tokenizeCommand("  claude   --resume  "), ["claude", "--resume"]);
assert.deepStrictEqual(
  tokenizeCommand('claude --append-system-prompt "be brief"'),
  ["claude", "--append-system-prompt", "be brief"],
  "double-quoted arguments must stay one token"
);
assert.deepStrictEqual(tokenizeCommand("git commit -m 'two words'"), ["git", "commit", "-m", "two words"]);
assert.deepStrictEqual(tokenizeCommand(""), [], "empty input yields no tokens");
console.log("   ✓ Quoted arguments survive the custom-command prompt.");


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
