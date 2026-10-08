/**
 * Agent Hooks Integration (Claude Code, Codex, Cursor, Grok, Gemini CLI, Copilot CLI, Qwen Code)
 *
 * Hooks fire as short-lived processes, so playback lives in a detached daemon
 * tracked by a pid file. The prompt-submit event starts it, the stop event
 * tears it down and plays the chime. This tracks the agent's actual thinking
 * window instead of guessing from a wrapped process's lifetime.
 *
 * The supported agents differ only in where the file lives, what the events
 * are called and how one entry is shaped - TARGETS holds those three facts and
 * everything else below is shared.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { AudioPlayer, loadConfig, playbackDisabled } = require("./player");
const { recordTurn } = require("./history");

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
  Shell: 3
};

function toolTier(toolName) {
  return TOOL_TIERS[toolName] || 2;
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
  return payload.session_id || payload.trajectory_id || payload.conversationId;
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
      fs.writeFileSync(INTENSITY_FILE, String(toolTier(payloadToolName(raw))));
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

/**
 * The agents VibeAudio can wire itself into, and the few things that differ
 * between them: where the file lives, what the events are called, how one
 * entry is shaped. Each was verified against the tool itself - its installed
 * binary and a live run where it is installed, its released source where not -
 * never inferred from another tool's docs.
 *
 * `events` beyond start/stop/tool are optional, and a target only lists what
 * that tool was shown to fire:
 * - wait:    the agent is blocked on the user (pause + attention chime)
 * - resume:  what ends a wait
 * - failure: a turn ending in error *instead of* the stop event
 * - end:     the session closing, which can cut a turn off before stop
 *
 * - interrupt: the user stopped the turn (Esc), a silent end like `end`
 *
 * `seed` is the root object to write when the file does not exist yet. Cursor
 * and Copilot require a schema version; Codex rejects unknown root keys
 * outright, so nothing may be added there beyond `hooks`.
 */
/**
 * Where Claude Code and Codex keep their config. Both move with an env var,
 * and a user who sets one has hooks read from there only: writing to the
 * default path left VibeAudio installed in a file nothing read, and silent.
 * Claude Code: `CLAUDE_CONFIG_DIR ?? ~/.claude`, NFC-normalized (cn() in
 * 2.1.195's bundle; settings.json and commands/ both live under it).
 * Codex: `CODEX_HOME`, empty treated as unset, else `~/.codex`
 * (find_codex_home(), 0.160 source). Empty is unset for both here, so an
 * exported-but-blank variable cannot turn the path relative.
 */
