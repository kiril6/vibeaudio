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
- `--preview` / `--clear-cache` / `--status` / `--stop` → one-shot utility paths
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
- `resolveGenre()` maps aliases (`chiptune`→`8bit`, `bossa`→`jazz`, …) to canonical names and resolves `random` **once** at `start()`, not per loop — otherwise the genre would change every ~6s. `random` draws from `SHUFFLE_GENRES`, not `AVAILABLE_GENRES`: `drone` is excluded because it is the deliberate "no melody at all" choice, and rolling it by chance reads as broken audio rather than as variety. A new genre belongs in both lists unless it is similarly non-musical.
- Cache files are written to a `.tmp` beside the target and **renamed into place**, never written at the final path. `existsSync` goes true the instant a file is created, so a plain write of a ~1 MB loop left a window in which a second process (another agent's daemon, a wrapper run, MCP) saw the path, spawned the backend at it and played a torn WAV. Reproduced 4 runs in 5; test [36]d races four processes at one uncached loop and checks each one's bytes against its own header.
- Generated WAVs are cached at `~/.vibeaudio/cache/v<pkg.version>-<synth hash>/s<seed>/`. The key is what makes synth changes reach existing users, and it is **derived, not declared**: `synthFingerprint()` hashes the contents of every `src/synth/*.js`, so changing a generator invalidates the cache whether or not anyone remembers to bump the version. It used to key on the version alone, and that failed 40 commits running — eight of the ten generators changed while the version sat at 0.2.0, so the mechanism documented as delivering audio fixes had never once fired. The version stays in the directory name for legibility only. Costs 0.3 ms at startup. Stale key directories are pruned when a new one is created, and seed directories are pruned to the 3 most recent projects.
- `projectSeed()` hashes `process.cwd()` (overridable via `--seed`/`VIBE_SEED`), so a repo always sounds like itself. This is deliberately **not** per-run: focus music should fade into the background, and per-session novelty works against that. The seed is resolved once in `start()` and held on the player, so tiers within a run stay the same piece.
- Playback backend is detected once from `PLAYER_CANDIDATES` (`afplay` → `paplay` → `ffplay` → `aplay`, plus PowerShell `SoundPlayer` on Windows). If nothing is found, it warns once and runs silently — audio must never block the wrapped command.
- `aplay` and PowerShell `SoundPlayer` take no volume argument. `bakedGain()` decides per backend: 1 when the player attenuates itself (macOS and most Linux keep the existing cache files, bit-identical), otherwise the volume, which `applyGain()` scales into the PCM and `gainSuffix()` puts in the cache filename (`loop_jazz_t2_g25.wav`). **Exactly one of the two must apply** — a file that is both pre-scaled and passed to `-v` is attenuated twice.
- A module-level `process.on("exit")` hook kills live player processes, so an abrupt exit can't orphan audio.
- Muting has two front doors and one gate. `VIBE_DISABLE` suits a shell you want permanently quiet; `--mute`/`--unmute` (`setMuted()`) writes `~/.vibeaudio/muted` for the case the env var cannot reach — a hook is a child of the agent and inherits the environment the agent had at launch, so a variable exported later never arrives, and restarting the agent is precisely what you cannot do while a call is ringing. A file crosses that boundary. `--mute` also calls `stopDaemon()`, because silencing the *next* prompt is no use when the current one is already playing, and `playLoop()` re-checks so a wrapper run (which has no daemon to stop) goes quiet at its next loop boundary. The mute **expires** (`DEFAULT_MUTE_MINUTES`, 60; `--mute 0` opts into indefinite): an unbounded mute the user forgets is indistinguishable from the tool being broken, and nothing would ever surface it — `--status` is a net only for someone who already suspects. `muteState()` clears an expired file as it reads it, so the state converges from whichever process notices first rather than needing a cleanup pass.
- `playbackDisabled()` covers both, and is checked inside `start()` and the chime branch of `stop()` — the two points every *automatic* path funnels through, so the wrapper, the hook daemon and MCP are all covered by one gate. `--preview` spawns the backend directly and is deliberately not gated: it is an explicit request to hear something. Read per playback rather than cached, so exporting it applies on the next prompt.

**Synthesis** (`src/synth/`): `generator.js` holds the shared primitives — `noteToFreq()` (note name → Hz), oscillators (`sine`, `triangle`, `softPulse`, `analogSaw`), `createWavBuffer()` (raw Float samples → 16-bit PCM WAV `Buffer`), and the determinism helpers `makeRng()` (mulberry32), `hashString()` (FNV-1a), `pick()` and `ornamentRng()`. Each genre exports `generate<Genre>Loop(durationSeconds, tier, seed)` and returns a WAV buffer. `chime.js` generates the two outcome chimes (seed-independent).

Three rules hold across every generator:
- **Generation is pure and fully deterministic.** No `Math.random()` — dither and noise draw from the seeded stream, or the same seed would render different bytes and invalidate the cache.
- **The seed selects among curated variants, never invents harmony.** Each genre carries hand-written progressions diatonic to its key, with the bass line that spells those changes. Randomising notes freely produces bad bars; this cannot.
- **Ornaments draw from `ornamentRng(seed)` in a fixed order, regardless of tier.** Gating a layer behind `tier >= 2` must not shift the choices other layers make, or tiers would stop being the same piece with more of it.

When adding a genre, follow that shape, honour both `tier` and `seed`, and wire it into `player.js`'s `generateLoop` switch and `AVAILABLE_GENRES`. Match its level to the existing ones (jazz sits at peak 0.64 / RMS 0.108) — a new generator is easy to write 3x too loud, and volume is applied after this, so a hot render just clips earlier.

`piano.js` is the sparse end of the melodic range: single struck notes (fundamental plus slightly-sharp inharmonic partials, so it reads as a piano rather than a bell) with silence between them and nothing sustaining underneath. Its tiers add notes into the existing gaps — 2, then 4, then 6 — rather than adding layers, so escalation never gives it a pulse.

`drone.js` is the one non-melodic genre: a held tone plus a swept noise bed, for people who cannot read past a melody. Its tiers add weight rather than movement, and its noise rng stream is drawn identically at every tier so the same seed keeps the same bed as the music escalates.

**MCP server** (`src/mcp.js`): exposes `vibe_play` / `vibe_stop` / `vibe_status` tools over stdio JSON-RPC for every client without a hook system (Gemini CLI, Claude Desktop, Antigravity), backed by the same `AudioPlayer` class as the CLI wrapper. Nothing fires these tools automatically — the model chooses to — so the *when to call this* guidance lives in the tool descriptions, which every client shows the model, as well as in the `instructions` field, which the spec makes optional. Because a crashed client never sends `vibe_stop`, playback is capped by `MAX_PLAYBACK_MS` and also stops on stdin close. Tool responses report what actually happened (`start()`/`stop()` return booleans) rather than assuming success, and an unknown genre says it fell back to lofi instead of naming a genre nobody implements.

**Every request leaves with a response.** `tools/call` destructured `params` unconditionally, so a request without them threw, and the only thing catching it wrote to stderr — leaving the client blocked on a reply that was never coming. The line handler now separates a parse failure (no id to answer, stderr is all there is) from a handler throw (answer the id with `-32603`).

**Agent hooks** (`src/hooks.js`): `--install-hooks` merges a prompt-submit → `--hook-start` and a stop → `--hook-stop` entry into the hook config of every supported agent found on the machine.

`TARGETS` holds the only three things that differ between them — file path, event names, entry shape — and every other function takes a target id (default `"claude"`, which is what keeps the existing test signatures working). Verified against the files the tools themselves write, not inferred:

| | file | events | entry shape | root |
| :-- | :-- | :-- | :-- | :-- |
| `claude` | `~/.claude/settings.json` | `UserPromptSubmit` / `Stop` / `PreToolUse` | `{hooks: [{type, command, timeout}]}` | merged into existing settings |
| `codex` | `~/.codex/hooks.json` | same names | same | `{hooks}` only — Codex parses with `deny_unknown_fields`, so nothing else may be added at the root |
| `cursor` | `~/.cursor/hooks.json` | `beforeSubmitPrompt` / `stop` / `preToolUse` | `{command, timeout}` — flat, no nesting | `{version: 1, hooks}` |
| `grok` | `~/.grok/hooks/vibeaudio.json` | same as claude | same as claude | `{hooks}` |

Grok is the one `dedicated: true` target: it reads every `*.json` under `~/.grok/hooks/`, so we write our own file rather than merging, and `uninstallHooks()` deletes it instead of editing it down to an empty husk the tool would keep scanning. It is also the only one whose config path is a directory two levels deep, so `detectTargets()` uses its `configDir()` rather than `path.dirname(file())`.

`setHook()` **appends** rather than prepends. Codex keys its per-hook trust records in `config.toml` as `<file>:<event>:<group>:<index>`, so inserting ahead of an existing hook would invalidate its `trusted_hash` and silently re-prompt the user about someone else's hook. Codex also refuses to run our hook until the user approves it once — `TARGETS.codex.note` says so at install time, because otherwise we'd report an install that isn't live yet.

`detectTargets()` decides what to write to: config directory exists, or the CLI is on `PATH`. The directory is the reliable half — Cursor ships no CLI on `PATH` at all — and `PATH` covers a fresh install whose directory doesn't exist yet. `--tools claude,codex,cursor` overrides it. The interactive menu does **not** auto-detect: it installs for the tool the user picked, since auto-detection belongs to the flag, where nothing was chosen.

They all share one daemon and one pid file, so the last agent prompted owns the music. `ponytail:` deliberate — one user, one set of speakers; per-agent players would need per-agent pid files and a mixing story nobody asked for. Because hooks fire as short-lived processes, playback lives in a detached daemon (`--daemon`, an internal mode) tracked by `~/.vibeaudio/daemon.pid`; `--hook-start` respawns it and `--hook-stop` SIGTERMs it, then plays the chime in the hook process itself.

`stopDaemon()` must confirm the pid before signalling it (`isOurDaemon()`, a `ps` command-line check). A pid file outlives a daemon that died without cleanup and the OS recycles pids, so an unverified kill eventually SIGTERMs an unrelated process — and `hookStart` calls `stopDaemon` on **every prompt**. It fails closed: an unverifiable pid is left alone, because a daemon we don't kill stops itself at `MAX_DAEMON_MS` while killing a stranger's process has no such ceiling. The check is posix-only; win32 trusts the pid.

Tests that touch the daemon must run in a child process with `HOME`/`USERPROFILE` overridden, never by setting `process.env.HOME` in the suite: `hooks.js` resolves `PID_FILE` from `os.homedir()` at require time, so an in-process override silently operates on the real `~/.vibeaudio` and clobbers a live daemon's pid file.

Because the hook command is an absolute path to this checkout, `installHooks()` first calls `ephemeralInstallReason()` and refuses when it's running from an `npx` cache — otherwise npm's eventual cache eviction leaves Claude Code firing a broken hook on every prompt. The guard runs before any write. `src/cli.js` wraps the whole `runHookAction()` dispatch in a try/catch so these (and malformed-settings aborts) print one line and exit 1 instead of a stack trace.

Every supported agent re-reads its hook file on each event rather than caching it at startup, so an install or a genre change lands on the user's **next prompt** with no restart — verified by editing the file mid-session and watching the next daemon spawn with the new argv. Don't reintroduce restart instructions. The one lag is the daemon already playing, which keeps its argv until that next prompt replaces it.

`--hook-stop` reads its stdin payload through `readPayload()` before chiming, because Cursor's stop event reports `status: "completed" | "aborted" | "error"` and that is the only way the failure chime is ever reachable under hooks. Claude Code's `Stop` payload carries no verdict and Codex's `StopRequest` has none either, so both keep success — inventing a failure the agent never claimed would be worse than a flat outcome. `readPayload()` must detach its listeners and `pause()` stdin when it finishes: a resumed stdin keeps the event loop alive by itself, so without that the hook process outlives its work on every turn and sits there until the agent times it out.

`--uninstall-hooks` sweeps **every** target, not just the detected ones — a hook left in the config of a tool that has since been uninstalled is exactly what an uninstall is for. It also calls `stopDaemon()` — from `cli.js`, not from `uninstallHooks()`, which stays a pure config edit so tests can call it against a throwaway file without touching the real `~/.vibeaudio/daemon.pid`. Without that stop, removing the hooks orphans a running player: nothing will send `Stop` again, and `npm rm -g` right after takes away the only binary that could kill it.

Settings writes must stay non-destructive: the file belongs to the user and usually holds other tools' hooks. `isVibeHook()` identifies our entries by the `--hook-start`/`--hook-stop`/`--hook-tool` flags, `setHook()` replaces rather than appends (idempotent reinstall), malformed JSON aborts instead of being overwritten, and the prior file is copied to `settings.json.vibeaudio.bak` — **once, and never overwritten**. The second `--install-hooks` reads a file that already holds our entries, so re-backing up would replace the user's real pre-VibeAudio config with a copy of our own last install, while `--uninstall-hooks` goes on calling it "your pre-VibeAudio config backup". Only the first one is that.

`resolveTargets()` tests `explicit !== null`, not truthiness: `--tools ""` is typed, not absent, and treating it as absent fell through to auto-detection and installed for *every* agent on the machine — the exact opposite of naming one.

`promptInteractive()` returns intent (`installHooks`, `reactive`) and never writes config itself — `cli.js#installHooksFromMenu` performs the install so both entry points share one code path and one report. The delivery and reactive questions are asked only for the tools in `HOOK_TOOLS`; asking elsewhere would offer a control that does nothing. Cursor is not in the launcher's tool list because it has no CLI to launch — `--install-hooks` reaches it by detection instead. An install that throws (npx checkout, malformed settings) is reported and the tool still launches — the user came to start an agent, not to configure one.

**Reactive mode** (`--reactive`, opt-in) adds a pre-tool-use hook that reads the agent's JSON payload from stdin and writes a tier to `~/.vibeaudio/intensity` (`TOOL_TIERS`). The tiers were checked against 30,532 real tool calls: `Task` had been renamed `Agent`, so the heaviest thing in a turn was silently landing on the fallback, and a third of all calls are MCP tools (`mcp__<server>__<tool>`, or `MCP:<tool>` on Cursor) which cannot be enumerated and keep tier 2 deliberately. Tools meaning "the agent has stopped and is waiting for the human" (`AskUserQuestion`, `ExitPlanMode`) sit at tier 1 even though they aren't lookups. Claude Code, Codex and Cursor put the tool's name in `tool_name`; **Grok spells it `toolName`** — `hookTool()` reads both, because reading only one would silently pin that agent to the fallback tier forever. `TOOL_TIERS` carries every vocabulary (Claude's PascalCase, Codex's snake_case, Cursor's short names) in one flat map because they don't collide. The daemon passes `readIntensity` to `AudioPlayer.start()` as the `intensity` option, and `playLoop()` prefers it over the time-based tier, falling back when there's no signal. It stays off by default because music that reacts to every tool call is music the user notices — the opposite of the product's goal. `hookStart`/`hookStop` clear the intensity file so one prompt's activity can't leak into the next.

