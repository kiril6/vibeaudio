# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

VibeAudio: a zero-dependency Node.js CLI (`vibe <command>`) that wraps any AI coding tool (Claude Code, Gemini, Codex, etc.), playing procedurally-generated focus music while the wrapped command runs and an outcome chime when it exits. All audio is synthesized in pure JS (no MP3 assets, no native bindings) and played via macOS `afplay`.

## Commands

```bash
npm test                              # runs test/test-synth.js (plain node + assert, no framework)
node bin/vibeaudio.js <command>       # run the CLI locally without installing
node bin/vibeaudio.js --preview jazz  # audition one genre loop
node bin/vibeaudio.js --clear-cache   # force audio regeneration after a synth change
npm link                              # to test the `vibe`/`vibeaudio` global bin locally
```

There is no build step, linter, or bundler — it's plain CommonJS Node (`engines.node >= 18`). To run a single check, just run `node test/test-synth.js` (the whole file is one linear script of assertions; there's no per-test filtering).

**Audio is cached per version.** After editing anything in `src/synth/`, run `--clear-cache` or you'll keep hearing the previous render.

## Architecture

**Entry points**: `bin/vibeaudio.js` → `src/cli.js#run()`. `run()` branches:
- `--mcp` flag → `src/mcp.js#startMcpServer()` (stdio JSON-RPC server for desktop apps)
- a `HOOK_ACTIONS` flag → `runHookAction()` → `src/hooks.js` (Claude Code hooks)
- `--preview` / `--clear-cache` → one-shot utility paths
- no command args + interactive TTY → `src/interactive.js#promptInteractive()` (menu to pick AI tool / delivery / genre / volume / reactive)
- command args given → `executeCommand()` spawns the wrapped command directly

**The wrapper flow** (`src/cli.js#executeCommand`): spawns the child command with `stdio: "inherit"`. A grace timer (default 1500ms, see `--grace`/`VIBE_GRACE_MS`) delays starting audio — if the child exits before the grace window, no music/chime plays at all.

The wrapper measures **child process lifetime**, which equals working time only for commands that exit when their work is done. An interactive REPL stays alive while the user reads and types, so `hooksAlreadyCover()` suppresses the wrapper's music entirely when the child is `claude` (without `-p`/`--print`) and our hooks are installed — otherwise `vibe claude` layers a session-long stream over the hook daemon's per-prompt one. With no hooks installed, that same case prints a one-line pointer to `--install-hooks` rather than silently doing the wrong thing. This matters because the interactive menu (`vibe` with no args) launches Claude Code through exactly this path.

Exit handling is the subtle part, and two invariants must hold:
- **`cleanup()` runs exactly once**, guarded by a `finished` flag. Both the signal path and the `close` path route through it; without the guard the HUD prints twice and the player is stopped twice (the second stop re-enabling the chime the first one suppressed).
- **A signal-killed child reports `code === null`.** `close` must map that through `signalExitCode(signal)` to `128 + signum`, never to `0` — otherwise an aborted run claims success, plays the success chime, and lets `vibe claude && deploy` chain after a `Ctrl+C`. Interrupts also suppress the chime entirely.