function claudeConfigDir() {
  return (process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude")).normalize("NFC");
}

function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

/**
 * The three further agents that move with an env var, each read from the
 * agent's own code; empty is unset for all of them.
 * Gemini CLI: `GEMINI_CLI_HOME` replaces the *home*, so settings live in
 * `<it>/.gemini` (homedir() in core, 0.62.0 bundle); used as written, no `~`.
 * Qwen Code: `QWEN_HOME` *is* the `.qwen` directory, with `~` expanded and the
 * rest path.resolve()d (Storage.getGlobalQwenDir(), 0.25.0 bundle).
 * Grok: `GROK_HOME` *is* the `.grok` directory (grok_home(); the npm launcher
 * and postinstall.js of @xai-official/grok 1.0.46 write config.toml there).
 * Cursor and Windsurf: no override found, and neither is open to read.
 */
function geminiDir() {
  return path.join(process.env.GEMINI_CLI_HOME || os.homedir(), ".gemini");
}

function qwenHome() {
  const dir = process.env.QWEN_HOME;
  if (!dir) return path.join(os.homedir(), ".qwen");
  const rest = /^~(?:[\\/]|$)/.test(dir) ? dir.slice(2).split(/[\\/]+/).filter(Boolean) : null;
  return path.resolve(rest ? path.join(os.homedir(), ...rest) : dir);
}

function grokHome() {
  return process.env.GROK_HOME || path.join(os.homedir(), ".grok");
}

const TARGETS = {
  claude: {
    name: "Claude Code",
    cmd: "claude",
    file: () => path.join(claudeConfigDir(), "settings.json"),
    // - wait: PermissionRequest fires when the dialog is shown in the terminal,
    //   the SDK (desktop app, IDEs) and print mode alike - Notification's
    //   permission_prompt is raised by the terminal UI alone, after 6s idle.
    // - Esc reaches no hook at all; the daemon watches the transcript for it.
    events: {
      start: "UserPromptSubmit",
      stop: "Stop",
      tool: "PreToolUse",
      wait: ["PermissionRequest", "Elicitation"],
      resume: ["PostToolUse", "PostToolUseFailure", "ElicitationResult"],
      failure: "StopFailure",
      end: "SessionEnd"
    },
    entry: (command) => ({ hooks: [{ type: "command", command, timeout: 5 }] }),
    commands: (entry) => (entry.hooks || []).map((h) => h.command),
    seed: () => ({})
  },
  codex: {
    name: "Codex",
    cmd: "codex",
    file: () => path.join(codexHome(), "hooks.json"),
    // PermissionRequest runs only when Codex is about to ask for approval,
    // with tool_name, and is present in 0.125's binary. SessionEnd arrived in
    // 0.145 and Interrupt in 0.150 (source of each release tag). Listing them
    // is safe on older versions: HookEventsToml has never denied unknown
    // fields (checked 0.125 through 0.160), so an older Codex ignores an
    // event it does not know - only the file's root is strict. Interrupt runs
    // on the turn-abort path, not the one that runs Stop, with session_id,
    // cwd and transcript_path.
    events: {
      start: "UserPromptSubmit",
      stop: "Stop",
      tool: "PreToolUse",
      wait: ["PermissionRequest"],
      resume: ["PostToolUse"],
      interrupt: "Interrupt",
      end: "SessionEnd"
    },
    // Codex caps SessionEnd and Interrupt hooks at 3s (SESSION_END_MAX_TIMEOUT_SEC,
    // discovery.rs) and warns on every run when one asks for more.
    entry: (command, event) => ({ hooks: [{ type: "command", command, timeout: event === "SessionEnd" || event === "Interrupt" ? 3 : 5 }] }),
    commands: (entry) => (entry.hooks || []).map((h) => h.command),
    seed: () => ({}),
    // Codex records a trusted_hash per hook in config.toml and asks before
    // running one it has not seen, so the install is not live until approved.
    note: "Codex asks you to trust each new hook the first time it fires — approve each one once."
  },
  cursor: {
    name: "Cursor",
    cmd: "cursor-agent",
    file: () => path.join(os.homedir(), ".cursor", "hooks.json"),
    events: { start: "beforeSubmitPrompt", stop: "stop", tool: "preToolUse" },
    entry: (command) => ({ command, timeout: 5 }),
    commands: (entry) => (entry.command ? [entry.command] : []),
    seed: () => ({ version: 1 })
  },
  grok: {
    name: "Grok",
    cmd: "grok",
    // Grok reads every *.json in this directory, so we get a file of our own
    // rather than merging into someone else's - which also makes uninstall a
    // delete instead of an edit. `dedicated` says so.
    file: () => path.join(grokHome(), "hooks", "vibeaudio.json"),
    dedicated: true,
    // Directory, not file: detection can't use dirname() like the others.
    configDir: () => grokHome(),
    events: { start: "UserPromptSubmit", stop: "Stop", tool: "PreToolUse" },
    entry: (command) => ({ hooks: [{ type: "command", command, timeout: 5 }] }),
    commands: (entry) => (entry.hooks || []).map((h) => h.command),
    seed: () => ({})
  },
  gemini: {
    name: "Gemini CLI",
    cmd: "gemini",
    file: () => path.join(geminiDir(), "settings.json"),
    // Verified against gemini-cli v0.59.0's source (hooks/types.ts,
    // settingsSchema.ts) - the Gemini CLI available to test against predated
    // hooks, so there was no binary to run. Hooks are on by default and
    // user-level ones need no trust step. The permission dialog is a
    // Notification, and it names no tool - so any AfterTool resumes.
    events: {
      start: "BeforeAgent",
      stop: "AfterAgent",
      tool: "BeforeTool",
      wait: ["Notification"],
      resume: ["AfterTool"],
      end: "SessionEnd"
    },
    entry: (command) => ({ hooks: [{ type: "command", command, name: "vibeaudio", timeout: 5000 }] }),
    commands: (entry) => (entry.hooks || []).map((h) => h.command),
    seed: () => ({}),
    // Settings, not events, that may sit in the same `hooks` object.
    configKeys: ["enabled", "disabled", "notifications"],
    // Unlike the four above, not verified to re-read hooks mid-session.
    liveReload: false,
    note: "Not checked whether an open Gemini CLI session reloads hooks — start a new one to be sure."
  },
  copilot: {
    name: "GitHub Copilot CLI",
    cmd: "copilot",
    // Copilot reads every *.json in hooks/, so, like Grok, a file of our own.
    // PascalCase event names select its Claude-compatible payloads
    // (snake_case, tool_name "Bash"); camelCase ones get a different dialect.
    // Verified live on 1.0.80: its PermissionRequest fires before *every*
    // permission check, prompt or not, so the wait signal is the
    // permission_prompt Notification, which names no tool.
    file: () => path.join(process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot"), "hooks", "vibeaudio.json"),
    dedicated: true,
    configDir: () => process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot"),
    events: {
      start: "UserPromptSubmit",
      stop: "Stop",
      tool: "PreToolUse",
      wait: ["Notification"],
      resume: ["PostToolUse", "PostToolUseFailure"],
      end: "SessionEnd"
    },
    entry: (command) => ({ type: "command", command, timeoutSec: 5 }),
    commands: (entry) => (entry.command ? [entry.command] : []),
    seed: () => ({ version: 1 }),
    // Unlike the four above, not verified to re-read hooks mid-session.
    liveReload: false,
    note: "Not checked whether an open Copilot CLI session reloads hooks — start a new one to be sure."
  },
  qwen: {
    name: "Qwen Code",
    cmd: "qwen",
    file: () => path.join(qwenHome(), "settings.json"),
    // Verified against qwen-code v0.23.3's source (hooks/types.ts): Claude
    // Code's event set, including a PermissionRequest raised when the dialog
    // is displayed, with tool_name. Timeouts are milliseconds.
    events: {
      start: "UserPromptSubmit",
      stop: "Stop",
      tool: "PreToolUse",
      wait: ["PermissionRequest"],
      resume: ["PostToolUse", "PostToolUseFailure"],
      failure: "StopFailure",
      end: "SessionEnd"
    },
    entry: (command) => ({ hooks: [{ type: "command", command, name: "vibeaudio", timeout: 5000 }] }),
    commands: (entry) => (entry.hooks || []).map((h) => h.command),
    seed: () => ({}),
    // Unlike the four above, not verified to re-read hooks mid-session.
    liveReload: false,
    note: "Not checked whether an open Qwen Code session reloads hooks — start a new one to be sure."
  },
  windsurf: {
    name: "Windsurf",
    cmd: "windsurf",
    // Checked against Windsurf's hooks documentation only: it was not installed
    // here, so nothing was run. User-level file, a flat {command} entry with no
    // timeout field, and the conversation named `trajectory_id` rather than
    // session_id. post_cascade_response is the end-of-reply event; Windsurf has
    // no permission-dialog, failure or session-end event, so none is wired, and
    // its pre-tool events are per kind - pre_run_command is the one reactive
    // mode listens to.
    file: () => path.join(os.homedir(), ".codeium", "windsurf", "hooks.json"),
    events: { start: "pre_user_prompt", stop: "post_cascade_response", tool: "pre_run_command" },
    entry: (command) => ({ command }),
    commands: (entry) => (entry.command ? [entry.command] : []),
    seed: () => ({}),
    liveReload: false,
    note: "Windsurf's hooks do not load in Restricted Mode, and whether an open session reloads them is not documented — start a new one to be sure."
  },
  antigravity: {
    name: "Antigravity",
    cmd: "agy",
    // Verified live with the agy CLI 1.1.25 (a logging hook in this file, two
    // turns): ~/.gemini/config/ is Antigravity's global customization root,
    // and its hooks.json holds *named* hooks - {"<name>": {"<Event>": [...]}} -
    // so ours live under a key of their own (hooksKey) and nobody else's are
    // touched. Handlers are flat for these two events; timeout in seconds.
    // - start: there is no prompt event. PreInvocation fires before every model
    //   call with invocationNum counting from 0 per turn; newTurn() marks the
    //   later ones `continues` and hookStart ignores them.
    // - stop: Stop, with terminationReason (outcomeFromPayload).
    // - no tool slot, deliberately: PreToolUse must answer with a decision,
    //   and a hook that printed none was seen to DENY the tool, while "allow"
    //   would bypass the user's permission prompts. So --reactive cannot apply.
    // - no wait, failure, resume or end: there is no permission or session-end
    //   event, and PostToolUse.error stayed empty for a failing command.
    // Not verified: the desktop app reading this file (2.19.1 was running and
    // fired nothing, but was idle), and what Esc fires.
    file: () => path.join(os.homedir(), ".gemini", "config", "hooks.json"),
    // ~/.gemini is Gemini CLI's too; this directory is Antigravity's alone.
    configDir: () => path.join(os.homedir(), ".gemini", "antigravity"),
    hooksKey: "vibeaudio",
    events: { start: "PreInvocation", stop: "Stop" },
    entry: (command) => ({ type: "command", command, timeout: 5 }),
    commands: (entry) => (entry.hooks ? entry.hooks.map((h) => h.command) : entry.command ? [entry.command] : []),
    seed: () => ({}),
    liveReload: false,
    note: "Not checked whether an open Antigravity session reloads hooks — start a new one to be sure. Reactive mode does not apply: Antigravity's pre-tool hook must approve or deny every tool, so VibeAudio installs none."
  }
};

function target(id) {
  const t = TARGETS[id];
  if (!t) throw new Error(`unknown hook target '${id}' — expected one of ${Object.keys(TARGETS).join(", ")}`);
  return t;
}

function targetFile(id) {
  return target(id).file();
}

/**
 * Which of them are on this machine. The config directory is the reliable
 * signal - Cursor ships no CLI on PATH at all, and a tool that has never run
 * has nothing for us to merge into anyway. PATH is a fallback for the case of
 * a fresh install whose config directory does not exist yet.
 */
function detectTargets() {
  const { isInstalled } = require("./interactive");
  return Object.keys(TARGETS).filter((id) => {
    const t = TARGETS[id];
    const dir = t.configDir ? t.configDir() : path.dirname(t.file());
    return fs.existsSync(dir) || isInstalled(t.cmd);
  });
}

/**
 * Every event an install by this version writes for a target, `tool` aside
 * (reactive mode only). A hook file is written once and outlives upgrades,
 * so an event added in a later version - Codex's Interrupt and SessionEnd in
 * 0.13.1 - never reaches someone who installed before it unless they
 * reinstall. `--doctor` and `--status` compare against this to say so.
 */
function expectedEvents(id) {
  const ev = TARGETS[id].events;
  return [ev.start, ev.stop, ...(ev.wait || []), ...(ev.resume || []), ev.failure, ev.end, ev.interrupt].filter(Boolean);
}

/**
 * The agents that load this repository as a plugin, and the hooks file each
 * one reads. Copilot CLI loads `.claude-plugin/` manifests and Qwen Code
 * converts the plugin on install (copying the folder, substituting
 * CLAUDE_PLUGIN_ROOT), so both read Claude Code's hooks/hooks.json. Codex
 * 0.160 would too, but Claude Code's validator rejects an event it does not
 * know ("hooks.Interrupt: Invalid key in record") and then loads none of the
 * file, so Codex's Interrupt cannot live there: `.codex-plugin/plugin.json`,
 * which Codex reads before `.claude-plugin/` and Claude Code never reads,
 * points Codex at a file of its own. Gemini CLI has its own extension format
 * and is not one of these.
 */
const PLUGIN_FILES = {
  "hooks/hooks.json": ["claude", "copilot", "qwen"],
  "hooks/codex.json": ["codex"]
};
const PLUGIN_AGENTS = Object.values(PLUGIN_FILES).flat();

const SLOT_ACTION = { start: "hook-start", stop: "hook-stop", failure: "hook-stop", wait: "hook-wait", resume: "hook-resume", end: "hook-end", interrupt: "hook-end" };

/**
 * Every event the given agents fire, with the one action it runs. One file
 * can serve several agents, so it carries the union; an event an agent does
 * not use there is dropped at runtime by `--event` (see runHookAction).
 * Throws if two agents would need different actions for one event name,
 * since the file could not serve both.
 */
function pluginHookEvents(agents) {
  const actions = new Map();
  for (const id of agents) {
    for (const [slot, value] of Object.entries(TARGETS[id].events)) {
      if (!SLOT_ACTION[slot]) continue; // `tool` is reactive mode, an --install-hooks option
      for (const event of [].concat(value)) {
        const prior = actions.get(event);
        if (prior && prior !== SLOT_ACTION[slot]) throw new Error(`${event}: ${prior} for one agent, ${SLOT_ACTION[slot]} for ${id}`);
        actions.set(event, SLOT_ACTION[slot]);
      }
    }
  }
  return actions;
}

/**
 * A plugin hooks file (see PLUGIN_FILES), generated so it cannot drift from
 * TARGETS. Agents sharing a file share an entry shape, so the first one's is
 * used. `script` is the CLI's path as the host spells it: Gemini's extension
 * substitutes ${extensionPath} itself, the others leave CLAUDE_PLUGIN_ROOT to
 * the shell.
 */
function pluginHooksFile(agents, script = "${CLAUDE_PLUGIN_ROOT}/bin/vibeaudio.js") {
  const hooks = {};
  for (const [event, action] of pluginHookEvents(agents)) {
    hooks[event] = [TARGETS[agents[0]].entry(`node "${script}" --${action} --plugin --event ${event}`, event)];
  }
  return { hooks };
}

/**
 * Which agent is running a plugin hook, from the environment each one sets:
 * Copilot CLI sets COPILOT_PLUGIN_ROOT (its changelog), Qwen Code sets
 * QWEN_PROJECT_DIR for every hook (hookRunner.ts), Gemini CLI sets
 * GEMINI_PROJECT_DIR for its extension's hooks (hookRunner.ts), and Codex sets
 * PLUGIN_ROOT (discovery.rs). Claude Code sets none of these, only
 * CLAUDE_PLUGIN_ROOT / CLAUDE_PLUGIN_DATA / CLAUDE_PROJECT_DIR (2.1.195's
 * bundle). Copilot also sets PLUGIN_ROOT, so it is checked first.
 * ponytail: a variable exported in the user's own shell would leak into
 * hooks and misattribute them; none of these names is one a user sets.
 */
function pluginAgent(env = process.env) {
  if (env.COPILOT_PLUGIN_ROOT) return "copilot";
  if (env.QWEN_PROJECT_DIR) return "qwen";
  if (env.GEMINI_PROJECT_DIR) return "gemini"; // after Qwen, a fork that sets it too
  if (env.PLUGIN_ROOT) return "codex";
  return "claude";
}

function settingsPath() {
  return TARGETS.claude.file();
}

function readPid() {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch (e) {
    return null;
  }
}

/**
 * A pid file outlives its daemon whenever the daemon dies without cleanup
 * (SIGKILL, crash, reboot), and the OS recycles pids - so the number alone is
 * not proof of what it now names. hookStart calls stopDaemon on every prompt,
 * so an unverified kill would eventually SIGTERM an unrelated process.
 *
 * Failing closed is the safe direction here: a daemon we decline to kill stops
 * itself once no session is left (MAX_DAEMON_MS of silence), while killing a stranger's process has no such
 * ceiling.
 *
 * ponytail: posix only. Windows has no cheap command-line lookup, so the pid
 * is trusted there as before; revisit if hooks see real Windows use.
 */
function daemonArgv(pid) {
  if (process.platform === "win32") return null;
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "args="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      // Run on every prompt: a ps that never answers must not hold the hook.
      timeout: 3000,
      killSignal: "SIGKILL"
    });
  } catch (e) {
    return null; // No such process, ps unavailable, or it did not answer in time.
  }
}

