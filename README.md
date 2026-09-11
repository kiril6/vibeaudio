# 🎧 VibeAudio

[![test](https://github.com/kiril6/vibeaudio/actions/workflows/test.yml/badge.svg)](https://github.com/kiril6/vibeaudio/actions/workflows/test.yml)

> **Procedural focus music while your AI coding tools think.**
> Every project gets its own arrangement. Zero dependencies, zero audio files.
> Works with Claude Code, Gemini CLI, Codex, Aider, and any terminal command.

**[Install](#-install)** · **[Claude Code hooks](#-claude-code-hooks-no-wrapper-needed)** · **[Genres](#-music-genres)** · **[Flags](#-options--flags)** · **[Troubleshooting](#-troubleshooting)** · **[Uninstall](#-uninstall)**

> **In a hurry?** `npm i -g github:kiril6/vibeaudio`, then `vibe --install-hooks`. Your next prompt has music.

---

## ⚡ The Problem

When AI coding agents take 15–45 seconds to reason, read files, and write code, staring at a blank terminal cursor feels agonizingly slow. If you tab away, you have to constantly check back to see if it's done.

**VibeAudio fixes dead air:**
1. **Procedural Focus Music:** While your AI agent is thinking, VibeAudio plays warm, gentle procedural music in the background.
2. **Built to be ignorable:** Soothing Lo-Fi Rhodes chords, analog Synthwave pads, or filtered 8-bit retro vibes — quiet, unhurried, and the same every time you open a given project, so it fades into the background instead of pulling your ear back.
3. **The "Done" Chime:** When the AI finishes, the music stops and a delicate glassy chime signals that your output is ready to read.

---

## ✨ What Makes VibeAudio Different

* 🧮 **Pure Procedural Synthesis (Zero MP3s):** Every note, chord, and pad is generated mathematically in code — no audio assets to download, no npm dependencies.
* 🎼 **A different arrangement per project:** Your working directory seeds the progression, bass line and melody, so each repo has its own sound (and keeps it).
* 🛡️ **The Grace Window:** Fast commands (like `/help` or quick queries) remain 100% silent. Music only begins if the AI takes longer than 1.5 seconds (tunable with `--grace`).
* 📈 **Adaptive Time Escalation:** The arrangement gains layers as the prompt runs (Tier 1: 0–15s gentle intro → Tier 2: 15–45s main groove → Tier 3: 45s+ deep focus layer). You can literally hear how deep into the task the AI is.
* 🔔 **Outcome-Aware Chimes:** A bright ascending chime on success (`exit 0`), a soft descending minor chord on error. Abort with `Ctrl+C` and you get silence — no false "done" signal.
* 🌊 **Terminal Title HUD:** A live ASCII wave and elapsed timer in your terminal window/tab title, which stays out of the way of full-screen TUIs.
* 🔌 **Universal Drop-In Wrapper:** Works with **Claude Code, Gemini CLI, Codex, Aider**, or any terminal command (`vibe <command>`).
* 🪶 **Zero Build Dependencies:** Pure Node.js, no C++ bindings (`node-gyp`), no compile step.

### 🎼 Every project gets its own arrangement

VibeAudio seeds the composition from your **project directory**. The repo you're in picks the chord progression, the bass line, the melodic contour, and where the ornaments land — so `~/work/api` and `~/side/game` genuinely sound different, while each one sounds the *same every time you come back to it*.

That's a deliberate choice. Focus music has one job: **be ignorable.** Music that reinvents itself every run keeps pulling your ear back, which is the opposite of what you want while reading an agent's output. Familiar-per-project gives you variety across contexts and predictability within one — by your third session in a repo, its loop has faded into the furniture.

Pin or explore arrangements when you want to:

```bash
vibe --seed 42 --preview jazz    # audition one specific arrangement
export VIBE_SEED=7               # pin the same sound everywhere
```

**How "procedural" actually works** — worth being precise, since it shapes what you'll hear. Each genre is **synthesized from code** (oscillators, chord tables, envelopes rendered to PCM), not shipped as audio files. The seed selects among *hand-written, human-checked* variants — three progressions per genre, each diatonic to that genre's key, plus seeded ornament placement — so it never invents harmony and can't wander out of key. The chosen arrangement is rendered once per project, cached under `~/.vibeaudio/cache/`, and looped. Within a session you're hearing a ~6–7 second bar repeat that gains layers as you cross the tier boundaries.

---

## 📋 Requirements

* **Node.js ≥ 18**
* **An audio player.** VibeAudio shells out to whatever your OS provides:

| Platform | Player used | Volume control | Notes |
| :--- | :--- | :--- | :--- |
| **macOS** | `afplay` | ✅ | Ships with the system — nothing to install. |
| **Linux** | `paplay`, `ffplay`, or `aplay` | ✅ except `aplay` | Install `pulseaudio-utils`, `ffmpeg`, or `alsa-utils`. |
| **Windows** | PowerShell `SoundPlayer` | ❌ | Plays at system volume; `--volume` is ignored. |

If no player is found, VibeAudio prints a one-line notice and runs your command **silently** — it never blocks the tool you actually wanted to run.

---

## 🚀 Install

One line. No clone, no build step, no dependencies to resolve:

```bash
npm i -g github:kiril6/vibeaudio
```

That puts `vibe` and `vibeaudio` on your `PATH`. Re-run the same command to update, or see [Uninstall](#-uninstall) to remove it cleanly.

> **Note:** VibeAudio isn't on the npm registry yet, so plain `npx vibeaudio` won't resolve — use the `github:` form above.

### Then pick how it runs

**Using Claude Code interactively?** Install the hooks — this is the mode that actually tracks thinking:

```bash
vibe --install-hooks
```

Now run `claude` normally, with no prefix. Music starts when you submit a prompt and stops with a chime when the agent finishes. [Details below.](#-claude-code-hooks-no-wrapper-needed)

**Running one-shot commands?** Wrap them:

```bash
vibe npm test
vibe claude -p "explain this repo"
```

> **Which one you want:** the wrapper plays music for as long as the wrapped process lives. That's exactly right for a command that exits when its work is done — and wrong for an interactive REPL like `claude`, where the process stays alive while you read and type, so the music never stops. Hooks know when the agent is actually thinking; the wrapper can only time the process.

### Try it without installing

```bash
npx github:kiril6/vibeaudio --preview jazz   # hear a loop right now
npx github:kiril6/vibeaudio sleep 8          # hear the wrapper: music, then the done chime
```

> **Heard nothing?** Music only starts once the wrapped command has run longer than the 1.5s grace window — that's [the point](#-what-makes-vibeaudio-different), so quick commands stay silent. `sleep 8` is the reliable demo; something like `npm test` is silent if the tests finish fast or the command errors out immediately.

`npx` runs from a temporary cache that npm eventually deletes, so `--install-hooks` refuses to run this way — it would write a path into your Claude Code settings that later vanishes. Install globally first.

### Interactive Launcher Menu

Run with no command to get a menu for picking your AI, vibe, and volume:

```bash
vibe
```

```
🎧 VibeAudio — Interactive AI Launcher

Which AI companion would you like to launch?
❯ 1. Claude Code        [✓ installed]
  2. Gemini CLI         [✓ installed]
  3. Codex CLI
  4. Aider
  5. Ollama (Llama 3)
  6. Custom command...

Choose your sound vibe:
❯ 1. ☕ Lo-Fi Focus        — Warm Rhodes electric piano & Kalimba drops
  2. 🌌 Chill Synthwave    — '80s analog chorused pads & pulsing bass
  3. 🕹️ Cozy 8-Bit         — Filtered retro chiptune arpeggios
  4. ⚡ Melodic Electronic  — Downtempo resonant plucks & tech pulse
  5. 🎷 Midnight Jazz      — ii-V-I piano chords & walking upright bass
  6. 🎋 Zen Ambient        — Meditative singing bowls & celestial pads
  7. 🎲 Shuffle / Random   — Picks a surprise vibe each time

Choose your volume level:
❯ 1. ☕ Normal (40%)       — Balanced focus background [Default]
  2. 🤫 Quiet (25%)        — Discreet focus / open office
  3. 🌙 Whisper (15%)      — Ultra-gentle / headphones / late night
  4. 📢 Loud (75%)         — Audible across the room
```

### Direct Command Wrapper

```bash
vibe npm test           # music for the length of the test run
vibe gemini -p "..."    # one-shot prompt
vibe sleep 5            # test with a 5-second sleep
```

### Audition a Genre

Hear one loop without wrapping anything:

```bash
vibe --preview jazz
```

---

## 🪝 Claude Code Hooks (no wrapper needed)

Wrapping (`vibe claude`) infers "the AI is thinking" from how long the process runs. Hooks know for certain — so music starts the moment you submit a prompt and stops the moment the agent finishes, with no grace-window guessing and no aliases.

Once hooks are installed they take over: running `vibe claude` anyway plays no music of its own and says so, rather than layering a session-long loop on top of the hooks' per-prompt one.

```bash
vibe --install-hooks                        # uses your default genre/volume
vibe --genre jazz --volume 25 --install-hooks   # or pin them explicitly
```

This wires two hooks into `~/.claude/settings.json`:

| Event | Action |
| :--- | :--- |
| `UserPromptSubmit` | Starts a detached background player |
| `Stop` | Stops it and plays the success chime |

That's it. Just run `claude` normally — no `vibe` prefix.

> **No restart needed for a session that's already open.** Claude Code reads `settings.json` each time a hook fires, not once at startup, so edits land on your **next prompt**. A daemon already playing keeps its old settings until that prompt replaces it — at most the tail of one turn. (If a brand-new install doesn't seem to take, restarting is the safe fallback.)

> **This covers the Claude Code desktop app too**, not only the terminal. Both read the same `~/.claude/settings.json`, so one `--install-hooks` wires up both — no `vibe` prefix, and no MCP setup. (The separate **Claude Desktop** chat app is a different product with no hooks; that one needs [MCP](#-everything-else-codex-gemini-cli-claude-desktop-antigravity-via-mcp).)

### Changing the sound later

Re-run the install with the settings you want. It replaces the existing entry rather than adding a second one:

```bash
vibe --genre electronic --volume 25 --install-hooks
```

The change applies to your next prompt — no restart. Audition first with `vibe --preview electronic`.

Two things to know: the reinstall **replaces** the whole entry, so flags you don't repeat are dropped (leave off `--reactive` and reactive mode goes away). And music already playing keeps the old genre until the next prompt swaps the daemon — `pkill -f "vibeaudio.js --daemon"` cuts it short.

> **`VIBE_GENRE` / `VIBE_VOLUME` won't change an installed hook.** They're read once, at install time, and written into the hook command — so exporting a new value later does nothing until you reinstall. The same goes for `vibe --genre <name>` on its own: with no command after it that opens the launcher menu, which asks for a genre and uses its own answer. Changing hook music always means re-running `--install-hooks`.

Removing them is one command:

```bash
vibe --uninstall-hooks
```

### Reactive mode (opt-in)

```bash
vibe --reactive --install-hooks
```

Adds a `PreToolUse` hook so intensity follows **what the agent is doing**, not just how long it's taken:

| Agent is… | Tools | Tier |
| :--- | :--- | :--- |
| Reading and searching | `Read`, `Grep`, `Glob`, `WebFetch` | 1 — sparse |
| Changing code | `Edit`, `Write`, `NotebookEdit` | 2 — groove enters |
| Running things | `Bash`, `Task` | 3 — peak |

Changes land at the next loop boundary, so it shifts musically rather than cutting mid-bar. Without a tool signal it falls back to time-based escalation.

**This is off by default on purpose.** Music that moves every time the agent switches tools is music you *notice* — which is the opposite of what focus audio is for. Try it, but if you catch yourself listening to it instead of reading, reinstall without `--reactive` (which removes the `PreToolUse` hook again).

**Safety notes:** installing is refused from a temporary `npx` checkout, since the hook records an absolute path that npm's cache eviction would later delete. Installing merges into your existing settings rather than replacing them — other tools' hooks are left untouched, your previous file is copied to `settings.json.vibeaudio.bak`, and re-running the install updates the entry instead of adding a duplicate. Uninstall removes only VibeAudio's own entries. If `settings.json` isn't valid JSON, VibeAudio refuses to write rather than clobbering it. The background player is capped at 15 minutes, so a missed `Stop` hook can't leave music looping.

---

## 🖥️ Everything Else (Codex, Gemini CLI, Claude Desktop, Antigravity… via MCP)

Hooks exist only in Claude Code. Every other AI tool that takes a **Model Context Protocol** server can run VibeAudio the same way: it's plain stdio JSON-RPC, so the setup is identical everywhere and only the config file differs.

> **This is weaker than hooks, by nature.** Hooks fire on an event — the music always starts when you submit a prompt. MCP tools are *model-invoked*: the assistant has to decide to call `vibe_play`, and to remember `vibe_stop` when it's done. The server tells it when to do that (via the MCP `instructions` field), but it's a suggestion, not a guarantee — expect the occasional silent turn, and say "play some focus music while you work on this" if you want it reliably. **On Claude Code — terminal or desktop app — use [hooks](#-claude-code-hooks-no-wrapper-needed) instead.**

Use an **absolute path**, not the bare `vibe` command: GUI apps launched from Finder don't inherit your shell's `PATH`, and version managers like `fnm` or `nvm` put `vibe` on a per-shell path that won't resolve. Print yours with:

```bash
echo "$(npm root -g)/vibeaudio/bin/vibeaudio.js"
```

Most apps use this JSON shape:

```json
{
  "mcpServers": {
    "vibeaudio": {
      "command": "node",
      "args": ["/absolute/path/from/the/command/above", "--mcp"]
    }
  }
}
```

**Codex** uses TOML instead, in `~/.codex/config.toml` (the CLI and the Codex desktop app share this file):

```toml
[mcp_servers.vibeaudio]
command = "node"
args = ["/absolute/path/from/the/command/above", "--mcp"]
```

Where the file lives:

| Tool | Config file |
| :--- | :--- |
| **Codex** (CLI + desktop app) | `~/.codex/config.toml` — TOML block above |
| **Gemini CLI** | `~/.gemini/settings.json` |
| **Claude Desktop** (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Antigravity, Cursor, VS Code, Zed, …** | that app's own MCP settings — same JSON shape |

Restart the app afterwards. For terminal tools that hold an interactive session open, like Gemini CLI, MCP is the better fit than `vibe gemini`: the wrapper times the *process*, so it would play for the whole session, including while you read and type.

### Changing the genre here

`vibe --genre` doesn't apply — the app launches the server, not you. Two ways instead:

**Just ask.** `vibe_play` takes a genre, so "play some jazz while you work on this" is enough, no config edit and no restart.

**Or set a default in the config's `env` block**, since a GUI app won't inherit `VIBE_GENRE` from your shell. Most clients support `env` alongside `command`/`args`:

```json
"env": { "VIBE_GENRE": "jazz", "VIBE_VOLUME": "25" }
```

```toml
[mcp_servers.vibeaudio.env]
VIBE_GENRE = "jazz"
VIBE_VOLUME = "25"
```

Restart the app afterwards. A genre the assistant passes to `vibe_play` still wins over this default.

#### Exposed MCP Tools:
* `vibe_play`: Start procedural focus music (`genre`: `lofi`, `synthwave`, `8bit`, `electronic`, `jazz`, `zen`, `random`; `volume`: `5-100`).
* `vibe_stop`: Stop music and play the completion chime (`outcome`: `success` or `failure`).
* `vibe_status`: Return current playback state and active tier.

Playback stops automatically if the desktop client disconnects, and caps out after 15 minutes — which also covers the likelier case of a model that started the music and never called `vibe_stop`.

---

## 🎨 Music Genres

VibeAudio includes **6 procedural music styles** synthesized entirely in code:

| Genre | Style | Vibe |
| :--- | :--- | :--- |
| `lofi` | ☕ **Lo-Fi Focus** *(Default)* | Warm Rhodes electric piano chords & Kalimba drops |
| `synthwave` | 🌌 **Chill Synthwave** | '80s analog chorused pads & pulsing retro bass |
| `8bit` | 🕹️ **Cozy 8-Bit** | Filtered retro chiptune arpeggios & NES triangle bass |
| `electronic` | ⚡ **Melodic Electronic** | Downtempo resonant plucks & crisp tech pulse |
| `jazz` | 🎷 **Midnight Jazz** | Classic ii-V-I jazz piano chords & walking upright bass |
| `zen` | 🎋 **Zen Ambient** | Meditative Tibetan singing bowls & celestial drone (zero rhythm) |
| `random` | 🎲 **Shuffle Mode** | Picks a surprise genre for the run |

Aliases also work: `chiptune` → `8bit`, `downtempo` → `electronic`, `bossa` → `jazz`, `ambient` → `zen`.

### Usage Examples:
```bash
vibe --genre electronic claude   # Melodic Electronic
vibe --genre jazz npm test       # Midnight Jazz
vibe --genre zen claude          # Zen Ambient (no drums/rhythm)
vibe --genre random claude       # Surprise vibe each run
```

### ⚙️ Set Your Favorite Genre as Default

How you change it depends on how you run VibeAudio — **a shell `export` only reaches the wrapper**:

| You run it via | Change the genre with |
| :--- | :--- |
| **Wrapper** (`vibe <command>`) | `export VIBE_GENRE=jazz` — or `--genre` per run |
| **Claude Code hooks** | re-run `vibe --genre jazz --install-hooks` — [why](#changing-the-sound-later) |
| **MCP** (Codex, Claude Desktop, …) | ask the assistant, or the config's `env` block — [how](#changing-the-genre-here) |

```bash
export VIBE_GENRE=jazz     # or synthwave, electronic, zen, random
```

---

## ⚙️ Options & Flags

| Flag | Description | Default |
| :--- | :--- | :--- |
| `-g, --genre <name>` | Music style: `lofi`, `synthwave`, `8bit`, `electronic`, `jazz`, `zen`, `random` | `lofi` |
| `-v, --volume <0-100>` | Set playback volume | `40` |
| `-cv, --chime-volume <0-100>` | Set independent completion chime volume | `volume × 1.1`, kept within 35–65 |
| `--grace <ms>` | Silence window before music starts | `1500` |
| `--seed <n>` | Force a specific arrangement | derived from the project directory |
| `--whisper` | Quick preset: 15% volume (headphones / late night) | — |
| `--quiet` | Quick preset: 25% volume (focus / open office) | — |
| `--loud` | Quick preset: 75% volume (hear from across the room) | — |
| `--no-chime` | Disable the resolution completion chime | `false` |
| `--no-hud` | Disable terminal window/tab title animation | `false` |
| `--preview <genre>` | Play one loop of a genre and exit | — |
| `--clear-cache` | Delete all cached audio, then exit | — |
| `--mcp` | Run as an MCP stdio server for desktop apps | — |
| `--install-hooks` | Wire music into Claude Code hooks (no wrapper needed) | — |
| `--reactive` | With `--install-hooks`: intensity follows the tool in use | off |
| `--uninstall-hooks` | Remove the Claude Code hooks again | — |
| `-h, --help` | Show help and options | — |
| `--version` | Show version | — |

### ⚙️ Environment Variables
Set persistent defaults in your `~/.zshrc` or `~/.bashrc`:

```bash
export VIBE_GENRE=jazz          # lofi, synthwave, 8bit, electronic, jazz, zen, random
export VIBE_VOLUME=25           # Background music at 25%
export VIBE_CHIME_VOLUME=70     # Crisp completion chime at 70%
export VIBE_GRACE_MS=3000       # Wait 3s of thinking before any music
export VIBE_SEED=7              # Same arrangement everywhere, ignoring the directory
```

---

## 🧠 Smart Audio UX

* **Grace Window:** Fast commands never trigger music. Music only starts if the command runs longer than the grace period (default 1.5s). If your AI tool takes a second or two to boot, raise it with `--grace 3000` so its startup doesn't count as "thinking".
* **Instant Termination:** The moment the command finishes, audio stops.
* **Outcome-Aware Resolution:** Ascending chime on success (`exit 0`), descending minor tone on failure — so you know the result from across the room.
* **Honest Exit Codes:** VibeAudio passes your command's exit status straight through, and reports `130` when you `Ctrl+C`, so `vibe claude && next-step` behaves exactly as it would without the wrapper.
* **Silent Aborts:** `Ctrl+C` plays no chime — an abort isn't an outcome worth celebrating.

---

## 🔧 Troubleshooting

**No sound at all**
Check that a player exists for your platform (see [Requirements](#-requirements)). VibeAudio prints a notice to stderr when it can't find one. On Linux: `sudo apt install pulseaudio-utils` (or `ffmpeg` / `alsa-utils`).

**Music starts immediately instead of after the grace window**
It usually is waiting — your AI tool's own startup (auth, session load) just takes longer than 1.5s, so music and the tool's first output appear together. Raise the window: `vibe --grace 3000 claude`.

**Music sounds stale after upgrading**
It shouldn't — the cache is keyed by version and old versions are pruned automatically. To force a rebuild anyway:

```bash
vibe --clear-cache
```

**Volume flag does nothing**
You're on Windows, or Linux with only `aplay` available; neither supports attenuation. Install `ffmpeg` or `pulseaudio-utils` on Linux for volume control.

---

## 🧹 Uninstall

**Remove the hooks first, while `vibe` still exists:**

```bash
vibe --uninstall-hooks          # 1. unwire Claude Code
npm rm -g vibeaudio             # 2. remove the CLI
rm -rf ~/.vibeaudio             # 3. optional: cached audio + daemon state
```

> **Order matters.** `npm rm -g` deletes the binary but not your `~/.claude/settings.json`. Removing the package first strands hook entries that point at a path that no longer exists, and Claude Code will run a failing hook on every prompt. If you already did it in the wrong order, reinstall, run `vibe --uninstall-hooks`, then remove again — or delete the `vibeaudio` entries from `~/.claude/settings.json` by hand.

Step 3 only reclaims disk (the audio cache; ~9 MB per few projects) — it's regenerated on next use, so skip it if you're reinstalling. If you added the [MCP server](#-everything-else-codex-gemini-cli-claude-desktop-antigravity-via-mcp) to a desktop app, drop the `vibeaudio` entry from that app's config too. Nothing else is written outside these paths.

---

## 🤝 Contributing

Contributions welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md) for the ground rules (zero runtime dependencies, no build step, pure synth modules) and the dev loop. Found a bug? [Open an issue](https://github.com/kiril6/vibeaudio/issues/new) with your **OS**, **Node version**, and which audio player you have installed.

Working on it locally:

```bash
git clone https://github.com/kiril6/vibeaudio.git
cd vibeaudio
npm link        # puts your clone's `vibe` on PATH
npm test
```

---

## 📄 License
MIT © 2026