**HUD** (`src/hud.js`): animates an ASCII waveform in the terminal **title bar only** — the wrapped tool may own the screen by the time music starts, so drawing inline would corrupt a full-screen TUI. `stop()` is inert unless `start()` ran and is idempotent, since `cleanup()` can be reached from more than one path.

## Conventions

- Every module in `src/synth/` is pure — no I/O, just math producing sample arrays — keep it that way so `test/test-synth.js` can assert on generator output directly.
- CLI flags/env vars are parsed once in `src/cli.js#parseArgs`, which is unit-tested directly (imported into `test/test-synth.js`) — extend that function's `while` loop for new flags rather than parsing args elsewhere. A new flag that takes a value belongs in `VALUE_FLAGS` too, or a trailing `vibe --yourflag` falls through every branch into `cmdArgs` and the wrapper reports ENOENT on a program named after the flag. **No flag may be detected by scanning `process.argv`** — `--mcp` was, so `vibe npm test --mcp` started a server instead of running the tests; the parse loop stops at the first non-flag, which is what keeps the child's flags the child's.
- `bin/vibeaudio.js` catches `run()`'s rejection. It is async, so anything escaping it is an unhandled rejection: a stack trace, and a hard crash on Node 18+. Likewise, only the interactive *menu* exits quietly on throw — wrapping the launch in that same catch turned every real failure into a silent exit 0, which for a wrapper is the worst available outcome (`vibe && deploy` chains on a run that never happened).
- The HUD reports the chime that **played** (`chimed`), not the one the outcome implies: `--no-chime` and a mute both leave it silent, and announcing a chime nobody heard sends the user looking for a broken speaker.
- A test that exercises an install path must redirect `HOME`/`USERPROFILE` to a temp directory. The assertion exists because the bug *writes config*, so a regression has to land somewhere disposable rather than in whoever runs the suite.
- Volume arrives as a string from env/flags and as a number from MCP, so every entry point goes through `player.js#normalizeVolume`. A second hand-rolled clamp is how `VIBE_VOLUME=loud` reached the player as `NaN`.
- `test/test-synth.js` runs on Linux, macOS and Windows in CI. Spawn `process.execPath` rather than `sleep`/`true`/`false`, and guard posix-only assertions on `process.platform`.