function isOurDaemon(pid) {
  if (process.platform === "win32") return true;
  const out = daemonArgv(pid);
  // Failing closed: no argv means no kill.
  return out !== null && out.includes("vibeaudio") && out.includes("--daemon");
}

/**
 * What the background player is playing right now, or null if nothing is.
 *
 * Read from the daemon's own command line rather than a file it would have to
 * keep in step - spawnDaemon() puts the settings there already, and a process
 * that dies without cleanup cannot leave a stale answer behind. It is the
 * settings *in flight*, which is the question a running daemon raises: a
 * genre saved a moment ago does not reach it until the next prompt.
 */
function daemonPlaying() {
  const pid = readPid();
  if (pid === null || !isOurDaemon(pid)) return null;

  const argv = daemonArgv(pid) || "";
  const genre = /--genre (\S+)/.exec(argv);
  const volume = /--volume (\d+)/.exec(argv);
  return {
    pid,
    genre: genre ? genre[1] : null,
    volume: volume ? Number(volume[1]) : null,
    reactive: /--reactive/.test(argv),
    follows: /--follow-volume/.test(argv)
  };
}

/**
 * Stops the player. `keepSessions` leaves the session files alone: the hooks
 * use it because they decide per session what is still going on, and --mute
 * because a mute is about sound - the turns are still in flight, and should
 * still reach --state, --events and --report. --stop and uninstall end
 * everything, or a later tool call would resume music nobody is waiting for;
 * each session dropped gets an `ended` event with that `reason`, or an
 * --events consumer would show it working forever (#24).
 */
function stopDaemon({ keepSessions = false, reason = "stop" } = {}) {
  const pid = readPid();
  fs.rmSync(PID_FILE, { force: true });
  if (!keepSessions) {
    // Removed before its event, so each line's status is what it left behind
    // and the last one reads idle.
    for (const s of listSessions()) {
      fs.rmSync(sessionFile(s.id), { force: true });
      emitEvent("ended", s.id, s.project, { reason });
    }
    fs.rmSync(SESSIONS_DIR, { recursive: true, force: true });
  }
  if (pid === null || !isOurDaemon(pid)) return false;

  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch (e) {
    return false; // Already gone
  }
}

function fileSize(file) {
  try {
    return fs.statSync(file).size;
  } catch (e) {
    return 0;
  }
}

/**
 * A turn starts at a prompt. The transcript offset is taken here, not when a
 * daemon spawns, because a resume respawns the daemon mid-turn - and an
 * interrupt written just before that must still count.
 */
function newTurn(raw) {
  const payload = parsePayload(raw);
  const transcript = typeof payload.transcript_path === "string" ? payload.transcript_path : "";
  const offset = transcript ? fileSize(transcript) : 0;
  return {
    session: String(payloadSession(payload) || ""),
    project: payloadProject(payload) || process.cwd(),
    transcript,
    offset,
    blocked: blockedJustBefore(transcript, offset),
    // Antigravity has no prompt event: its start is PreInvocation, which fires
    // before every model call and counts them from 0 within the turn. Only the
    // first one is a new turn; the rest would restart the music mid-turn.
    continues: Number(payload.invocationNum) > 0
  };
}

