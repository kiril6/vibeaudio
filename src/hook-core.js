/** Shared paths, payload parsing and reactive tool tiers for the hook modules. */

const fs = require("fs");
const os = require("os");
const path = require("path");

const STATE_DIR = path.join(os.homedir(), ".vibeaudio");
const PID_FILE = path.join(STATE_DIR, "daemon.pid");
const INTENSITY_FILE = path.join(STATE_DIR, "intensity");
// One file per agent session with a turn in flight. The music plays while any of
// them is working; each holds where its transcript began and, while paused for
// the user, what will resume it.
const SESSIONS_DIR = path.join(STATE_DIR, "sessions");
const EVENTS_FILE = path.join(STATE_DIR, "events.jsonl");
// Payloads that name no session share this one slot.
const ANON_SESSION = "anon";
const CLI_ENTRY = path.join(__dirname, "..", "bin", "vibeaudio.js");

/**
 * Reactive mode: which tier a tool call implies. Looking things up stays
 * sparse, edits bring in the groove, shelling out and handing work to a
 * subagent go to peak. Unknown tools sit in the middle rather than swinging
 * the mix.
 *
 * The agents don't agree on tool names, so every vocabulary lives here: Claude
 * Code's PascalCase set (which Grok shares), Codex's snake_case one, and
 * Cursor's short names. They don't collide, so one flat map covers them all.
 *
 * Tiers here were checked against 30,532 real tool calls rather than guessed.
 * Two things that measurement changed:
 *
 * - `Task` was the old name for the subagent tool; it is `Agent` now, so the
 *   heaviest thing an agent does was landing on the fallback tier. Both are
 *   listed, since an older Claude Code still emits the old one.
 * - A third of all calls (33.7%) are MCP tools, which arrive as
 *   `mcp__<server>__<tool>` (Claude Code) or `MCP:<tool>` (Cursor) and cannot
 *   be enumerated - every user has different servers. They keep the fallback
 *   deliberately: an MCP call is usually real work, but rarely the heaviest
 *   thing in a turn, which is exactly what tier 2 means.
 *
 * Tools that mean "the agent has stopped and is waiting for the human" belong
 * at tier 1 even though they are not lookups - nothing is being worked on.
 */
const TOOL_TIERS = {
  // Claude Code - lookups, bookkeeping, and waiting on the user
  Read: 1, Glob: 1, Grep: 1, WebFetch: 1, WebSearch: 1, TodoWrite: 1,
  ToolSearch: 1, SearchSkills: 1, ListAgents: 1, ListSkills: 1,
  TaskCreate: 1, TaskUpdate: 1, TaskOutput: 1,
  BashOutput: 1, KillShell: 1,
  AskUserQuestion: 1, ExitPlanMode: 1, SendUserFile: 1, SendMessage: 1,
  // Claude Code - editing
  Edit: 2, Write: 2, MultiEdit: 2, NotebookEdit: 2,
  // Claude Code - shelling out, or handing the work to something else
  Bash: 3, Agent: 3, Task: 3, Skill: 3, Workflow: 3,
  // Codex
  read_file: 1, list_dir: 1, grep: 1, web_search: 1, update_plan: 1,
  apply_patch: 2,
  shell: 3,
  // Cursor
  Delete: 2,
  Shell: 3,
  // Gemini CLI (read_file is Codex's name too). Names read from the 0.10.0 bundle.
  read_many_files: 1, list_directory: 1, glob: 1, search_file_content: 1,
  google_web_search: 1, web_fetch: 1, save_memory: 1, write_todos: 1,
  write_file: 2, replace: 2,
  run_shell_command: 3,
  // Copilot CLI: its shell tool is lowercase `bash` (seen live); its other tool
  // names were not verified, so they keep the fallback.
  bash: 3
};

function toolTier(toolName) {
  return TOOL_TIERS[toolName] || 2;
}

// Calmer tool calls in a row before the tier comes down. Rising is immediate;
// falling on one Read between two Bash runs made the music jump at every loop.
const CALM_CALLS_TO_FALL = 3;

/**
 * The intensity file is "<tier> <calm streak>". Pure: given the file's text and
 * this call's tier, returns the text to write. A tier at or above the current
 * one takes over and resets the streak; a lower one counts toward falling.
 */
