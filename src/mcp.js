/**
 * Model Context Protocol (MCP) Stdio Server
 * Connects VibeAudio to Desktop Apps (Claude Desktop, Antigravity, Cursor)
 * Zero dependencies - Pure Node.js JSON-RPC 2.0 over Stdio
 */

const readline = require("readline");
const { AudioPlayer, AVAILABLE_GENRES } = require("./player");
const pkg = require("../package.json");

// A desktop client that crashes never sends vibe_stop, so playback needs its
// own ceiling rather than looping forever.
const MAX_PLAYBACK_MS = 15 * 60 * 1000;

const TOOLS = [
  {
    name: "vibe_play",
    description: "Start playing procedural focus music in the background while processing or thinking.",
    inputSchema: {
      type: "object",
      properties: {
        genre: {
          type: "string",
          description: "Music genre: lofi, synthwave, 8bit, electronic, jazz, zen, or random",
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
    description: "Stop background focus music and play an outcome-aware resolution chime.",
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
    description: "Check current VibeAudio playback status (playing, genre, current tier).",
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
        }
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
      const volNum = args.volume !== undefined ? args.volume : (process.env.VIBE_VOLUME ? parseInt(process.env.VIBE_VOLUME, 10) : 40);
      const volume = Math.max(5, Math.min(100, volNum)) / 100.0;

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