const BLOCK_LOOKBACK_MS = 3000;

/**
 * Whether another hook has already rejected this very prompt. Hooks run side
 * by side and a native blocker is faster to start than we are, so its transcript
 * entry can land *before* the offset taken above - where the daemon, which reads
 * only what follows, would never see it. Looked at the tail instead, and only
 * for an entry stamped within the last moments, so an earlier blocked prompt
 * does not silence this one.
 */
function blockedJustBefore(transcript, offset) {
  if (!transcript || !offset) return false;
  try {
    const len = Math.min(offset, 16384);
    const fd = fs.openSync(transcript, "r");
    const buf = Buffer.alloc(len);
    try {
      fs.readSync(fd, buf, 0, len, offset - len);
    } finally {
      fs.closeSync(fd);
    }
    const lines = buf.toString("utf8").split("\n");
    if (len < offset) lines.shift(); // Began mid-line.
    return lines.some((line) => {
      if (!isInterruptEntry(line)) return false;
      try {
        return Date.now() - Date.parse(JSON.parse(line).timestamp) <= BLOCK_LOOKBACK_MS;
      } catch (e) {
        return false;
      }
    });
  } catch (e) {
    return false;
  }
}

// The id ends up in a file name.
function sessionId(id) {
  return String(id || ANON_SESSION).replace(/[^\w.-]/g, "_").slice(0, 100);
}

function sessionFile(id) {
  return path.join(SESSIONS_DIR, `${id}.json`);
}

function readSession(id) {
  try {
    return JSON.parse(fs.readFileSync(sessionFile(id), "utf8"));
  } catch (e) {
    return null;
  }
}

