/**
 * Model Context Protocol (MCP) Stdio Server
 * Connects VibeAudio to clients with no hook system (Claude Desktop, VS Code,
 * older Gemini CLI releases). Agents with hooks (see TARGETS in hooks.js) should use those.
 * Zero dependencies - Pure Node.js JSON-RPC 2.0 over Stdio
 */

const readline = require("readline");
const path = require("path");
const { fileURLToPath } = require("url");
const { AudioPlayer, AVAILABLE_GENRES, normalizeVolume, playbackDisabled, musicEnabled, isKnownGenre, loadConfig, projectSettings } = require("./player");
const pkg = require("../package.json");

// A desktop client that crashes never sends vibe_stop, so playback needs its
// own ceiling rather than looping forever.
const MAX_PLAYBACK_MS = 15 * 60 * 1000;

// All four hints on every tool, as the spec's ToolAnnotations defines them, so
// a host can tell what each one does before the model calls it. None touches
// anything beyond the local audio player and VibeAudio's own cache.
const annotate = (title, { readOnly, idempotent }) => ({
  title,
  readOnlyHint: readOnly,
  destructiveHint: false,
  idempotentHint: idempotent,
  openWorldHint: false
});

const OUTCOMES = ["success", "failure"];

/**
 * Which project this conversation is about. Hooks and the wrapper know it (they
 * run in it); an MCP server is launched once by the client, in a directory the
 * client chose, so it has to be told. Two sources, in order:
 *   1. `project_dir`, an argument the model passes when it has a workspace.
 *   2. The client's roots (`roots/list`), the protocol's own answer.
 * With neither, the server's cwd, which is what it always used.
 * The value is only hashed and matched against keys in our own config file; it
 * is never opened, so it is not a file-access question - but it comes from the
 * client, so it must be a plain absolute path of sane length.
 */
const MAX_PROJECT_DIR = 1024;
function cleanProjectDir(value) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.length > MAX_PROJECT_DIR || v.includes("\0") || !path.isAbsolute(v)) return null;
  return path.resolve(v);
}

// A root is a file: URI. Anything else (a remote workspace) is not a path here.
function rootDirs(roots) {
  const dirs = [];
  for (const root of Array.isArray(roots) ? roots : []) {
    try {
      const uri = root && typeof root.uri === "string" ? root.uri : "";
      if (!uri.startsWith("file:")) continue;
      const dir = cleanProjectDir(fileURLToPath(uri));
      if (dir) dirs.push(dir);
    } catch (e) { /* a malformed URI is skipped, not fatal */ }
  }
  return dirs;
}

/** { dir, source }: what to seed from, and why - vibe_status reports the second. */
function resolveProject(args, session) {
  const explicit = cleanProjectDir(args && args.project_dir);
  let dir = null;
  let source = "cwd";
  if (explicit) { dir = explicit; source = "project_dir"; }
  else if (session && session.roots.length) { dir = session.roots[0]; source = "roots"; }
  // VIBE_SEED outranks every directory (projectSeed reads it); say so.
  if (process.env.VIBE_SEED && !isNaN(parseInt(process.env.VIBE_SEED, 10))) source = "VIBE_SEED";
  return { dir, source };
}

// What the client has told us about itself. `send` writes a request to it.
function newSession(send = null) {
  return { supportsRoots: false, roots: [], rootsRequest: null, send, nextId: 1 };
}

// Ask for the roots. Our own id space ("vibeaudio-roots-N") cannot collide with
// the client's, and a reply is matched by it.
function requestRoots(session) {
  if (!session || !session.supportsRoots || !session.send) return;
  session.rootsRequest = `vibeaudio-roots-${session.nextId++}`;
  session.send({ jsonrpc: "2.0", id: session.rootsRequest, method: "roots/list" });
}

