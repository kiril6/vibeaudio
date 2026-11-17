#!/usr/bin/env node
/**
 * Drift check (#41, tier 1): does the latest release of each agent CLI still
 * accept what VibeAudio installs and still know the events it hooks?
 *
 *   node scripts/drift-check.js --agent claude,gemini     # CLIs on PATH, installed with npm -g
 *   node scripts/drift-check.js --root /tmp/x/node_modules --agent codex
 *
 * Needs no login. Two checks, both a floor rather than a proof:
 * - validate: Claude Code (`claude plugin validate`, the plugin and the mod)
 *   and Gemini CLI (`gemini extensions validate` on the generated extension)
 *   must accept our manifests. This is what caught "an unknown event rejects the
 *   whole hooks file".
 * - events: every distinctive event name in TARGETS (camelCase, 8+ characters:
 *   a plain `Stop` or `Notification` is in every bundle) must still appear in
 *   the installed package, binaries included. A renamed event disappears.
 * Payload fields only show up in a real turn; that is tier 2, not built here.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");

/** The agents with an npm-installable CLI, by TARGETS id. */
const AGENTS = {
  claude: { pkg: "@anthropic-ai/claude-code", validate: ["claude plugin validate ."] },
  codex: { pkg: "@openai/codex" },
  gemini: { pkg: "@google/gemini-cli", validate: ["gemini extensions validate <extension>"] },
  copilot: { pkg: "@github/copilot", noEvents: "the npm package is a loader that downloads the CLI on first run, so there is nothing to search" },
  qwen: { pkg: "@qwen-code/qwen-code" }
};

/** Event names worth looking for: distinctive enough that finding one means something. */
function distinctiveEvents(events) {
  const all = [events.start, events.stop, events.tool, events.failure, events.end, events.interrupt, ...(events.wait || []), ...(events.resume || [])];
  return [...new Set(all.filter((e) => e && e.length >= 8 && /[a-z][A-Z]/.test(e)))];
}

/** Every file under dir, following nested node_modules; a missing dir is empty. */
function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

/** Which of `names` appear in `file`, read in chunks so a 200 MB binary is fine. */
function namesInFile(file, names) {
  const found = new Set();
  const keep = Math.max(...names.map((n) => n.length));
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(32 * 1024 * 1024);
    let tail = "";
    for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0; ) {
      const text = tail + buf.toString("latin1", 0, n);
      for (const name of names) if (text.includes(name)) found.add(name);
      tail = text.slice(-keep);
      if (found.size === names.length) break;
    }
  } finally {
    fs.closeSync(fd);
  }
  return found;
}

/** Event names from `names` that no file under the package directories contains. */
function missingEvents(dirs, names) {
  const left = new Set(names);
  for (const dir of dirs) {
    for (const file of walk(dir)) {
      if (!left.size) return [];
      for (const n of namesInFile(file, [...left])) left.delete(n);
    }
  }
  return [...left];
}

/** The package's own directory and its platform siblings (`<name>-linux-x64`), where a native build lives. */
function packageDirs(root, pkg) {
  const [scope, name] = pkg.startsWith("@") ? pkg.split("/") : ["", pkg];
  const base = scope ? path.join(root, scope) : root;
  let siblings = [];
  try {
    siblings = fs.readdirSync(base).filter((d) => d === name || d.startsWith(`${name}-`));
  } catch (e) {
    // Not installed.
  }
  return siblings.map((d) => path.join(base, d));
}

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { encoding: "utf8", timeout: 120000, killSignal: "SIGKILL", shell: process.platform === "win32", ...opts });

function checkAgent(id, root) {
  const spec = AGENTS[id];
  const { TARGETS } = require("../src/hooks");
  const problems = [];
  const dirs = packageDirs(root, spec.pkg);
  if (!dirs.length) return { id, version: "?", problems: [`${spec.pkg} is not installed under ${root}`] };
  let version = "?";
  try {
    version = JSON.parse(fs.readFileSync(path.join(dirs.find((d) => path.basename(d) === path.basename(spec.pkg)) || dirs[0], "package.json"), "utf8")).version;
  } catch (e) {
    // Version stays unknown; the checks below still run.
  }

  const notes = [];
  const lost = spec.noEvents ? [] : missingEvents(dirs, distinctiveEvents(TARGETS[id].events));
  if (spec.noEvents) notes.push(`events not checked: ${spec.noEvents}`);
  if (lost.length) problems.push(`event name${lost.length > 1 ? "s" : ""} no longer in the package: ${lost.join(", ")}`);

  if (id === "claude") {
    for (const dir of [ROOT, path.join(ROOT, "mods", "vibe")]) {
      const r = run("claude", ["plugin", "validate", dir]);
      if (r.status !== 0) problems.push(`claude plugin validate ${path.relative(ROOT, dir) || "."} failed: ${(r.stdout + r.stderr).trim().split("\n").slice(-4).join(" | ")}`);
    }
  }
  if (id === "gemini") {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-drift-"));
    try {
      require("./gemini-extension").buildGeminiExtension(out);
      const r = run("gemini", ["extensions", "validate", path.join(out, "vibeaudio")]);
      if (r.status !== 0) problems.push(`gemini extensions validate failed: ${(r.stdout + r.stderr).trim().split("\n").slice(-4).join(" | ")}`);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  }
  return { id, version, problems, notes };
}

function main(argv) {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : null;
  };
  const ids = (get("--agent") || Object.keys(AGENTS).join(",")).split(",").filter(Boolean);
  const bad = ids.filter((id) => !AGENTS[id]);
  if (bad.length) {
    console.error(`Unknown agent: ${bad.join(", ")} (known: ${Object.keys(AGENTS).join(", ")})`);
    return 2;
  }
  const root = get("--root") || path.join(run("npm", ["root", "-g"]).stdout.trim());
  let failed = 0;
  const lines = [];
  for (const id of ids) {
    const r = checkAgent(id, root);
    const mark = r.problems.length ? "✗" : "✔";
    const detail = [...r.problems, ...(r.notes || []).map((n) => `(${n})`)];
    lines.push(`${mark} ${id} ${r.version}${detail.length ? `\n    ${detail.join("\n    ")}` : ""}`);
    if (r.problems.length) failed++;
  }
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\`\`\`\n${lines.join("\n")}\n\`\`\`\n`);
  return failed ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { distinctiveEvents, missingEvents, packageDirs, AGENTS };