// Written beside the target and renamed into place: the daemon lists this
// directory every poll and must never read half a file.
function writeSession(id, data) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  const tmp = `${sessionFile(id)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...data, ts: Date.now() }));
  fs.renameSync(tmp, sessionFile(id));
}

/**
 * Every session with a turn in flight. One that has not been touched for
 * MAX_DAEMON_MS is a crashed agent - it never sent Stop - and is dropped here;
 * the daemon stops once none is left, with DAEMON_CEILING_MS as the backstop.
 */
function listSessions() {
  let names;
  try {
    names = fs.readdirSync(SESSIONS_DIR);
  } catch (e) {
    return [];
  }
  const now = Date.now();
  const sessions = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -".json".length);
    const data = readSession(id);
    if (!data) continue;
    if (now - (data.ts || 0) > MAX_DAEMON_MS) fs.rmSync(sessionFile(id), { force: true });
    else sessions.push({ id, ...data });
  }
  return sessions;
}

// Working, as opposed to paused for the user.
const working = (sessions) => sessions.filter((s) => s.waiting == null);

// "Stuck": STUCK_FAILURES of a session's last STUCK_WINDOW tool calls failed.
// Measured on 4,497 real Claude Code turns (46,032 tool calls, 3.8% failing):
// this fires in 0.9% of turns, at minute 3 by the median, and those turns ran
// a median 3.3 minutes more - time someone could have stepped in. "3 of 8"
// fired in 2.4%, and "3 in a row" misses the usual loop, where an edit that
// succeeds sits between every failing test run. Rare is the point: a signal
// that fires often is one people learn to tune out.
const STUCK_WINDOW = 8;
const STUCK_FAILURES = 4;
const isStuck = (session) => (session.recent || []).filter(Boolean).length >= STUCK_FAILURES;

/**
 * The public face of the session files: what every agent on the machine is
 * doing, in five words that mean the same thing whichever agent it is. The
 * hard part of this project is mapping eight agents' hook events onto those
 * states; the music is one consumer of them, and `vibe --state` / `--events`
 * let anything else be another - a light, a menu bar, a tmux status line.
 * `status` is the machine's: the most urgent of its sessions, since one
 * session waiting on you matters more than three working.
 */
const STATE_RANK = ["idle", "working", "stuck", "waiting"];
const sessionState = (s) => (s.waiting != null ? "waiting" : isStuck(s) ? "stuck" : "working");

function agentState(sessions = listSessions()) {
  const list = sessions.map((s) => ({
    session: s.id,
    project: s.project || null,
    state: sessionState(s),
    since: s.started || null,
    ...(s.waiting ? { tool: s.waiting } : {})
  }));
  const status = list.reduce((a, s) => (STATE_RANK.indexOf(s.state) > STATE_RANK.indexOf(a) ? s.state : a), "idle");
  return { v: 1, status, sessions: list };
}

/**
 * `vibe --statusline`: the state as one plain line for a tmux segment or a
 * shell prompt, and nothing at all when idle so the segment disappears. The
 * most urgent status, with a count when more than one session is in it; a
 * waiting session names its project, since that is the one you have to go to.
 * Plain text because tmux and Starship style it themselves.
 */
function formatStatusline({ status, sessions }) {
  if (status === "idle") return "";
  const active = sessions.filter((s) => s.state === status);
  const project = status === "waiting" && active[0].project ? `: ${projectName(active[0].project)}` : "";
  return `${status}${project}${active.length > 1 ? ` ×${active.length}` : ""}`;
}

const EVENTS_MAX_BYTES = 256 * 1024;

/**
 * Appends one transition to ~/.vibeaudio/events.jsonl, after the session file
 * already reflects it, so `status` is the state the event left behind. Not
 * gated by a mute: a mute silences sound, and a light watching this is not
 * sound. Rotated to `.1` rather than trimmed in place, so a follower sees a
 * fresh file instead of re-reading the lines a trim kept. Never throws.
 */
function emitEvent(event, session, project, extra = {}) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    try {
      if (fs.statSync(EVENTS_FILE).size > EVENTS_MAX_BYTES) fs.renameSync(EVENTS_FILE, `${EVENTS_FILE}.1`);
    } catch (e) { /* no file yet */ }
    const line = { v: 1, at: Date.now(), event, session, project: project || null, ...extra, status: agentState().status };
    fs.appendFileSync(EVENTS_FILE, `${JSON.stringify(line)}\n`); // One write under PIPE_BUF: appends do not interleave.
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * `vibe --events`: the current state as one line, then every event as it is
 * written, until killed. Polled rather than fs.watch'd, which is unreliable on
 * the platforms this runs on; a quarter second is well inside a turn.
 */
function followEvents(write = (s) => process.stdout.write(s), pollMs = 250) {
  write(`${JSON.stringify({ event: "state", at: Date.now(), ...agentState() })}\n`);
  const stat = () => {
    try {
      const st = fs.statSync(EVENTS_FILE);
      return { size: st.size, ino: st.ino };
    } catch (e) {
      return { size: 0, ino: null };
    }
  };
  let { size: pos, ino } = stat();
  let partial = "";
  return setInterval(() => {
    const now = stat();
    if (now.ino !== ino || now.size < pos) {
      ino = now.ino; // Rotated: the new file holds only what came after.
      pos = 0;
      partial = "";
    }
    if (now.size <= pos) return;
    try {
      const fd = fs.openSync(EVENTS_FILE, "r");
      const buf = Buffer.alloc(now.size - pos);
      fs.readSync(fd, buf, 0, buf.length, pos);
      fs.closeSync(fd);
      pos = now.size;
      const lines = (partial + buf.toString("utf8")).split("\n");
      partial = lines.pop();
      for (const l of lines) if (l) write(`${l}\n`);
    } catch (e) { /* removed between stat and open: next poll */ }
  }, pollMs);
}

// Claude Code's entry for Esc / the stop button: a user message whose text is
// "[Request interrupted by user]" or "... for tool use]".
const INTERRUPT_MARK = "[Request interrupted by user";
const BLOCKED_MARK = "UserPromptSubmit operation blocked by hook";

function isInterruptEntry(line) {
  if (!line.includes(INTERRUPT_MARK) && !line.includes(BLOCKED_MARK)) return false; // Cheap filter before parsing.
  try {
    const entry = JSON.parse(line);
    // A prompt another hook blocked: hooks run side by side, so ours had already
    // started the music, and no Stop will ever follow. The turn is over before
    // it began, which is the same silent end as an interrupt.
    if (entry.type === "system" && typeof entry.content === "string") return entry.content.startsWith(BLOCKED_MARK);
    if (entry.type !== "user" || !entry.message) return false;
    // Structural, not substring: a transcript that merely quotes the phrase -
    // in a tool result, a file, a prompt about this very feature - is not one.
    const content = entry.message.content;
    const texts = typeof content === "string"
      ? [content]
      : Array.isArray(content) ? content.filter((b) => b && b.type === "text").map((b) => b.text) : [];
    return texts.some((t) => typeof t === "string" && t.startsWith(INTERRUPT_MARK));
  } catch (e) {
    return false;
  }
}

/**
 * Interrupting Claude Code (Esc in the terminal, stop in the desktop app or an
 * IDE) fires no hook at all - not Stop, not StopFailure, and mid-tool only a
 * plain PostToolUse. What it always does is append an interrupt entry to the
 * transcript. Returns a poll that reads only what was appended since `offset`
 * and reports whether one arrived.
 */
function interruptWatcher(transcript, offset) {
  const { StringDecoder } = require("string_decoder");
  const decoder = new StringDecoder("utf8"); // A read can split a multibyte character.
  let pos = offset;
  let partial = "";

  return () => {
    try {
      const size = fileSize(transcript);
      if (size <= pos) return false;
      const fd = fs.openSync(transcript, "r");
      const buf = Buffer.alloc(size - pos);
      try {
        fs.readSync(fd, buf, 0, buf.length, pos);
      } finally {
        fs.closeSync(fd);
      }
      pos = size;
      const lines = (partial + decoder.write(buf)).split("\n");
      partial = lines.pop(); // Not a whole line yet.
      return lines.some(isInterruptEntry);
    } catch (e) {
      return false; // Unreadable transcript: the MAX_DAEMON_MS ceiling still applies.
    }
  };
}

const INTERRUPT_POLL_MS = 500;

/**
 * Internal mode: plays while any session is working. The player's own loop
 * timer keeps the event loop alive.
 */
function runDaemon(genre, volume, { reactive = false, volumeSource = null } = {}) {
  const watchers = new Map(); // session id -> its transcript poll

  // Drops sessions whose transcript shows an interrupt (Esc fires no hook, so
  // this is the only way to learn of one) and says whether any is still working.
  const sweep = () => {
    const sessions = listSessions();
    for (const id of watchers.keys()) if (!sessions.some((s) => s.id === id)) watchers.delete(id);
    for (const s of sessions) {
      if (!s.transcript) continue;
      // Built from the offset taken at the prompt, so a daemon respawned mid-turn
      // still sees an interrupt that came before it.
      if (!watchers.has(s.id)) watchers.set(s.id, interruptWatcher(s.transcript, s.offset));
      if (watchers.get(s.id)()) {
        fs.rmSync(sessionFile(s.id), { force: true });
        watchers.delete(s.id);
        emitEvent("interrupted", s.id, s.project);
      }
    }
    return working(listSessions()).length > 0;
  };

  // Silent, like Ctrl+C in the wrapper: an interrupt is never reported as done.
  const endIdle = () => {
    if (readPid() === process.pid) {
      fs.rmSync(PID_FILE, { force: true });
      fs.rmSync(INTENSITY_FILE, { force: true });
    }
    process.exit(0);
  };
  if (!sweep()) endIdle(); // Already interrupted before this daemon started.

  const player = new AudioPlayer();
  const started = player.start(genre, volume, {
    intensity: reactive ? readIntensity : null,
    // The same piece with more of it, as time escalation already does: two
    // sessions working is tier 2 at least, three or more is tier 3. Read at
    // each loop boundary, so it lands cleanly and eases off as they finish.
    minTier: () => Math.min(3, working(listSessions()).length),
    // A heartbeat under the music while any working session looks stuck.
    tension: () => working(listSessions()).some(isStuck)
  });
  if (!started) process.exit(0);

  const shutdown = () => {
    player.stop({ playChime: false });
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  setTimeout(shutdown, DAEMON_CEILING_MS);

  setInterval(() => {
    // The pid file names the one daemon that owns the speakers. Two prompts
    // at once can each find none running and spawn one; the last to write the
    // file wins, and the other must not play over it (#42).
    // ponytail: up to one poll of doubled audio; claim the pid file with an
    // exclusive create before spawning if that ever matters.
    if (readPid() !== process.pid) return shutdown();
    // A volume saved while this plays reaches it now, not at the next prompt.
    if (volumeSource) player.setVolume(volumeSource());
    if (sweep()) return;
    player.stop({ playChime: false });
    endIdle();
  }, INTERRUPT_POLL_MS);
}

function daemonRunning() {
  const pid = readPid();
  return pid !== null && isOurDaemon(pid);
}

function spawnDaemon(genre, volume, reactive, follow = false) {
  const args = [CLI_ENTRY, "--daemon", "--genre", genre, "--volume", String(Math.round(volume * 100))];
  if (reactive) args.push("--reactive");
  if (follow) args.push("--follow-volume");

  const child = spawn(process.execPath, args, { detached: true, stdio: "ignore" });
  child.unref();

  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(PID_FILE, String(child.pid));
  return child.pid;
}

/**
 * A prompt. With no other session working this replaces the player, as it
 * always did, so a genre change lands on the next prompt. With one working the
 * music carries on: restarting it would cut every other session's stream.
 */
function hookStart(genre, volume, { reactive = false, turn = null, follow = false, music = true } = {}) {
  if (turn && turn.blocked) return null; // Rejected before it began: nothing to play for.
  if (turn && turn.continues) return null; // A later model call in a turn already playing.
  const id = sessionId(turn && turn.session);
  // Before the spawn: the daemon reads it on startup.
  const project = (turn && turn.project) || process.cwd();
  writeSession(id, { project, transcript: (turn && turn.transcript) || "", offset: (turn && turn.offset) || 0, waiting: null, started: Date.now(), blockedMs: 0 });
  emitEvent("started", id, project);
  if (working(listSessions()).some((s) => s.id !== id) && daemonRunning()) return readPid();

  stopDaemon({ keepSessions: true });
  fs.rmSync(INTENSITY_FILE, { force: true }); // Don't inherit the last prompt's activity
  // Signals only: the session is tracked (chimes, events and the report read
  // it) but there is no music to start. Stopping first means a switch to off
  // lands on the next prompt rather than playing until the turn ends.
  if (!music) return null;
  return spawnDaemon(genre, volume, reactive, follow);
}

/**
 * What the agent's stop event says about how the turn ended. Cursor reports
 * it in `status` ("completed", "aborted" or "error"). Claude Code's Stop
 * carries no verdict, but an API error ends the turn with StopFailure
 * *instead* of Stop, so that event is the verdict. Codex's StopRequest has
 * none, so it keeps the success chime - the alternative would be inventing a
 * failure the agent never claimed.
 */
function outcomeFromPayload(raw) {
  const payload = parsePayload(raw);
  if (payload.hook_event_name === "StopFailure") return "failure";
  const status = String(payload.status || "").toLowerCase();
  if (status === "error" || status === "aborted") return "failure";
  // Antigravity's Stop: NO_TOOL_CALL is the normal end (seen live; its docs
  // say model_stop). An error or the step limit is a turn that did not finish.
  return /error|max_steps/i.test(String(payload.terminationReason || "")) ? "failure" : "success";
}

/**
 * Reads the hook's stdin payload, then hands it on. A hook must never hang
 * the agent waiting for input that isn't coming, hence the timeout.
 */
function readPayload(done, timeoutMs = 500) {
  let raw = "";
  let settled = false;
  const collect = (chunk) => {
    raw += chunk;
  };

  const finish = () => {
    if (settled) return;
    settled = true;
    // Reading stdin resumes it, and a resumed stdin keeps the event loop
    // alive on its own. Without letting go here the hook process outlives
    // its work and sits there until the agent's own timeout kills it -
    // on every single turn.
    process.stdin.removeListener("data", collect);
    process.stdin.removeListener("end", finish);
    process.stdin.removeListener("error", finish);
    process.stdin.pause();
    done(raw);
  };

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", collect);
  process.stdin.on("end", finish);
  process.stdin.on("error", finish);
  setTimeout(finish, timeoutMs).unref();
}

/**
 * Opt-in desktop notification, for the moment a chime cannot answer "which
 * one?": with several terminals going, a sound says something finished and
 * leaves you alt-tabbing to find out what. Off by default - a banner is more
 * intrusive than a sound. Env beats the saved setting, like every other one.
 */
function notifyEnabled(env = process.env, config = loadConfig()) {
  const raw = String(env.VIBE_NOTIFY ?? config.notify ?? "").trim().toLowerCase();
  return ["1", "true", "on", "yes"].includes(raw);
}

/** The project a hook fired in: the payload's (see payloadProject), else ours. */
function projectName(dir) {
  return path.basename(String(dir).replace(/[\\/]+$/, "")) || "a session";
}

function sessionLabel(payload, cwd = process.cwd()) {
  return projectName(payloadProject(payload) || cwd);
}

/**
 * The command that shows a notification, or null where there is no built-in
 * way to (Windows, for now). Title and body travel as argv, never spliced into
 * a script string: a project directory is user-controlled text.
 */
function notifyCommand(platform, title, body) {
  if (platform === "darwin") {
    return {
      cmd: "osascript",
      args: ["-e", "on run argv", "-e", "display notification (item 1 of argv) with title (item 2 of argv)", "-e", "end run", body, title]
    };
  }
  if (platform === "linux") return { cmd: "notify-send", args: ["--", title, body] };
  return null;
}

// Detached and unref'd: the agent waits on this hook, and a missing
// osascript/notify-send (a Linux box with no notification daemon) must be
// invisible rather than an error in someone's agent.
function notify(raw, message) {
  if (!notifyEnabled() || playbackDisabled()) return false; // a mute means quiet, banners included
  const command = notifyCommand(process.platform, "VibeAudio", `${sessionLabel(parsePayload(raw))}: ${message}`);
  if (!command) return false;
  try {
    const child = spawn(command.cmd, command.args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch (e) {
    return false;
  }
}

function hookStop({ outcome = "success", volume = 0.4, chimeVolume = null, noChime = false, genre, raw = "" } = {}) {
  const id = sessionId(payloadSession(parsePayload(raw)));
  // A turn that ends while paused for the user - a denied tool that nothing
  // resumed after - still finished, so its session counts either way.
  const session = readSession(id);
  const tracked = session !== null;
  fs.rmSync(sessionFile(id), { force: true });
  if (tracked) emitEvent("finished", id, payloadProject(parsePayload(raw)) || session.project, { outcome });
  if (session && Number.isFinite(session.started)) {
    const now = Date.now();
    // A turn that ends while still paused for you has been blocked since then.
    const blockedMs = (session.blockedMs || 0) + (session.waiting != null && session.waitStart ? now - session.waitStart : 0);
    // ponytail: assumes a playback backend exists; a machine with none hears no music either.
    const chimed = !noChime && !playbackDisabled();
    recordTurn({ project: payloadProject(parsePayload(raw)) || process.cwd(), ms: now - session.started, blockedMs, outcome, session: id, chimed, at: now });
  }

  // The music is every working session's, so it ends with the last of them.
  // Everyone else's carries on, and this session still gets its own chime.
  const others = working(listSessions()).length > 0;
  const wasPlaying = others ? false : stopDaemon({ keepSessions: true });
  if (!others) fs.rmSync(INTENSITY_FILE, { force: true });
  if (!(tracked || wasPlaying)) return false;
  notify(raw, outcome === "failure" ? "failed" : "finished");
  if (noChime) return false;

  // Chime plays in this short-lived hook process.
  new AudioPlayer().stop({ playChime: true, outcome, volume, chimeVolume, genre });
  return true;
}

/**
 * What a wait is waiting for, and what ends it: the tool's name for a
 * permission dialog and its PostToolUse, the server's name for an MCP
 * elicitation and its ElicitationResult. PermissionRequest carries no
 * tool_use_id, hence names.
 */
function waitKey(raw) {
  const server = parsePayload(raw).mcp_server_name;
  return payloadToolName(raw) || (server ? `mcp:${server}` : "");
}

// Notification types that mean "blocked on the user". Agents whose permission
// dialog is a Notification send every other kind through the same event.
const WAIT_NOTIFICATIONS = new Set([
  "permission_prompt", // Copilot CLI
  "elicitation_dialog", // Copilot CLI
  "ToolPermission" // Gemini CLI
]);

/**
 * The agent is blocked on the user (a permission dialog, a question, a plan to
 * approve, an MCP server asking for input). Music that keeps playing says
 * "still working", which is the one thing that is not true, so it stops and
 * the attention chime asks instead - unless another session is still working,
 * whose music is not this dialog's to end.
 *
 * Only for a turn in flight: after it has ended there is nobody to interrupt,
 * and a second dialog while already waiting keeps the first wait rather than
 * chiming twice.
 *
 * The chime is detached: the agent waits on this hook before showing the
 * dialog, and a chime played to completion here held it back for its length.
 */
function hookWait(raw, { volume = 0.4, chimeVolume = null, noChime = false } = {}) {
  const payload = parsePayload(raw);
  const type = payload.notification_type ?? payload.notificationType;
  if (type !== undefined && !WAIT_NOTIFICATIONS.has(String(type))) return false;

  const id = sessionId(payloadSession(payload));
  const session = readSession(id);
  if (!session || session.waiting != null) return false;

  writeSession(id, { ...session, waiting: waitKey(raw), waitStart: Date.now() });
  emitEvent("waiting", id, session.project, waitKey(raw) ? { tool: waitKey(raw) } : {});
  if (working(listSessions()).length === 0) stopDaemon({ keepSessions: true });
  const tool = payloadToolName(raw);
  notify(raw, tool ? `needs you (${tool})` : "needs you");
  if (!noChime) new AudioPlayer().stop({ playChime: true, outcome: "attention", volume, chimeVolume, detach: true });
  return true;
}

/**
 * A tool call or an elicitation has ended. Nothing fires on an approval
 * itself, so this is the first signal that work carries on after one - resume,
 * if it is the one being waited for.
 *
 * The session keeps its transcript offset from the prompt, so an approved tool
 * interrupted with Esc, which still fires this PostToolUse, is seen by the
 * daemon and must not bring the music back.
 *
 * ponytail: matching by name means two same-named tools in one parallel batch,
 * one needing approval, can resume early - after the chime already did its
 * job. Match on tool_input as well if that ever shows up in practice.
 */
function hookResume(raw, genre, volume, { reactive = false, follow = false, music = true, chimeVolume = null, noChime = false } = {}) {
  const payload = parsePayload(raw);
  const id = sessionId(payloadSession(payload));
  const session = readSession(id);
  if (!session) return false;

  // Every tool call lands here, so this is where the stuck signal is kept.
  // An interrupt is the user stopping a tool, not the tool failing.
  // ponytail: two parallel tool calls in one session can each read, then write,
  // and one result is lost. A heuristic over eight calls survives that.
  const failed = payload.hook_event_name === "PostToolUseFailure" && !payload.is_interrupt;
  const recent = [...(session.recent || []), failed ? 1 : 0].slice(-STUCK_WINDOW);
  const next = { ...session, recent };
  const crossing = isStuck(next) === isStuck(session) ? null : isStuck(next) ? "stuck" : "recovered";
  if (crossing === "stuck") {
    notify(raw, `looks stuck - ${STUCK_FAILURES} of its last ${STUCK_WINDOW} tool calls failed`);
    // With music on the daemon adds the heartbeat; with it off there is no
    // loop to put one under, so the pulse plays once on its own. Detached: the
    // agent waits on this hook.
    if (!music && !noChime) new AudioPlayer().stop({ playChime: true, outcome: "stuck", volume, chimeVolume, detach: true });
  }

  // An empty key is a wait that named nothing (a Notification): the next tool
  // to finish is the first sign of work carrying on.
  const resumes = session.waiting != null && (session.waiting === "" || session.waiting === waitKey(raw));
  if (!resumes) {
    writeSession(id, next);
    if (crossing) emitEvent(crossing, id, session.project);
    return false; // Not waiting - the common case, on every tool call.
  }

  const blockedMs = (session.blockedMs || 0) + (session.waitStart ? Date.now() - session.waitStart : 0);
  writeSession(id, { ...next, waiting: null, waitStart: null, blockedMs });
  emitEvent("resumed", id, session.project);
  if (crossing) emitEvent(crossing, id, session.project);
  if (music && !daemonRunning()) spawnDaemon(genre, volume, reactive, follow);
  return true;
}

/**
 * The agent's session is over (quit, /clear, logout). A turn cut off by it
 * never reaches Stop. Silent: nothing finished.
 *
 * Only that session's own turn ends, so one terminal closing cannot silence
 * another that is mid-turn. Fails closed on an unknown session: with none on
 * record there is nothing of its to end, and the MAX_DAEMON_MS ceiling still
 * applies.
 */
function hookEnd(raw) {
  const id = sessionId(payloadSession(parsePayload(raw)));
  const session = readSession(id);
  if (!session) return false;

  fs.rmSync(sessionFile(id), { force: true });
  emitEvent(parsePayload(raw).hook_event_name === "Interrupt" ? "interrupted" : "ended", id, session.project);
  if (working(listSessions()).length === 0) {
    stopDaemon({ keepSessions: true });
    fs.rmSync(INTENSITY_FILE, { force: true });
  }
  return true;
}

/**
 * The hook command is a string the agent hands to a shell, so every path in it
 * has to survive that shell. Double quotes do not: `$` and a backtick expand
 * inside them and a `"` ends the quote outright, so installing from a path
 * like /tmp/dollar$dir wrote a command the shell quietly rewrote into a
 * different one - and the install reported success. A hook that fails on every
 * prompt while claiming to be installed is the exact failure
 * ephemeralInstallReason() exists to prevent.
 *
 * POSIX gets single quotes, which expand nothing, plus the one escape a single
 * quote itself needs. Windows keeps double quotes: cmd expands neither `$` nor
 * a backtick, and `"` is not legal in a Windows path to begin with.
 */
