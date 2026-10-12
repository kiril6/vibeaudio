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

/** 95 -> "1m 35s", 4_000_000 -> "1h 06m". */
function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** A turn's working time: its length minus the stretches it spent blocked on you. */
const working = (t) => t.ms - (t.blockedMs || 0);

/**
 * The headline numbers of a non-empty list of turns. `--report` and
 * `--report --card` both read these, so the card can never disagree with the
 * text it is a picture of.
 */
function summarize(turns) {
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  const sorted = turns.map((t) => t.ms).sort((a, b) => a - b);
  return {
    count: turns.length,
    failed: turns.filter((t) => t.outcome === "failure").length,
    waited: sum(turns.map(working)),
    blocked: sum(turns.map((t) => t.blockedMs || 0)),
    median: sorted[Math.floor(sorted.length / 2)],
    longest: turns.reduce((a, b) => (b.ms > a.ms ? b : a))
  };
}

/** Working time per calendar day for the last `days` days, oldest first. */
function dayTotals(turns, days, now = Date.now()) {
  const byDay = new Map();
  for (const t of turns) {
    const key = new Date(t.at).toLocaleDateString("en-CA");
    byDay.set(key, (byDay.get(key) || 0) + working(t));
  }
  const out = [];
  for (let d = days - 1; d >= 0; d--) {
    const date = new Date(now - d * 86400000);
    out.push({ date, ms: byDay.get(date.toLocaleDateString("en-CA")) || 0 });
  }
  return out;
}

module.exports = { HISTORY_FILE, RETURN_WINDOW_MS, recordTurn, readTurns, returnTimes, formatDuration, working, summarize, dayTotals };
