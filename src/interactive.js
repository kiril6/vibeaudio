/**
 * Interactive Terminal Menu for VibeAudio
 * Zero dependencies - Pure Node.js ANSI and Readline
 */

const { execSync } = require("child_process");
const readline = require("readline");

// Windows has no `which`; without this every tool shows as missing there.
const LOOKUP_CMD = process.platform === "win32" ? "where" : "which";

function isInstalled(cmd) {
  try {
    execSync(`${LOOKUP_CMD} ${cmd}`, { stdio: "ignore" });
    return true;
  } catch (e) {
    return false;
  }
}

// Convenience only - the wrapper runs any command, and "Custom command..."
// is the escape hatch for anything not listed. Entries are sorted so what is
// actually installed floats to the top, which is what lets this list grow
// without turning into a wall of things the user does not have.
const AI_TOOLS = [
  { name: "Claude Code", cmd: ["claude"], check: "claude" },
  { name: "Gemini CLI", cmd: ["gemini"], check: "gemini" },
  { name: "Codex CLI", cmd: ["codex"], check: "codex" },
  { name: "GitHub Copilot CLI", cmd: ["copilot"], check: "copilot" },
  { name: "Aider", cmd: ["aider"], check: "aider" },
  { name: "Ollama (Llama 3)", cmd: ["ollama", "run", "llama3"], check: "ollama" },
  { name: "Custom command...", cmd: null }
];

const GENRES = [
  { name: "☕ Lo-Fi Focus", desc: "Warm Rhodes electric piano & Kalimba drops", id: "lofi" },
  { name: "🌌 Chill Synthwave", desc: "'80s analog chorused pads & pulsing bass", id: "synthwave" },
  { name: "🕹️ Cozy 8-Bit", desc: "Filtered retro chiptune arpeggios", id: "8bit" },
  { name: "⚡ Melodic Electronic", desc: "Downtempo resonant plucks & tech pulse", id: "electronic" },
  { name: "🎷 Midnight Jazz", desc: "ii-V-I piano chords & walking upright bass", id: "jazz" },
  { name: "🎋 Zen Ambient", desc: "Meditative singing bowls & floating celestial pads", id: "zen" },
  { name: "🌫️ Deep Drone", desc: "Held tone & filtered noise — no melody at all", id: "drone" },
  { name: "🎲 Shuffle / Random", desc: "Picks a surprise vibe each time", id: "random" }
];

function selectMenu(title, items, renderItem) {
  return new Promise((resolve) => {
    let selected = 0;
    const stdin = process.stdin;
    const stdout = process.stdout;

    if (!stdin.isTTY) {
      // Fallback if not an interactive terminal
      resolve(items[0]);
      return;
    }

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    function render(firstTime = false) {
      if (!firstTime) {
        // Move cursor up to overwrite previous menu
        stdout.write(`\u001b[${items.length + 1}A`);
      }

      stdout.write(`\r\x1b[1m\x1b[36m${title}\x1b[0m\x1b[K\n`);
      for (let i = 0; i < items.length; i++) {
        const isSel = i === selected;
        const prefix = isSel ? "\x1b[32m❯ \x1b[1m" : "  \x1b[2m";
        const suffix = "\x1b[0m\x1b[K\n";
        stdout.write(`${prefix}${renderItem(items[i], i + 1, isSel)}${suffix}`);
      }
    }

    render(true);

    function onData(key) {
      if (key === "\u0003") {
        // Ctrl+C
        cleanup();
        process.exit(0);
      }

      if (key === "\u001b[A") {
        // Up arrow
        selected = (selected - 1 + items.length) % items.length;
        render();
      } else if (key === "\u001b[B") {
        // Down arrow
        selected = (selected + 1) % items.length;
        render();
      } else if (key === "\r" || key === "\n") {
        // Enter
        cleanup();
        stdout.write("\n");
        resolve(items[selected]);
      } else {
        // Direct number selection 1..9
        const num = parseInt(key, 10);
        if (!isNaN(num) && num >= 1 && num <= items.length) {
          selected = num - 1;
          cleanup();
          render();
          stdout.write("\n");
          resolve(items[selected]);
        }
      }
    }

    function cleanup() {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    }

    stdin.on("data", onData);
  });
}

/**
 * Splits a command line into argv, keeping quoted arguments intact so
 * `claude --append-system-prompt "be brief"` stays three tokens, not four.
 * Tokens are passed to spawn() as argv, never through a shell.
 */
function tokenizeCommand(input) {
  const tokens = [];
  let current = "";
  let started = false;
  let quote = null;

  for (const ch of input.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) {
        tokens.push(current);
        current = "";
        started = false;
      }
    } else {
      current += ch;
      started = true;
    }
  }

  if (started) tokens.push(current);
  return tokens;
}

function promptCustomCommand() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question("\x1b[1mEnter command to wrap with music:\x1b[0m ", (answer) => {
      rl.close();
      const parts = tokenizeCommand(answer);
      resolve(parts.length > 0 ? parts : ["echo", "No command specified"]);
    });
  });
}