function shellQuote(value) {
  if (process.platform === "win32") return `"${value}"`;
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

/**
 * Genre and volume are deliberately NOT written into the command line.
 *
 * They used to be, and that is what made "change the genre" mean "re-run the
 * installer": a value frozen into seven hook entries at install time, which no
 * later `vibe --genre jazz` and no exported variable could reach. Each hook
 * fires as a fresh process and parses its own arguments, so leaving them out
 * means it reads the saved config (see loadConfig() in player.js) on every
 * prompt - and a genre change lands on the next one, with nothing reinstalled.
 *
 * `--reactive` stays, because it is not a setting the hook reads: it decides
 * which hooks exist at all, and the PreToolUse entry is written or removed to
 * match. A daemon respawned by a resume has to know it too.
 */
function hookCommand(flag, genre, volume, reactive = false) {
  const base = `${shellQuote(process.execPath)} ${shellQuote(CLI_ENTRY)} ${flag}`;
  if (!reactive) return base;
  return flag === "--hook-start" || flag === "--hook-resume" ? `${base} --reactive` : base;
}

const VIBE_HOOK_FLAG = /--hook-(start|stop|tool|wait|resume|end)\b/;

function isVibeHook(entry, id = "claude") {
  return target(id)
    .commands(entry)
    .some((c) => typeof c === "string" && VIBE_HOOK_FLAG.test(c));
}

function setHook(hooks, event, command, id) {
  // Replacing our own entries keeps repeat installs idempotent and leaves
  // every other tool's hooks untouched. Appending rather than prepending also
  // keeps the existing entries at their original index, which is what Codex
  // keys its per-hook trust records by.
  const kept = (hooks[event] || []).filter((entry) => !isVibeHook(entry, id));
  kept.push(target(id).entry(command, event));
  hooks[event] = kept;
}

/**
 * The object holding a target's events inside its config file: `hooks` for
 * every agent but Antigravity, whose file is a map of named hooks and keeps
 * ours under a name of their own (`hooksKey`).
 */
function hooksKey(t) {
  return (t && t.hooksKey) || "hooks";
}

function hooksOf(settings, t) {
  return settings ? settings[hooksKey(t)] : undefined;
}

/** [event, entries] for every event in a hooks object, skipping settings keys. */
function hookEntries(hooks, t) {
  const configKeys = (t && t.configKeys) || [];
  return Object.entries(hooks || {}).filter(([key]) => !configKeys.includes(key));
}

function readVibeEntryCount(file, id) {
  try {
    const { settings } = loadSettings(file, target(id));
    return hookEntries(hooksOf(settings, target(id)), target(id)).reduce(
      (n, [, entries]) => n + entries.filter((e) => isVibeHook(e, id)).length,
      0
    );
  } catch (e) {
    return 0; // Unreadable: the delete below still cleans it up.
  }
}

/** True when --install-hooks has already written our entries for Claude Code. */
function userHooksInstalled(file = null, id = "claude") {
  return readVibeEntryCount(file || TARGETS[id].file(), id) > 0;
}

function loadSettings(file, t = null) {
  if (!fs.existsSync(file)) return { settings: t ? t.seed() : {}, raw: null };
  const raw = fs.readFileSync(file, "utf8");

  let settings;
  try {
    settings = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${file} is not valid JSON (${e.message}) — refusing to overwrite it.`);
  }

  // Valid JSON in the wrong shape used to reach the callers and fail there as
  // "entries.filter is not a function", which tells the user nothing about
  // their own file. Checked here because install, uninstall and the entry
  // count all come through this function.
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error(`${file} does not contain a JSON object — refusing to overwrite it.`);
  }
  const key = hooksKey(t);
  if (settings[key] !== undefined) {
    if (settings[key] === null || typeof settings[key] !== "object" || Array.isArray(settings[key])) {
      throw new Error(`${file} has a "${key}" key that is not an object — refusing to overwrite it.`);
    }
    for (const [event, entries] of hookEntries(settings[key], t)) {
      if (!Array.isArray(entries)) {
        throw new Error(
          `${file} has ${key}.${event} as ${Array.isArray(entries) ? "an array" : typeof entries}, ` +
          `not an array of entries — refusing to overwrite it.`
        );
      }
    }
  }

  return { settings, raw };
}

/**
 * Hooks record an absolute path to this CLI, so installing from a throwaway
 * `npx` checkout writes a path npm will eventually evict — leaving every
 * prompt firing a hook that silently fails. Refuse rather than plant that.
 */
function ephemeralInstallReason(entry = CLI_ENTRY) {
  const dir = entry.split(path.sep);
  if (dir.includes("_npx")) return "npx";
  if (dir.includes(".npm-cache") || dir.includes("_cacache")) return "npm cache";
  return null;
}

/**
 * `dryRun` computes the result without touching the disk - no directory, no
 * backup, no write - and returns it with the file's current contents, so the
 * caller can show exactly what would change in a file that belongs to the user.
 */
function installHooks(genre = "lofi", volume = 0.4, file = null, { reactive = false, id = "claude", dryRun = false } = {}) {
  const t = target(id);
  file = file || t.file();
  const ephemeral = ephemeralInstallReason();
  if (ephemeral) {
    throw new Error(
      `refusing to install hooks from a temporary ${ephemeral} checkout — the path ` +
      `(${CLI_ENTRY}) is deleted when the cache is cleared, which would leave Claude Code ` +
      `running a broken hook on every prompt.\n\n` +
      `Install it for real first, then re-run:\n\n` +
      `  npm i -g github:kiril6/vibeaudio\n  vibe --install-hooks\n`
    );
  }

  const { settings, raw } = loadSettings(file, t);
  if (!dryRun) fs.mkdirSync(path.dirname(file), { recursive: true });
  let backup = null;
  // Only worth backing up a file that holds someone else's config. A dedicated
  // target's file is ours alone, so a backup of it would just be a copy of our
  // own last install, left behind after the uninstall deletes the original.
  //
  // Written once and never overwritten: the second --install-hooks reads a
  // file that already contains our entries, so re-backing up would replace the
  // user's actual pre-VibeAudio config with a copy of our own last install -
  // while uninstall goes on calling it "your pre-VibeAudio config backup".
  // The first one is the only one that is true.
  if (raw !== null && !t.dedicated) {
    const backupFile = `${file}.vibeaudio.bak`;
    if (!fs.existsSync(backupFile)) {
      if (!dryRun) fs.writeFileSync(backupFile, raw);
      backup = backupFile;
    }
  }

  const ev = t.events;
  // Reactive needs a pre-tool event we can listen on without deciding for the
  // agent; where there is none (Antigravity) it is off, not carried as a flag
  // that does nothing and that --status would then report.
  reactive = reactive && Boolean(ev.tool);
  const key = hooksKey(t);
  settings[key] = settings[key] || {};
  const hooks = settings[key];
  setHook(hooks, ev.start, hookCommand("--hook-start", genre, volume, reactive), id);
  setHook(hooks, ev.stop, hookCommand("--hook-stop", genre, volume), id);

  // Only reactive mode needs per-tool-call signalling.
  if (reactive) {
    setHook(hooks, ev.tool, hookCommand("--hook-tool", genre, volume), id);
  } else if (ev.tool && hooks[ev.tool]) {
    const kept = hooks[ev.tool].filter((entry) => !isVibeHook(entry, id));
    if (kept.length) hooks[ev.tool] = kept;
    else delete hooks[ev.tool];
  }

  for (const event of ev.wait || []) {
    setHook(hooks, event, hookCommand("--hook-wait", genre, volume), id);
  }
  // The agent awaits a resume before the next tool's permission check, so a
  // resume can never land after the next wait.
  // ponytail: one ~40ms node start per tool call; a shell-side existence
  // check on the waiting file would skip it if that ever shows.
  for (const event of ev.resume || []) {
    setHook(hooks, event, hookCommand("--hook-resume", genre, volume, reactive), id);
  }
  if (ev.failure) setHook(hooks, ev.failure, hookCommand("--hook-stop", genre, volume), id);
  if (ev.end) setHook(hooks, ev.end, hookCommand("--hook-end", genre, volume), id);
  // An interrupt ends the turn the same silent way a closed session does.
  if (ev.interrupt) setHook(hooks, ev.interrupt, hookCommand("--hook-end", genre, volume), id);

  const after = `${JSON.stringify(settings, null, 2)}\n`;
  if (!dryRun) fs.writeFileSync(file, after);
  return { file, backup, reactive, id, name: t.name, note: t.note || null, events: ev, before: raw, after, dryRun };
}

/**
 * `/vibe` inside Claude Code: a command file, not a hook - it asks the model to
 * run the CLI, so mute, stop and genre changes need no second terminal. The
 * marker is how install and uninstall tell our file from a user's own vibe.md,
 * which neither may overwrite or delete.
 */
const SLASH_MARK = "<!-- vibeaudio:slash-command -->";

function slashCommandFile() {
  return path.join(claudeConfigDir(), "commands", "vibe.md");
}

function slashCommandText() {
  const cli = `${shellQuote(process.execPath)} ${shellQuote(CLI_ENTRY)}`;
  return `---
description: Control VibeAudio - status, mute, unmute, stop, or change genre or volume
argument-hint: "[status | mute [minutes] | unmute | stop | genre <name> | volume <5-100>]"
---
${SLASH_MARK}
Control VibeAudio, the focus music that plays while you work, for the user.
Arguments: \`$ARGUMENTS\`

Run the one matching command with the Bash tool, then report the result in a
single short sentence. Do nothing else.

- no arguments, or \`status\`: \`${cli} --status\`
- \`mute\` or \`mute <minutes>\`: \`${cli} --mute <minutes>\`
- \`unmute\`: \`${cli} --unmute\`
- \`stop\`: \`${cli} --stop\`
- \`genre <name>\`: \`${cli} --genre <name>\`
- \`volume <5-100>\`: \`${cli} --volume <n>\`
  Both save the user's default and reach the hooks on the next prompt - there
  is nothing to reinstall, so do not run --install-hooks for these.
  Genres: lofi, synthwave, 8bit, electronic, jazz, zen, piano, drone, rain, ocean, random.

For anything else, show the user the list above instead of running a command.
`;
}

function installSlashCommand({ file = slashCommandFile(), dryRun = false } = {}) {
  if (fs.existsSync(file) && !fs.readFileSync(file, "utf8").includes(SLASH_MARK)) {
    return { file, installed: false, reason: "a vibe.md that is not ours is already there" };
  }
  if (!dryRun) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, slashCommandText());
  }
  return { file, installed: true };
}

