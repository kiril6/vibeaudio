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
 *
 * hooks.js is the public surface; the code lives in hook-*.js, split by layer.
 */

const { shellQuote, modInstalled, installHooks, ephemeralInstallReason, uninstallHooks, isVibeHook, userHooksInstalled, hookEntries, hooksOf, installSlashCommand, uninstallSlashCommand, AGENT_SKILLS, installAgentSkill, uninstallAgentSkill, VIBE_HOOK_FLAG } = require("./hook-install");
const { claudeConfigDir, codexHome, geminiDir, qwenHome, grokHome, expectedEvents, PLUGIN_FILES, PLUGIN_AGENTS, pluginHookEvents, pluginHooksFile, pluginAgent, TARGETS, targetFile, detectTargets } = require("./hook-targets");
const { announce, announceEnabled, ANNOUNCE_OUTCOMES, ANNOUNCE_MAX_CHARS, hookStop, hookWait, hookResume, resumeAfterUnmute, applyLiveMusic, hookEnd, outcomeFromPayload, notifyEnabled, notifyCommand, sessionLabel, readPayload } = require("./hook-handlers");
const { recentEvents, emitEvent, runDaemon, hookStart, isStuck, STUCK_WINDOW, agentState, formatStatusline, explainMusic, followEvents, newTurn, stopDaemon, isOurDaemon, daemonPlaying, settingsPath } = require("./hook-state");
const { hookTool, EVENTS_FILE, toolTier, readIntensity, PID_FILE } = require("./hook-core");

module.exports = {
  shellQuote,
  claudeConfigDir,
  modInstalled,
  codexHome,
  geminiDir,
  qwenHome,
  grokHome,
  announce,
  announceEnabled,
  recentEvents,
  emitEvent,
  ANNOUNCE_OUTCOMES,
  ANNOUNCE_MAX_CHARS,
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
  resumeAfterUnmute,
  applyLiveMusic,
  isStuck,
  STUCK_WINDOW,
  agentState,
  formatStatusline,
  explainMusic,
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
  AGENT_SKILLS,
  installAgentSkill,
  uninstallAgentSkill,
  VIBE_HOOK_FLAG,
  TARGETS,
  targetFile,
  detectTargets,
  PID_FILE,
};
