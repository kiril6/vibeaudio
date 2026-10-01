/**
 * A local log of finished turns - what `vibe --report` reads. One JSON object
 * per line in ~/.vibeaudio/history.jsonl: when the turn ended, which project,
 * how long it took, how much of that the agent spent blocked on you, and how
 * it ended. It never leaves the machine; VIBE_NO_HISTORY=1 turns it off.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const HISTORY_FILE = path.join(os.homedir(), ".vibeaudio", "history.jsonl");
const MAX_BYTES = 1024 * 1024;
const KEEP_LINES = 4000;

/** Appends one turn. Never throws: a log is not worth failing a hook over. */
function recordTurn({ project, ms, blockedMs = 0, outcome = "success", at = Date.now() }, file = HISTORY_FILE) {
  if (process.env.VIBE_NO_HISTORY) return false;
  if (!Number.isFinite(ms) || ms < 0) return false;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify({ at, project, ms, blockedMs: Math.min(Math.max(blockedMs, 0), ms), outcome })}\n`);
    // Bounded, so a year of use is still a small file. Rewritten rarely, from
    // the tail, so the newest turns are always the ones kept.
    if (fs.statSync(file).size > MAX_BYTES) {
      const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${lines.slice(-KEEP_LINES).join("\n")}\n`);
      fs.renameSync(tmp, file);
    }
    return true;
  } catch (e) {
    return false;
  }
}

/** Turns that ended within the last `days` days. A line that does not parse is skipped, not fatal. */
function readTurns(days, now = Date.now(), file = HISTORY_FILE) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    return [];
  }
  const since = now - days * 86400000;
  const turns = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try {
      const t = JSON.parse(line);
      if (t && Number.isFinite(t.at) && Number.isFinite(t.ms) && t.at >= since) turns.push(t);
    } catch (e) { /* a torn or hand-edited line */ }
  }
  return turns;
}

module.exports = { HISTORY_FILE, recordTurn, readTurns };