function uninstallSlashCommand({ file = slashCommandFile() } = {}) {
  if (!fs.existsSync(file) || !fs.readFileSync(file, "utf8").includes(SLASH_MARK)) return false;
  fs.rmSync(file, { force: true });
  return true;
}

function uninstallHooks(file = null, { id = "claude" } = {}) {
  const t = target(id);
  file = file || t.file();
  if (!fs.existsSync(file)) return { file, removed: 0, id };

  // Our own file has nothing of the user's in it, so removing our entries
  // would just leave an empty husk in a directory the tool scans.
  if (t.dedicated) {
    const removed = readVibeEntryCount(file, id);
    fs.rmSync(file, { force: true });
    return { file, removed, id };
  }

  const { settings } = loadSettings(file, t);
  const key = hooksKey(t);
  const hooks = settings[key];
  if (!hooks) return { file, removed: 0, id };

  let removed = 0;
  for (const [event, entries] of hookEntries(hooks, t)) {
    const kept = entries.filter((entry) => !isVibeHook(entry, id));
    removed += entries.length - kept.length;

    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }

  if (Object.keys(hooks).length === 0) delete settings[key];
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  return { file, removed, id };
}

module.exports = {
  shellQuote,
  claudeConfigDir,
  codexHome,
  geminiDir,
  qwenHome,
  grokHome,
  expectedEvents,
  PLUGIN_FILES,
  PLUGIN_AGENTS,
  pluginHookEvents,
  pluginHooksFile,
  pluginAgent,
  runDaemon,
  hookStart,
  hookStop,
  hookTool,
  hookWait,
  hookResume,
  isStuck,
  STUCK_WINDOW,
  agentState,
  formatStatusline,
  followEvents,
  EVENTS_FILE,
  hookEnd,
  newTurn,
  outcomeFromPayload,
  notifyEnabled,
  notifyCommand,
  sessionLabel,
  readPayload,
  toolTier,
  readIntensity,
  stopDaemon,
  isOurDaemon,
  daemonPlaying,
  installHooks,
  ephemeralInstallReason,
  uninstallHooks,
  settingsPath,
  isVibeHook,
  userHooksInstalled,
  hookEntries,
  hooksOf,
  installSlashCommand,
  uninstallSlashCommand,
  VIBE_HOOK_FLAG,
  TARGETS,
  targetFile,
  detectTargets,
  PID_FILE
};