**Audio pipeline** (`src/player.js`):
- `AudioPlayer.start(genre, volume, { maxDurationMs })` schedules `playLoop()` on a timer derived from the WAV's own header (`wavDurationMs`), re-spawning `LOOP_OVERLAP_MS` (120ms) early so the loops' boundary fades crossfade instead of leaving a process-spawn gap. It returns `false` if already playing with identical settings, and restarts when genre/volume differ — so an MCP genre switch isn't silently dropped.
- Tier selection ("adaptive time escalation") happens per loop iteration: tier 1 (0-15s), tier 2 (15-45s), tier 3 (45s+). **Every generator must honour its `tier` argument** — one that ignores it writes three byte-identical cache files and silently disables escalation.
- `resolveGenre()` maps aliases (`chiptune`→`8bit`, `bossa`→`jazz`, …) to canonical names and resolves `random` **once** at `start()`, not per loop — otherwise the genre would change every ~6s.
- Generated WAVs are cached at `~/.vibeaudio/cache/v<pkg.version>/s<seed>/`. The version key is what makes synth changes reach existing users; stale version directories are pruned when a new one is created, and seed directories are pruned to the 3 most recent projects.
- `projectSeed()` hashes `process.cwd()` (overridable via `--seed`/`VIBE_SEED`), so a repo always sounds like itself. This is deliberately **not** per-run: focus music should fade into the background, and per-session novelty works against that. The seed is resolved once in `start()` and held on the player, so tiers within a run stay the same piece.
- Playback backend is detected once from `PLAYER_CANDIDATES` (`afplay` → `paplay` → `ffplay` → `aplay`, plus PowerShell `SoundPlayer` on Windows). If nothing is found, it warns once and runs silently — audio must never block the wrapped command.
- `aplay` and PowerShell `SoundPlayer` take no volume argument. `bakedGain()` decides per backend: 1 when the player attenuates itself (macOS and most Linux keep the existing cache files, bit-identical), otherwise the volume, which `applyGain()` scales into the PCM and `gainSuffix()` puts in the cache filename (`loop_jazz_t2_g25.wav`). **Exactly one of the two must apply** — a file that is both pre-scaled and passed to `-v` is attenuated twice.
- A module-level `process.on("exit")` hook kills live player processes, so an abrupt exit can't orphan audio.

**Synthesis** (`src/synth/`): `generator.js` holds the shared primitives — `noteToFreq()` (note name → Hz), oscillators (`sine`, `triangle`, `softPulse`, `analogSaw`), `createWavBuffer()` (raw Float samples → 16-bit PCM WAV `Buffer`), and the determinism helpers `makeRng()` (mulberry32), `hashString()` (FNV-1a), `pick()` and `ornamentRng()`. Each genre exports `generate<Genre>Loop(durationSeconds, tier, seed)` and returns a WAV buffer. `chime.js` generates the two outcome chimes (seed-independent).

Three rules hold across every generator:
- **Generation is pure and fully deterministic.** No `Math.random()` — dither and noise draw from the seeded stream, or the same seed would render different bytes and invalidate the cache.
- **The seed selects among curated variants, never invents harmony.** Each genre carries hand-written progressions diatonic to its key, with the bass line that spells those changes. Randomising notes freely produces bad bars; this cannot.
- **Ornaments draw from `ornamentRng(seed)` in a fixed order, regardless of tier.** Gating a layer behind `tier >= 2` must not shift the choices other layers make, or tiers would stop being the same piece with more of it.

When adding a genre, follow that shape, honour both `tier` and `seed`, and wire it into `player.js`'s `generateLoop` switch and `AVAILABLE_GENRES`.

**MCP server** (`src/mcp.js`): exposes `vibe_play` / `vibe_stop` / `vibe_status` tools over stdio JSON-RPC for every client without a hook system (Codex, Gemini CLI, Cursor, Claude Desktop, Antigravity), backed by the same `AudioPlayer` class as the CLI wrapper. Nothing fires these tools automatically — the model chooses to — so the *when to call this* guidance lives in the tool descriptions, which every client shows the model, as well as in the `instructions` field, which the spec makes optional. Because a crashed client never sends `vibe_stop`, playback is capped by `MAX_PLAYBACK_MS` and also stops on stdin close. Tool responses report what actually happened (`start()`/`stop()` return booleans) rather than assuming success.

**Claude Code hooks** (`src/hooks.js`): `--install-hooks` merges `UserPromptSubmit` → `--hook-start` and `Stop` → `--hook-stop` into `~/.claude/settings.json`. Because hooks fire as short-lived processes, playback lives in a detached daemon (`--daemon`, an internal mode) tracked by `~/.vibeaudio/daemon.pid`; `--hook-start` respawns it and `--hook-stop` SIGTERMs it, then plays the chime in the hook process itself.