function nextIntensity(prevText, tier) {
  const [prev, calm] = String(prevText || "").trim().split(/\s+/).map((n) => parseInt(n, 10));
  if (!(prev >= 1 && prev <= 3) || tier >= prev) return `${tier} 0`;
  const streak = (calm >= 0 ? calm : 0) + 1;
  return streak >= CALM_CALLS_TO_FALL ? `${tier} 0` : `${prev} ${streak}`;
}

function readIntensity() {
  try {
    const tier = parseInt(fs.readFileSync(INTENSITY_FILE, "utf8").trim(), 10);
    return tier >= 1 && tier <= 3 ? tier : null;
  } catch (e) {
    return null; // No signal yet - the player falls back to time escalation.
  }
}

function parsePayload(raw) {
  try {
    const payload = JSON.parse(raw);
    return payload !== null && typeof payload === "object" ? payload : {};
  } catch (e) {
    return {}; // Malformed or absent payload.
  }
}

function payloadToolName(raw) {
  const payload = parsePayload(raw);
  // Claude Code, Codex and Cursor send tool_name; Grok sends toolName.
  // Reading only one of them would silently pin that agent to tier 2.
  // Windsurf names no tool: the event is the signal, and only the shell one is wired.
  const byEvent = payload.agent_action_name === "pre_run_command" ? "Shell" : "";
  return String(payload.tool_name || payload.toolName || byEvent);
}

// Windsurf calls the conversation `trajectory_id`; Antigravity, `conversationId`.
function payloadSession(payload) {
  // Copilot's Notification payload is camelCase (`sessionId`) while its other events are snake_case (seen live, ask_user).
  return payload.session_id || payload.trajectory_id || payload.conversationId || payload.sessionId;
}

/** The project a hook fired in: `cwd` for most agents, Antigravity's first workspace. */
function payloadProject(payload) {
  if (typeof payload.cwd === "string" && payload.cwd) return payload.cwd;
  const ws = Array.isArray(payload.workspacePaths) ? payload.workspacePaths[0] : null;
  return typeof ws === "string" && ws ? ws : null;
}

/**
 * PreToolUse hook: Claude Code delivers the tool call as JSON on stdin.
 * Writes a tier for the running daemon to pick up at its next loop boundary.
 */
function hookTool() {
  let raw = "";
  const commit = () => {
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      let prev = "";
      try { prev = fs.readFileSync(INTENSITY_FILE, "utf8"); } catch (e) { /* first call of the turn */ }
      fs.writeFileSync(INTENSITY_FILE, nextIntensity(prev, toolTier(payloadToolName(raw))));
    } catch (e) {
      // Never let a hook failure disturb the agent.
    }
    process.exit(0);
  };

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    raw += chunk;
  });
  process.stdin.on("end", commit);
  // A hook must never hang the tool call waiting on stdin.
  setTimeout(commit, 500).unref();
}

// A lost Stop hook must not leave music looping forever. This is how long a
// session may go without a hook before it is taken for a crashed agent; every
// tool call refreshes it, so a long turn that keeps working keeps its music.
// VIBE_MAX_DAEMON_MS is internal, for the suite.
const MAX_DAEMON_MS = Number(process.env.VIBE_MAX_DAEMON_MS) || 15 * 60 * 1000;
// The daemon's own ceiling, whatever the sessions say: a backstop, not the rule.
const DAEMON_CEILING_MS = Math.max(MAX_DAEMON_MS, 4 * 60 * 60 * 1000);


/** The project a hook fired in: the payload's (see payloadProject), else ours. */
function projectName(dir) {
  return path.basename(String(dir).replace(/[\\/]+$/, "")) || "a session";
}

module.exports = { STATE_DIR, PID_FILE, INTENSITY_FILE, SESSIONS_DIR, EVENTS_FILE, ANON_SESSION, CLI_ENTRY, TOOL_TIERS, toolTier, nextIntensity, readIntensity, parsePayload, payloadToolName, payloadSession, payloadProject, hookTool, MAX_DAEMON_MS, DAEMON_CEILING_MS, projectName };
