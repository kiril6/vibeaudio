/**
 * A local log of finished turns - what `vibe --report` reads. One JSON object
 * per line in ~/.vibeaudio/history.jsonl: when the turn ended, which project,
 * how long it took, how much of that the agent spent blocked on you, how it
 * ended, which session it was and whether a chime announced it. It never
 * leaves the machine; VIBE_NO_HISTORY=1 turns it off.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const HISTORY_FILE = path.join(os.homedir(), ".vibeaudio", "history.jsonl");
const MAX_BYTES = 1024 * 1024;
const KEEP_LINES = 4000;

/** Appends one turn. Never throws: a log is not worth failing a hook over. */
function recordTurn({ project, ms, blockedMs = 0, outcome = "success", session, chimed, at = Date.now() }, file = HISTORY_FILE) {
  if (process.env.VIBE_NO_HISTORY) return false;
  if (!Number.isFinite(ms) || ms < 0) return false;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify({ at, project, ms, blockedMs: Math.min(Math.max(blockedMs, 0), ms), outcome, session, chimed })}\n`);
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

// A gap longer than this is a break - lunch, a meeting, the end of the day -
// not someone coming back to a finished turn, and would swamp the median.
const RETURN_WINDOW_MS = 30 * 60 * 1000;

/**
 * How long each finished turn sat before the next prompt in the same session:
 * the time it took you to come back. A turn's start is `at - ms`. Sessions,
 * not projects, are what pair up - two agents in one repo interleave - so a
 * line from before sessions were logged (or an `anon` one) falls back to its
 * project. `chimed` is the finished turn's, since that is the chime you were
 * answering.
 */
function returnTimes(turns) {
  const groups = new Map();
  for (const t of turns) {
    const key = t.session && t.session !== "anon" ? `s:${t.session}` : `p:${t.project}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const gaps = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.at - b.at);
    for (let i = 1; i < list.length; i++) {
      const ms = list[i].at - list[i].ms - list[i - 1].at;
      if (ms >= 0 && ms <= RETURN_WINDOW_MS) gaps.push({ ms, chimed: list[i - 1].chimed });
    }
  }
  return gaps;
}

module.exports = { HISTORY_FILE, RETURN_WINDOW_MS, recordTurn, readTurns, returnTimes };
