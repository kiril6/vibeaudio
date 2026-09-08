/**
 * Interactive Terminal Menu for VibeAudio
 * Zero dependencies - Pure Node.js ANSI and Readline
 */

const { execSync } = require("child_process");
const readline = require("readline");

function isInstalled(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch (e) {
    return false;
  }
}

const AI_TOOLS = [
  { name: "Claude Code", cmd: ["claude"], check: "claude" },
  { name: "Gemini CLI", cmd: ["gemini"], check: "gemini" },
  { name: "Codex CLI", cmd: ["codex"], check: "codex" },
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

function promptCustomCommand() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question("\x1b[1mEnter command to wrap with music:\x1b[0m ", (answer) => {
      rl.close();
      const parts = answer.trim().split(/\s+/).filter(Boolean);
      resolve(parts.length > 0 ? parts : ["echo", "No command specified"]);
    });
  });
}

async function promptInteractive() {
  console.log(`\n\x1b[1m\x1b[35m🎧 VibeAudio — Interactive AI Launcher\x1b[0m\n`);

  // 1. Select AI Tool
  const toolsWithStatus = AI_TOOLS.map((t) => ({
    ...t,
    installed: t.check ? isInstalled(t.check) : null
  }));

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

  // 2. Select Music Genre
  const selectedGenre = await selectMenu(
    "Choose your sound vibe:",
    GENRES,
    (item, num) => `${num}. ${item.name} \x1b[90m— ${item.desc}\x1b[0m`
  );

  return {
    cmd: finalCmd,
    genre: selectedGenre.id
  };
}

module.exports = { promptInteractive };
