/**
 * Model Context Protocol (MCP) Stdio Server
 * Connects VibeAudio to clients with no hook system (Claude Desktop, Antigravity,
 * Gemini CLI). Claude Code, Codex and Cursor have hooks — use those instead.
 * Zero dependencies - Pure Node.js JSON-RPC 2.0 over Stdio
 */

const readline = require("readline");
const { AudioPlayer, AVAILABLE_GENRES, normalizeVolume } = require("./player");
const pkg = require("../package.json");

// A desktop client that crashes never sends vibe_stop, so playback needs its
// own ceiling rather than looping forever.
const MAX_PLAYBACK_MS = 15 * 60 * 1000;

const TOOLS = [
  {
    name: "vibe_play",
    description:
      "Start background focus music for the user while you work. Call this at the " +
      "START of a task you expect to take more than a few seconds - multi-step work, " +
      "long file edits, repeated tool calls, anything the user will wait through. " +
      "Always pair it with vibe_stop when the task resolves. Skip it for quick " +
      "answers: music around a one-second reply is worse than silence.",
    inputSchema: {
      type: "object",
      properties: {
        genre: {
          type: "string",
          description: "Music genre: lofi, synthwave, 8bit, electronic, jazz, zen, piano (sparse), drone (no melody), or random",
          enum: [...AVAILABLE_GENRES, "random"]
        },
        volume: {
          type: "number",
          description: "Playback volume from 5 to 100 (default: 40)",
          minimum: 5,
          maximum: 100
        }
      }
    }
  },
  {
    name: "vibe_stop",
    description:
      "Stop the focus music and play a completion chime. Call this as soon as the " +
      "task resolves and you are ready to hand back a result, including when it " +
      "failed - pass outcome 'failure' so the chime says so. Never leave music " +
      "playing after a vibe_play task is done.",
    inputSchema: {
      type: "object",
      properties: {
        outcome: {
          type: "string",
          description: "Resolution outcome: 'success' (ascending chime) or 'failure' (soft minor tone)",
          enum: ["success", "failure"]
        },
        playChime: {
          type: "boolean",
          description: "Whether to play the completion chime (default: true)"
        }
      }
    }
  },
  {
    name: "vibe_status",
    description:
      "Check whether focus music is currently playing, and in which genre and " +
      "intensity tier. Use it to avoid starting a second track, or to confirm " +
      "nothing was left running.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  }
];

function handleMessage(player, msg) {
  const { id, method, params } = msg;

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: "vibeaudio",
          version: pkg.version
        },
        // Unlike the CLI's hooks, nothing fires these tools automatically - the
        // model has to choose to. Without a nudge the server just sits idle, so
        // state the intended usage pattern where the client will surface it.
        instructions:
          "VibeAudio plays background focus music while the user waits on long work.\n" +
          "Call vibe_play at the start of a task you expect to take more than a few " +
          "seconds (multi-step work, long file edits, repeated tool calls), then call " +
          "vibe_stop with outcome 'success' or 'failure' as soon as the task resolves " +
          "and you are ready to hand back a result.\n" +
          "Do not use it for quick answers - starting and stopping music around a " +
          "one-second reply is worse than silence. Leave the genre and volume alone " +
          "unless the user asks; they are the user's preference, not yours."
      }
    };
  }

  if (method === "notifications/initialized") {
    // Client acknowledgment - no response needed
    return null;
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: TOOLS
      }
    };
  }

  if (method === "tools/call") {
    const { name, arguments: args = {} } = params;

    if (name === "vibe_play") {
      const genre = args.genre || process.env.VIBE_GENRE || "lofi";
      // Both the tool argument and the env default go through the same parser
      // as the CLI, so a mistyped VIBE_VOLUME falls back instead of reaching
      // the player as NaN.
      const volume = normalizeVolume(args.volume, normalizeVolume(process.env.VIBE_VOLUME, 0.4));

      const started = player.start(genre, volume, { maxDurationMs: MAX_PLAYBACK_MS });
      const text = started
        ? `Started playing ${player.genre} procedural focus music at ${Math.round(volume * 100)}% volume.`
        : player.isPlaying
          ? `Already playing ${player.genre} at ${Math.round(player.volume * 100)}% volume — nothing changed.`
          : "No supported audio player found on this system; playback is unavailable.";

      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text }]
        }
      };
    }

    if (name === "vibe_stop") {
      const outcome = args.outcome || "success";
      const playChime = args.playChime !== false;

      const wasPlaying = player.stop({ playChime, outcome });
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: `${wasPlaying ? "Stopped music." : "Nothing was playing."}${playChime ? ` Played ${outcome} resolution chime.` : ""}`
            }
          ]
        }
      };
    }

    if (name === "vibe_status") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                isPlaying: player.isPlaying,
                genre: player.genre,
                currentTier: player.currentTier,
                uptimeMs: player.isPlaying ? Date.now() - player.startTime : 0
              }, null, 2)
            }
          ]
        }
      };
    }

    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Unknown tool: ${name}`
      }
    };
  }

  if (id !== undefined) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`
      }
    };
  }

  return null;
}

function startMcpServer() {
  const player = new AudioPlayer();

  // In stdio MCP mode, stderr is used for logging, stdout is strictly reserved for JSON-RPC
  process.stderr.write(`[vibeaudio] MCP Server running on stdio (v${pkg.version})\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const msg = JSON.parse(trimmed);
      const response = handleMessage(player, msg);
      if (response) {
        process.stdout.write(JSON.stringify(response) + "\n");
      }
    } catch (err) {
      process.stderr.write(`[vibeaudio] Failed to parse JSON-RPC line: ${err.message}\n`);
    }
  });

  // Client disconnected - never leave audio looping behind.
  rl.on("close", () => {
    player.stop({ playChime: false });
    process.exit(0);
  });

  process.on("SIGINT", () => {
    player.stop({ playChime: false });
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    player.stop({ playChime: false });
    process.exit(0);
  });
}

module.exports = { startMcpServer, handleMessage, TOOLS };
