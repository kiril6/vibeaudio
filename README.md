# 🎧 VibeAudio

> **Procedural focus music while your AI coding tools think.**
> Every project gets its own arrangement. Zero dependencies, zero audio files.
> Works with Claude Code, Gemini CLI, Codex, Aider, and any terminal command.

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

## 🚀 Quickstart

Run straight from GitHub — no install, no clone:

```bash
npx github:kiril6/vibeaudio claude
```

> **Note:** VibeAudio is not published to npm yet, so `npx vibeaudio` won't resolve. Use the `github:` form above, or install globally from a clone (below).

### Interactive Launcher Menu

Run with no command to get a menu for picking your AI, vibe, and volume:

```bash
npx github:kiril6/vibeaudio
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
npx github:kiril6/vibeaudio claude      # wrap Claude Code
npx github:kiril6/vibeaudio gemini      # wrap Gemini CLI
npx github:kiril6/vibeaudio sleep 5     # test with a 5-second sleep
```

### Audition a Genre

Hear one loop without wrapping anything:

```bash
npx github:kiril6/vibeaudio --preview jazz
```

---

## 📦 Install Globally

For daily use, install from a clone so it launches with zero startup delay:

```bash
git clone https://github.com/kiril6/vibeaudio.git
cd vibeaudio
npm link
```

That puts both `vibe` and `vibeaudio` on your `PATH`.

### Pro Tip: The 1-Line Shell Alias
Add this to your `~/.zshrc` or `~/.bashrc`:

```bash
alias claude="vibe claude"
alias gemini="vibe gemini"
```
Now, whenever you run `claude`, music automatically plays while it works.

---

## 🖥️ Desktop GUI Apps (Claude Desktop & Antigravity via MCP)

VibeAudio includes a native **Model Context Protocol (MCP)** server over stdio, so desktop AI apps can trigger focus music and completion chimes during reasoning and tool execution.

Point the config at your clone (swap in your own path):

```json
{
  "mcpServers": {
    "vibeaudio": {
      "command": "node",
      "args": ["/absolute/path/to/vibeaudio/bin/vibeaudio.js", "--mcp"]
    }
  }
}
```

* **Claude Desktop** (macOS): `~/Library/Application Support/Claude/claude_desktop_config.json`
* **Antigravity:** your Antigravity MCP configuration file

#### Exposed MCP Tools:
* `vibe_play`: Start procedural focus music (`genre`: `lofi`, `synthwave`, `8bit`, `electronic`, `jazz`, `zen`, `random`; `volume`: `5-100`).
* `vibe_stop`: Stop music and play the completion chime (`outcome`: `success` or `failure`).
* `vibe_status`: Return current playback state and active tier.

Playback stops automatically if the desktop client disconnects, and caps out after 15 minutes so a crashed client can never leave music looping.

---

## 🪝 Claude Code Hooks (no wrapper needed)

Wrapping (`vibe claude`) infers "the AI is thinking" from how long the process runs. Hooks know for certain — so music starts the moment you submit a prompt and stops the moment the agent finishes, with no grace-window guessing and no aliases.

```bash
vibe --install-hooks                        # uses your default genre/volume
vibe --genre jazz --volume 25 --install-hooks   # or pin them explicitly
```

This wires two hooks into `~/.claude/settings.json`:

| Event | Action |
| :--- | :--- |
| `UserPromptSubmit` | Starts a detached background player |
| `Stop` | Stops it and plays the success chime |

Then **restart Claude Code**. Just run `claude` normally — no `vibe` prefix.

Removing them is one command:

```bash
vibe --uninstall-hooks
```

**Safety notes:** installing merges into your existing settings rather than replacing them — other tools' hooks are left untouched, your previous file is copied to `settings.json.vibeaudio.bak`, and re-running the install updates the entry instead of adding a duplicate. Uninstall removes only VibeAudio's own entries. If `settings.json` isn't valid JSON, VibeAudio refuses to write rather than clobbering it. The background player is capped at 15 minutes, so a missed `Stop` hook can't leave music looping.

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
vibe --genre jazz gemini         # Midnight Jazz
vibe --genre zen claude          # Zen Ambient (no drums/rhythm)
vibe --genre random claude       # Surprise vibe each run
```

### ⚙️ Set Your Favorite Genre as Default
```bash
export VIBE_GENRE=jazz     # or synthwave, electronic, zen, random
```

---

## ⚙️ Options & Flags

| Flag | Description | Default |
| :--- | :--- | :--- |
| `-g, --genre <name>` | Music style: `lofi`, `synthwave`, `8bit`, `electronic`, `jazz`, `zen`, `random` | `lofi` |
| `-v, --volume <0-100>` | Set playback volume | `40` |
| `-cv, --chime-volume <0-100>` | Set independent completion chime volume | `volume * 1.1` |
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

## 🤝 Contributing

Contributions welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md) for the ground rules (zero runtime dependencies, no build step, pure synth modules) and the dev loop. Found a bug? [Open an issue](https://github.com/kiril6/vibeaudio/issues/new) with your **OS**, **Node version**, and which audio player you have installed.

---

## 📄 License
MIT © 2026