const VOLUMES = [
  { name: "☕ Normal (40%)", desc: "Balanced focus background [Default]", vol: 0.40 },
  { name: "🤫 Quiet (25%)", desc: "Discreet focus / open office", vol: 0.25 },
  { name: "🌙 Whisper (15%)", desc: "Ultra-gentle / headphones / late night", vol: 0.15 },
  { name: "📢 Loud (75%)", desc: "Audible across the room", vol: 0.75 }
];

// Claude Code is the only tool VibeAudio installs hooks for today, so it is
// the only one where the menu has a real choice to offer. (Codex has its own
// hook system we don't write to yet - extend HOOK_TOOL when that lands.)
const HOOK_TOOL = "claude";

const DELIVERY_FRESH = [
  {
    id: "hooks",
    name: "Claude Code hooks",
    desc: "Music follows the agent's thinking. Set once, works with plain `claude`"
  },
  {
    id: "wrapper",
    name: "This session only",
    desc: "Music plays while the process lives - fine for one-shot commands"
  }
];

// With hooks already installed, the wrapper plays nothing for an interactive
// claude - so offering "this session only" would be offering silence. The
// honest second option is to just launch, and to stop asking for a genre and
// volume the hooks are going to ignore.
const DELIVERY_INSTALLED = [
  {
    id: "launch",
    name: "Just launch Claude Code",
    desc: "Your installed hooks already handle the music"
  },
  {
    id: "hooks",
    name: "Reconfigure the hooks",
    desc: "Pick a new genre, volume or reactive setting"
  }
];

const REACTIVE = [
  { id: false, name: "Steady (recommended)", desc: "Intensity follows elapsed time, and stays ignorable" },
  { id: true, name: "Reactive", desc: "Intensity follows the tool in use - noticeable, by design" }
];

async function promptInteractive({ hooksInstalled = false } = {}) {
  console.log(`\n\x1b[1m\x1b[35m🎧 VibeAudio — Interactive AI Launcher\x1b[0m\n`);

  // 1. Select AI Tool
  const toolsWithStatus = AI_TOOLS.map((t) => ({
    ...t,
    installed: t.check ? isInstalled(t.check) : null
  }));

  // Installed tools first, "Custom command..." last, each group keeping the
  // order above. A stable sort is required for that, which Node guarantees.
  const rank = (t) => (t.installed === true ? 0 : t.installed === false ? 1 : 2);
  toolsWithStatus.sort((a, b) => rank(a) - rank(b));

  const selectedTool = await selectMenu(
    "Which AI companion would you like to launch?",
    toolsWithStatus,
    (item, num) => {
      const status = item.installed === true ? " \x1b[32m[✓ installed]\x1b[0m" : item.installed === false ? " \x1b[90m(not found in PATH)\x1b[0m" : "";
      return `${num}. ${item.name}${status}`;
    }
  );

  let finalCmd = selectedTool.cmd;
  if (!finalCmd) {
    finalCmd = await promptCustomCommand();
  }

  // 2. How should the music be delivered?
  // Without this the menu asks for a genre and volume that installed hooks
  // then ignore - three questions asked, one honoured.
  let delivery = "wrapper";
  if (selectedTool.check === HOOK_TOOL) {
    const chosen = await selectMenu(
      hooksInstalled ? "Hooks are already installed. What now?" : "How should the music run?",
      hooksInstalled ? DELIVERY_INSTALLED : DELIVERY_FRESH,
      (item, num) => `${num}. ${item.name} \x1b[90m— ${item.desc}\x1b[0m`
    );
    delivery = chosen.id;
  }

  // Nothing downstream reads a genre or volume on this path, so don't ask for one.
  if (delivery === "launch") {
    return { cmd: finalCmd, installHooks: false, reactive: false };
  }

  // 3. Select Music Genre
  const selectedGenre = await selectMenu(
    "Choose your sound vibe:",
    GENRES,
    (item, num) => `${num}. ${item.name} \x1b[90m— ${item.desc}\x1b[0m`
  );

  // 4. Select Volume Preset
  const selectedVolume = await selectMenu(
    "Choose your volume level:",
    VOLUMES,
    (item, num) => `${num}. ${item.name} \x1b[90m— ${item.desc}\x1b[0m`
  );

  // 5. Reactive is a hooks-only feature, so only offer it on that branch -
  // a control that does nothing is worse than no control.
  let reactive = false;
  if (delivery === "hooks") {
    const chosen = await selectMenu(
      "Should the music react to what the agent is doing?",
      REACTIVE,
      (item, num) => `${num}. ${item.name} \x1b[90m— ${item.desc}\x1b[0m`
    );
    reactive = chosen.id;
  }

  return {
    cmd: finalCmd,
    genre: selectedGenre.id,
    volume: selectedVolume.vol,
    installHooks: delivery === "hooks",
    reactive
  };
}

module.exports = { promptInteractive, tokenizeCommand, isInstalled };