const TOOLS = [
  {
    name: "vibe_play",
    description:
      "Start background focus music for the user while you work. Call this at the " +
      "START of a task you expect to take more than a few seconds - multi-step work, " +
      "long file edits, repeated tool calls, anything the user will wait through. " +
      "Always pair it with vibe_stop when the task resolves. Skip it for quick " +
      "answers: music around a one-second reply is worse than silence.",
    annotations: annotate("Start focus music", { readOnly: false, idempotent: true }),
    inputSchema: {
      type: "object",
      properties: {
        genre: {
          type: "string",
          description: "Music genre: lofi, synthwave, 8bit, electronic, jazz, zen, piano (sparse), drone/rain/ocean (no melody), or random",
          enum: [...AVAILABLE_GENRES, "random"]
        },
        volume: {
          type: "number",
          description: "Playback volume from 5 to 100 (default: 40)",
          minimum: 5,
          maximum: 100
        },
        project_dir: {
          type: "string",
          description:
            "Absolute path of the active workspace, if there is one. Omit it when you " +
            "have no workspace - do not guess a path. It makes this project sound like " +
            "itself and applies the genre and volume the user saved for it."
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
    annotations: annotate("Stop focus music", { readOnly: false, idempotent: false }),
    inputSchema: {
      type: "object",
      properties: {
        outcome: {
          type: "string",
          description: "Resolution outcome: 'success' (ascending chime) or 'failure' (soft minor tone)",
          enum: OUTCOMES
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
    annotations: annotate("Check focus music", { readOnly: true, idempotent: true }),
    inputSchema: {
      type: "object",
      properties: {}
    }
  }
];

function handleMessage(player, msg, session = null) {
  const { id, method, params } = msg;

  // The client's answer to our roots/list: it has a result, not a method.
  if (method === undefined && session && id !== undefined && id === session.rootsRequest) {
    session.rootsRequest = null;
    session.roots = rootDirs(msg.result && msg.result.roots);
    return null;
  }
  // Any other response is an answer to something we asked, not a request: it
  // gets no reply (a "method not found" for it would be sent to the client).
  if (method === undefined && (msg.result !== undefined || msg.error !== undefined)) return null;

  if (method === "initialize") {
    // roots is a client capability: only a client that declares it can be asked.
    if (session) session.supportsRoots = Boolean(params && params.capabilities && params.capabilities.roots);
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
          "unless the user asks; they are the user's preference, not yours.\n" +
          "If you have a workspace, pass its absolute path as vibe_play's project_dir so " +
          "this project sounds like itself; omit it when you have none."
      }
    };
  }

  if (method === "notifications/initialized") {
    // Client acknowledgment - no response needed, but this is the first moment
    // a request of ours is allowed, so ask which project it has open.
    requestRoots(session);
    return null;
  }

  if (method === "notifications/roots/list_changed") {
    requestRoots(session);
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
    // A request with no params used to throw here, and the only thing that
    // caught it wrote to stderr - leaving the client waiting on a response
    // that never came. Every request must leave with an answer.
    const { name, arguments: args = {} } = params || {};

    if (name === "vibe_play") {
      // Same precedence as the CLI: what the model asked for, then the
      // environment, then the user's saved default, then lofi. Reading the
      // saved file here is what makes `vibe --genre jazz` mean jazz in a
      // desktop client too, rather than only in the terminal.
      const saved = loadConfig();
      const project = resolveProject(args, session);
      const dir = project.dir || process.cwd();
      // What `vibe --here` saved for this project sits between the environment
      // and the machine-wide default, as it does for the CLI and the hooks.
      const here = projectSettings(saved, dir);
      const setting = (key) => (here[key] !== undefined ? here[key] : saved[key]);
      // The argument comes from the client: only a string counts. A number or
      // object here used to reach `.toLowerCase()` and fail the whole call.
      const asked = typeof args.genre === "string" ? args.genre.trim() : "";
      const requested = String(asked || process.env.VIBE_GENRE || setting("genre") || "lofi");
      // An unknown genre already fell back to lofi inside the generator, but
      // player.genre kept the name nobody implements - so the model told the
      // user it was playing something that does not exist.
      const genre = isKnownGenre(requested) ? requested : "lofi";
      // Both the tool argument and the env default go through the same parser
      // as the CLI, so a mistyped VIBE_VOLUME falls back instead of reaching
      // the player as NaN.
      const volume = normalizeVolume(args.volume,
        normalizeVolume(process.env.VIBE_VOLUME, normalizeVolume(setting("volume"), 0.4)));

      // A deliberate setting, like a mute: report it as one, and start nothing.
      if (!musicEnabled(process.env, saved, dir)) {
        return {
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: "The user has turned VibeAudio's music off (signals only), so nothing will play. This is deliberate and not an error — do not try again or suggest fixes; they will turn it back on when they want music." }] }
        };
      }

      const started = player.start(genre, volume, { maxDurationMs: MAX_PLAYBACK_MS, project: project.dir });
      // start() returns false for three unrelated reasons, and the model
      // relays whatever we say here to the user. Reporting a deliberate mute
      // as a missing audio player sends them debugging their sound stack.
      // What goes back to the model is client-supplied text, so echo a short
      // plain version of it, not whatever was sent.
      const shown = requested.replace(/[^\w.-]/g, "").slice(0, 24);
      const fallbackNote = genre === requested
        ? ""
        : ` (requested genre '${shown}' is not one of ${AVAILABLE_GENRES.join(", ")}, random)`;
      const text = started
        ? `Started playing ${player.genre} procedural focus music at ${Math.round(volume * 100)}% volume.${fallbackNote}`
        : player.isPlaying
          ? `Already playing ${player.genre} at ${Math.round(player.volume * 100)}% volume — nothing changed.`
          : playbackDisabled()
            ? "The user has muted VibeAudio, so nothing will play. This is deliberate and not an error — do not try again or suggest fixes; they will unmute when they want music."
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
      // The schema's enum is a hint to the model, not a check: nothing stops a
      // client sending anything, and this string is echoed back below.
      if (!OUTCOMES.includes(outcome)) {
        return {
          jsonrpc: "2.0",
          id,
          result: { isError: true, content: [{ type: "text", text: `outcome must be one of: ${OUTCOMES.join(", ")}.` }] }
        };
      }
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
      const statusProject = resolveProject({}, session);
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                isPlaying: player.isPlaying,
                // Without this, "isPlaying: false" while muted reads as a bug
                // worth investigating rather than a choice the user made.
                muted: playbackDisabled(),
                musicOff: !musicEnabled(process.env, loadConfig(), statusProject.dir || process.cwd()),
                // Which project the next vibe_play seeds from and how we learned
                // it (project_dir | roots | cwd | VIBE_SEED), and, while music
                // plays, the one it is playing for.
                project: statusProject.dir || process.cwd(),
                projectSource: statusProject.source,
                playingProject: player.isPlaying ? (player.projectDir || process.cwd()) : null,
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
  const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
  const session = newSession(send);

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

    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch (err) {
      // Unparseable: there is no id to answer to, so stderr is all we have.
      process.stderr.write(`[vibeaudio] Failed to parse JSON-RPC line: ${err.message}\n`);
      return;
    }

    let response;
    try {
      response = handleMessage(player, msg, session);
    } catch (err) {
      process.stderr.write(`[vibeaudio] Handler error: ${err.message}\n`);
      // A request (one with an id) must always get a reply. Swallowing the
      // throw left the client blocked on a response that never came.
      if (msg && msg.id !== undefined && msg.id !== null) {
        response = { jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: `Internal error: ${err.message}` } };
      }
    }

    if (response) send(response);
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

module.exports = { startMcpServer, handleMessage, TOOLS, newSession, resolveProject, cleanProjectDir, rootDirs };
