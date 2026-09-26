## What this changes

<!-- One or two sentences. If it fixes an issue, write "Fixes #123". -->

## Why

<!-- What was wrong, or what this makes possible. The reasoning matters more
     than the diff here - CLAUDE.md records why things are the way they are,
     and a PR that explains itself is what keeps that true. -->

## Checklist

- [ ] `npm test` passes
- [ ] I listened to it, if I touched audio (`--clear-cache` first, or you will hear the previous render)
- [ ] No new runtime dependencies (`package.json` has no `dependencies` block, and shouldn't)
- [ ] No build step introduced
- [ ] New flags go through `parseArgs` in `src/cli.js` (and into `VALUE_FLAGS` if they take a value)

## If you touched `src/synth/`

- [ ] Still pure - no I/O, no `Math.random()`, same seed renders the same bytes
- [ ] Honours `tier`, `seed` and `bar`
- [ ] Level matches the other genres (jazz sits at peak 0.64 / RMS 0.108)
- [ ] Golden hashes in test [43] updated, and I checked the change was one I meant to make

## If you touched playback or hooks

- [ ] Tried it on the platforms I could - `src/player.js` picks a different backend per OS
- [ ] A failure here still lets the wrapped command run and pass its exit code through

<!-- Small, focused PRs get reviewed faster. Thanks for sending this. -->