`stopDaemon()` must confirm the pid before signalling it (`isOurDaemon()`, a `ps` command-line check). A pid file outlives a daemon that died without cleanup and the OS recycles pids, so an unverified kill eventually SIGTERMs an unrelated process — and `hookStart` calls `stopDaemon` on **every prompt**. It fails closed: an unverifiable pid is left alone, because a daemon we don't kill stops itself at `MAX_DAEMON_MS` while killing a stranger's process has no such ceiling. The check is posix-only; win32 trusts the pid.

Tests that touch the daemon must run in a child process with `HOME`/`USERPROFILE` overridden, never by setting `process.env.HOME` in the suite: `hooks.js` resolves `PID_FILE` from `os.homedir()` at require time, so an in-process override silently operates on the real `~/.vibeaudio` and clobbers a live daemon's pid file.

Because the hook command is an absolute path to this checkout, `installHooks()` first calls `ephemeralInstallReason()` and refuses when it's running from an `npx` cache — otherwise npm's eventual cache eviction leaves Claude Code firing a broken hook on every prompt. The guard runs before any write. `src/cli.js` wraps the whole `runHookAction()` dispatch in a try/catch so these (and malformed-settings aborts) print one line and exit 1 instead of a stack trace.

Claude Code re-reads `settings.json` on each hook event rather than caching it at startup, so an install or a genre change lands on the user's **next prompt** with no restart — verified by editing the file mid-session and watching the next daemon spawn with the new argv. Don't reintroduce restart instructions. The one lag is the daemon already playing, which keeps its argv until that next prompt replaces it.

Settings writes must stay non-destructive: the file belongs to the user and usually holds other tools' hooks. `isVibeHook()` identifies our entries by the `--hook-start`/`--hook-stop`/`--hook-tool` flags, `setHook()` replaces rather than appends (idempotent reinstall), malformed JSON aborts instead of being overwritten, and the prior file is copied to `settings.json.vibeaudio.bak`.

`promptInteractive()` returns intent (`installHooks`, `reactive`) and never writes config itself — `cli.js#installHooksFromMenu` performs the install so both entry points share one code path and one report. The delivery and reactive questions are asked only for `claude`, since it is the only tool with hooks; asking elsewhere would offer a control that does nothing. An install that throws (npx checkout, malformed settings) is reported and the tool still launches — the user came to start an agent, not to configure one.

**Reactive mode** (`--reactive`, opt-in) adds a `PreToolUse` hook that reads Claude Code's JSON payload from stdin and writes a tier to `~/.vibeaudio/intensity` (`TOOL_TIERS`). The daemon passes `readIntensity` to `AudioPlayer.start()` as the `intensity` option, and `playLoop()` prefers it over the time-based tier, falling back when there's no signal. It stays off by default because music that reacts to every tool call is music the user notices — the opposite of the product's goal. `hookStart`/`hookStop` clear the intensity file so one prompt's activity can't leak into the next.

**HUD** (`src/hud.js`): animates an ASCII waveform in the terminal **title bar only** — the wrapped tool may own the screen by the time music starts, so drawing inline would corrupt a full-screen TUI. `stop()` is inert unless `start()` ran and is idempotent, since `cleanup()` can be reached from more than one path.

## Conventions

- Every module in `src/synth/` is pure — no I/O, just math producing sample arrays — keep it that way so `test/test-synth.js` can assert on generator output directly.
- CLI flags/env vars are parsed once in `src/cli.js#parseArgs`, which is unit-tested directly (imported into `test/test-synth.js`) — extend that function's `while` loop for new flags rather than parsing args elsewhere.
- Volume arrives as a string from env/flags and as a number from MCP, so every entry point goes through `player.js#normalizeVolume`. A second hand-rolled clamp is how `VIBE_VOLUME=loud` reached the player as `NaN`.
- `test/test-synth.js` runs on Linux, macOS and Windows in CI. Spawn `process.execPath` rather than `sleep`/`true`/`false`, and guard posix-only assertions on `process.platform`.
