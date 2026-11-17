/**
 * Runs every case in test/cases/ in its own process, in order, and reports all
 * failures instead of stopping at the first. Each case starts from setup.js: an
 * empty HOME and its own audio cache.
 *
 *   node test/run.js                 all cases
 *   node test/run.js 62 076          cases whose file name starts with or contains an argument
 *   node test/run.js --list          names only
 *
 * A case that hangs is killed after CASE_TIMEOUT_MS and named, so a stuck CI
 * job says which case it was (#58).
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const CASE_TIMEOUT_MS = 5 * 60 * 1000;
const dir = path.join(__dirname, "cases");
const all = fs.readdirSync(dir).filter((f) => f.endsWith(".js")).sort();
const args = process.argv.slice(2);

if (args.includes("--list")) {
  console.log(all.join("\n"));
  process.exit(0);
}

const pick = args.length ? all.filter((f) => args.some((a) => f.startsWith(a.padStart(3, "0")) || f.includes(a))) : all;
if (!pick.length) {
  console.error(`No case matches: ${args.join(" ")} (node test/run.js --list)`);
  process.exit(1);
}

console.log("Running VibeAudio Verification Tests...\n");
const failed = [];
for (const file of pick) {
  const r = spawnSync(process.execPath, [path.join(dir, file)], { stdio: "inherit", timeout: CASE_TIMEOUT_MS, killSignal: "SIGKILL" });
  if (r.status !== 0) {
    const why = r.error && r.error.code === "ETIMEDOUT" ? `hung for ${CASE_TIMEOUT_MS / 1000}s and was killed` : `exit ${r.status ?? r.signal}`;
    console.error(`\n\x1b[31m✗ ${file}: ${why}\x1b[0m`);
    failed.push(file);
  }
}

if (failed.length) {
  console.error(`\n\x1b[31m${failed.length} of ${pick.length} cases failed:\x1b[0m\n  ${failed.join("\n  ")}`);
  process.exit(1);
}
console.log(`\n\x1b[32mAll ${pick.length} test cases passed successfully!\x1b[0m`);
