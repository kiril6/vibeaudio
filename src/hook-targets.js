/** The agents VibeAudio hooks into (TARGETS), their config dirs, and the plugin hook files. */

const fs = require("fs");
const os = require("os");
const path = require("path");

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
    note: "Codex asks you to trust each new hook once — in the desktop app via Review hooks in the composer (Allow all), in the CLI the first time each fires."
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


module.exports = { claudeConfigDir, codexHome, geminiDir, qwenHome, grokHome, TARGETS, target, targetFile, detectTargets, expectedEvents, PLUGIN_FILES, PLUGIN_AGENTS, SLOT_ACTION, pluginHookEvents, pluginHooksFile, pluginAgent };
