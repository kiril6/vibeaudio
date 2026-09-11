# Contributing to VibeAudio

Contributions welcome. To keep the project simple and dependable, a few ground rules.

## Principles

- **Zero runtime dependencies.** `package.json` has no `dependencies` block and should stay that way. Every oscillator, envelope and WAV header is hand-rolled in `src/synth/`. Don't add a package for what a few lines of math can do.
- **No build step.** Plain CommonJS Node (`engines.node >= 18`). No bundler, no transpiler, no `node-gyp` — `npx github:kiril6/vibeaudio` must keep working on a clean machine.
- **Keep `src/synth/` pure.** Those modules take numbers and return a WAV `Buffer`. No file I/O, no spawning, no globals — that purity is what lets `test/test-synth.js` assert on generator output directly.
- **Parse arguments in one place.** All flags and env vars go through `parseArgs` in `src/cli.js`, which is unit-tested. Don't read `process.argv` or `process.env` anywhere else.
- **Never let audio break the wrapped command.** VibeAudio is a wrapper; if playback fails, the user's tool must still run, and the exit code must still propagate unchanged.
- **Test on more than one platform** when touching playback (`src/player.js`) — the backend differs per OS.

## Architecture

[`CLAUDE.md`](CLAUDE.md) is the architecture + conventions brief — read it first if you're changing anything beyond a single genre.

Short version:

```
bin/vibeaudio.js → src/cli.js#run()
                     ├─ --mcp        → src/mcp.js   (JSON-RPC stdio server)
                     ├─ no args +TTY → src/interactive.js (launcher menu)
                     └─ <command>    → executeCommand() → spawn child
                                          ├─ src/player.js (cache + playback)
                                          └─ src/hud.js    (tab title HUD)
```

`src/player.js` owns the audio cache (`~/.vibeaudio/cache/v<version>/`), OS player detection, tier escalation and the gapless loop scheduler.

## AI-assisted development

This project is built with the help of [Claude Code](https://claude.com/claude-code), and you're welcome to continue that way (Claude Code, Cursor, or any other AI tool). [`CLAUDE.md`](CLAUDE.md) is loaded automatically by Claude Code and is the fastest way to get an agent oriented.

## Adding a genre

1. Create `src/synth/<name>.js` exporting `generate<Name>Loop(durationSec, tier, seed)`.
2. Build it from the shared primitives in `src/synth/generator.js` (`noteToFreq`, `sine`, `triangle`, `softPulse`, `analogSaw`, `createWavBuffer`).
3. **Honour the `tier` argument** — tier 1 is a sparse intro, tier 2 the main groove, tier 3 the peak layer. A generator that ignores `tier` produces three identical cache files and silently breaks escalation.
4. **Honour the `seed` argument, and stay deterministic.** Write 2–4 hand-checked progression variants, all diatonic to one key, each with the bass line that spells its changes; `pick(makeRng(seed), VARIANTS)` chooses one. Never `Math.random()` — dither goes through `ornamentRng(seed)` too, or the same seed renders different bytes and the cache breaks.
5. **Draw ornaments before gating them by tier.** If a `tier >= 2` branch consumes random values, tier 1 and tier 3 stop being the same piece.
6. Fade the first and last ~0.08s so the loop boundary doesn't click.
7. Register it in `src/player.js`: add to `AVAILABLE_GENRES` and to the `generateLoop` switch.
8. Add it to the menu in `src/interactive.js`, the genre table in `README.md`, and the tier/seed tests in `test/test-synth.js`.

**Listen before you ship.** The test suite proves a generator is deterministic and that tiers differ — it cannot tell you whether the result sounds good. Use `--preview` with a few seeds (`vibe --seed 1 --preview <name>`, then 2, 3…) and actually listen to each variant.

## Dev loop

```bash
node bin/vibeaudio.js sleep 5          # run the wrapper without installing
node bin/vibeaudio.js --preview jazz   # audition a genre
node bin/vibeaudio.js --clear-cache    # force regeneration after a synth change
npm test                               # full suite (plain node + assert)
```

`npm test` is a single linear script of assertions — no framework, no filtering. Keep it that way, and keep it fast.

> **After changing anything in `src/synth/`, run `--clear-cache` before listening.** Audio is cached per version, so during development on an unchanged version number you'll otherwise keep hearing the old render.

## Submitting changes

This repo uses the standard **fork & pull-request** flow:

1. **Fork** this repo to your own account and clone your fork.
2. Create a branch: `git checkout -b my-change`.
3. Make your change, run `npm test`, and listen to the result if you touched audio.
4. Push to your fork and **open a pull request** against `kiril6/vibeaudio`.
5. The maintainer reviews and merges.

Keep PRs focused and small where you can; it makes review faster.

## Releasing (maintainers)

**Contributors don't do this.** You fork and open a PR (see above) — that's the whole job.

```bash
# 1. Bump the version - this also invalidates every user's audio cache,
#    which is how synth changes actually reach people.
npm version patch          # or minor / major

# 2. Push the commit and tag
git push --follow-tags

# 3. Publish to the public registry
npm publish --access public --registry=https://registry.npmjs.org
```

Pick the bump by semver: patch = fix, minor = feature, major = breaking. Note the explicit `--registry` — if your global npm config points at a private feed, a bare `npm publish` will push there instead.

## Reporting bugs

[Open an issue](https://github.com/kiril6/vibeaudio/issues/new) with:

- Your **OS** and **Node version** (`node --version`)
- Which **audio player** you have (`which afplay paplay ffplay aplay`)
- The exact command you ran, and whether the wrapped tool itself behaved correctly
