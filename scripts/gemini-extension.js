#!/usr/bin/env node
/**
 * Builds the Gemini CLI extension (#40) into <out>/vibeaudio/.
 *
 * Gemini reads an extension's hooks from a fixed `hooks/hooks.json`, in its own
 * event names, and the repository's file at that path is Claude Code's - so
 * the extension cannot be the repository root. It does not need to be:
 * `gemini extensions install https://github.com/kiril6/vibeaudio` downloads the
 * latest release and, when the release carries exactly one asset, installs
 * that instead of the source. The gemini-extension workflow attaches this
 * build, tarred, to every release.
 *
 * Usage: node scripts/gemini-extension.js <out-dir>
 */

const fs = require("fs");
const path = require("path");
const { pluginHooksFile } = require("../src/hooks");

const ROOT = path.join(__dirname, "..");
// What `vibe` needs to run, and nothing it does not.
const SHIP = ["bin", "src", "package.json", "LICENSE", "README.md"];

function buildGeminiExtension(out) {
  const pkg = require("../package.json");
  const dir = path.join(out, "vibeaudio");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "hooks"), { recursive: true });
  for (const entry of SHIP) fs.cpSync(path.join(ROOT, entry), path.join(dir, entry), { recursive: true });

  const manifest = {
    name: pkg.name,
    version: pkg.version,
    description: "Procedural focus music while Gemini CLI works, with a chime when it finishes or needs you. Zero dependencies, synthesized in pure JS."
  };
  // Gemini substitutes ${extensionPath} and ${/} in hook commands itself.
  const hooks = pluginHooksFile(["gemini"], "${extensionPath}${/}bin${/}vibeaudio.js");
  fs.writeFileSync(path.join(dir, "gemini-extension.json"), JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "hooks", "hooks.json"), JSON.stringify(hooks, null, 2) + "\n");
  return dir;
}

if (require.main === module) {
  const out = process.argv[2];
  if (!out) {
    console.error("Usage: node scripts/gemini-extension.js <out-dir>");
    process.exit(1);
  }
  console.log(buildGeminiExtension(path.resolve(out)));
}

module.exports = { buildGeminiExtension };
