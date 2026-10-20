import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'vibeaudio-mod',
  component: 'Pane',
  requestId: 'vibeaudio',
  surface: 'terminal',
  viewport: { columns: 100, rows: 30 },
  props: { title: 'VibeAudio', isFocused: true, bodyColumns: 60, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

const BAND = {
  plugin: 'vibeaudio-mod',
  component: 'AbovePrompt',
  requestId: 'band',
  surface: 'terminal',
  viewport: { columns: 100, rows: 30 },
  props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {} },
} as const

type Setup = { files?: Record<string, string>; surfaces?: string[]; failRun?: boolean; strip?: boolean; state?: unknown; doctor?: string; cwd?: string; theme?: string; usage?: unknown; why?: string }

// Answers everything the mod asks Claude Code for, and records what it did.
async function boot($: any, on: any, opts: Setup = {}) {
  const ran: string[][] = []
  const toasts: string[] = []
  const files = opts.files ?? {}
  mock.clock(on)
  on('turn.start', () => ({ turnId: 't1' }))
  on('turn.complete', () => ({ text: '' }))
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ value: undefined }))
  on('env.get', () => ({ value: '/home/u' }))
  on('fs.read', ($: any, e: any) => {
    const hit = Object.keys(files).find((k) => e.path.endsWith(k))
    return hit ? { value: files[hit] } : { deny: 'ENOENT' }
  })
  on('fs.exists', () => ({ value: true }))
  on('session.surfaces', () => ({ value: opts.surfaces ?? ['terminal'] }))
  on('ui.toast', ($: any, e: any) => { toasts.push(e.text); return { value: undefined } })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const seen: any[] = []
  on('ui.render', ($: any, e: any) => { seen.push(e); return { type: 'Text', props: {}, children: ['drawn by Claude Code'] } })
  const saved = new Map<string, unknown>([['strip', opts.strip === true]])
  on('store.get', ($: any, e: any) => ({ value: saved.get(e.key) }))
  on('store.set', ($: any, e: any) => { saved.set(e.key, e.value); return { value: undefined } })
  on('config.list', () => ({ value: opts.theme ? [{ key: 'theme', value: opts.theme }] : [] }))
  on('session.id', () => ({ value: 'me' }))
  on('session.usage', () => ({ value: opts.usage ?? { startedAt: 0, context: {}, rateLimits: [] } }))
  on('session.cwd', () => ({ value: opts.cwd ?? '/work' }))
  on('process.run', ($: any, e: any) => {
    if (e.argv.includes('--state')) return { value: { exitCode: 0, stdout: JSON.stringify(opts.state ?? { v: 1, status: 'idle', sessions: [] }), stderr: '' } }
    if (e.argv.includes('--why')) return { value: { exitCode: 0, stdout: (opts.why ?? '') + '\n', stderr: '' } }
    ran.push(e.argv)
    if (e.argv.includes('--doctor')) return { value: { exitCode: 1, stdout: opts.doctor ?? '', stderr: '' } }
    return opts.failRun ? { deny: 'spawn vibe ENOENT' } : { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  return { ran, toasts, saved, seen }
}

const run = ($: any, args: string) => $.command.run({ command: 'vibeaudio', args })

test('mute runs the CLI and confirms with a toast, not text', async ($, on) => {
  const s = await boot($, on)
  const r = await run($, 'mute')
  expect(s.ran).toEqual([['vibe', '--mute']])
  expect(s.toasts).toEqual(['Muted for 60 min'])
  expect(r.text).toBeUndefined()
})

test('mute takes minutes, 0 is until unmuted', async ($, on) => {
  const s = await boot($, on)
  await run($, 'mute 15')
  await run($, 'mute 0')
  expect(s.ran).toEqual([['vibe', '--mute', '15'], ['vibe', '--mute', '0']])
  expect(s.toasts).toEqual(['Muted for 15 min', 'Muted until you unmute'])
})

test('an argument can never become a flag', async ($, on) => {
  const s = await boot($, on)
  await run($, 'genre --uninstall-hooks')
  await run($, 'volume -5')
  await run($, 'mute --stop')
  await run($, 'card ../../x')
  await run($, 'music maybe')
  expect(s.ran).toEqual([])
})

test('genre, volume, music, speak and notify map to one CLI call each', async ($, on) => {
  const s = await boot($, on)
  await run($, 'genre JAZZ')
  await run($, 'volume 30')
  await run($, 'music off')
  await run($, 'speak always')
  await run($, 'notify on')
  await run($, 'unmute')
  expect(s.ran).toEqual([
    ['vibe', '--genre', 'jazz'],
    ['vibe', '--volume', '30'],
    ['vibe', '--music', 'off'],
    ['vibe', '--speak-always'],
    ['vibe', '--notify'],
    ['vibe', '--unmute'],
  ])
})

test('card asks for the week and says where it went', async ($, on) => {
  const s = await boot($, on)
  await run($, 'card')
  await run($, 'card 30')
  expect(s.ran).toEqual([['vibe', '--report', '7', '--card'], ['vibe', '--report', '30', '--card']])
  expect(s.toasts[0]).toBe('Card saved: /home/u/.vibeaudio/card.png')
})

test('a missing vibe is one clear message', async ($, on) => {
  const s = await boot($, on, { failRun: true })
  await run($, 'mute')
  expect(s.toasts).toEqual(['could not run vibe - install it with: npm i -g vibeaudio'])
})

test('where nothing draws, the answer is text instead of a toast', async ($, on) => {
  const s = await boot($, on, { surfaces: [] })
  const r = await run($, 'mute')
  expect(r.text).toBe('Muted for 60 min')
  expect(s.toasts).toEqual([])
})

test('the band shows only while muted, with the minutes left', async ($, on) => {
  const until = Date.now() + 42 * 60000
  await boot($, on, { files: { '.vibeaudio/muted': JSON.stringify({ since: 'x', until }) } })
  const ui = await $.ui.mount({ ...BAND })
  expect(await ui.find({ type: 'Text', text: /VibeAudio muted - 4[12] min left/ })).toBeDefined()
})

test('the band draws nothing of its own when not muted', async ($, on) => {
  await boot($, on)
  const ui = await $.ui.mount({ ...BAND })
  expect(await ui.find({ type: 'Text', text: /VibeAudio muted/ })).toBeUndefined()
})

test('an expired mute file does not show the band', async ($, on) => {
  await boot($, on, { files: { '.vibeaudio/muted': JSON.stringify({ since: 'x', until: Date.now() - 1000 }) } })
  const ui = await $.ui.mount({ ...BAND })
  expect(await ui.find({ type: 'Text', text: /VibeAudio muted/ })).toBeUndefined()
})

test('the pane draws the saved settings and its buttons run the CLI', async ($, on) => {
  const s = await boot($, on, { files: { '.vibeaudio/config.json': JSON.stringify({ genre: 'jazz', volume: 30 }) } })
  await run($, '')
  const ui = await $.ui.mount({ ...PANE })
  expect(await ui.find({ type: 'Text', text: /^music on - sound on$/ })).toBeDefined()
  await ui.press({ key: 'mute' })
  await ui.press({ key: 'vol-up' })
  await ui.press({ key: 'speak' })
  expect(s.ran).toEqual([['vibe', '--mute'], ['vibe', '--volume', '40'], ['vibe', '--speak']])
})

test('the same pane draws on the Desktop app', async ($, on) => {
  await boot($, on)
  await run($, '')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'mute' })).toBeDefined()
})

test('the band is off by default: nothing is drawn when not muted', async ($, on) => {
  await boot($, on)
  const ui = await $.ui.mount({ ...BAND })
  expect(await ui.find({ type: 'Text', text: /^♪/ })).toBeUndefined()
})

test('band on is remembered, and the band shows the sound and its buttons', async ($, on) => {
  const s = await boot($, on, { files: { '.vibeaudio/config.json': JSON.stringify({ genre: 'jazz', volume: 30 }) } })
  await run($, 'band on')
  expect(s.saved.get('strip')).toBe(true)
  expect(s.toasts).toEqual(['Band on'])
  const ui = await $.ui.mount({ ...BAND })
  expect(await ui.find({ type: 'Text', text: '♪ jazz 30%' })).toBeDefined()
  await ui.press({ key: 'strip-mute' })
  expect(s.ran).toEqual([['vibe', '--mute']])
})

test('the pane and the band say why, in the CLI\'s own words', async ($, on) => {
  const why = 'silent: music is off for this project; chimes still play (vibe --music on --here)'
  const s = await boot($, on, { why, strip: true })
  await run($, '')
  const pane = await $.ui.mount({ ...PANE })
  expect(await pane.find({ type: 'Text', text: why })).toBeDefined()
  const band = await $.ui.mount({ ...BAND })
  expect(await band.find({ type: 'Text', text: why })).toBeDefined()
  expect(s.ran).toEqual([]) // reading it is not a change
})

test('the band comes back on its own in the next session', async ($, on) => {
  await boot($, on, { strip: true })
  const ui = await $.ui.mount({ ...BAND })
  expect(await ui.find({ type: 'Text', text: /^♪/ })).toBeDefined()
})

test('the band does not list other agents', async ($, on) => {
  await boot($, on, {
    strip: true,
    state: { v: 1, status: 'waiting', sessions: [
      { session: 'me', project: '/work/vibeaudio', state: 'working' },
      { session: 'b', project: '/work/api', state: 'waiting' },
      { session: 'c', project: 'C:\\work\\web', state: 'working' },
    ] },
  })
  const ui = await $.ui.mount({ ...BAND })
  expect(await ui.find({ type: 'Text', text: /api|web/ })).toBeUndefined()
})

test('the band shows the last 7 days from the history log', async ($, on) => {
  const now = Date.now()
  const line = (ago: number, ms: number) => JSON.stringify({ at: now - ago, ms, blockedMs: 0, outcome: 'success' })
  await boot($, on, { strip: true, files: { '.vibeaudio/history.jsonl': [line(1000, 60000), line(86400000, 120000), line(9 * 86400000, 999999)].join('\n') } })
  const ui = await $.ui.mount({ ...BAND })
  expect(await ui.find({ type: 'Text', text: '7 days' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '2 turns' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '3m waited' })).toBeDefined()
})

test('the band buttons run the CLI, and the card button makes the card', async ($, on) => {
  const s = await boot($, on, { strip: true, files: { '.vibeaudio/config.json': JSON.stringify({ volume: 40 }) } })
  const ui = await $.ui.mount({ ...BAND })
  await ui.press({ key: 'strip-music' })
  await ui.press({ key: 'strip-genre' })
  await ui.press({ key: 'strip-vol-down' })
  await ui.press({ key: 'strip-vol-up' })
  await ui.press({ key: 'strip-card' })
  expect(s.ran).toEqual([
    ['vibe', '--music', 'off'],
    ['vibe', '--genre', 'synthwave'],
    ['vibe', '--volume', '30'],
    ['vibe', '--volume', '50'],
    ['vibe', '--report', '7', '--card'],
  ])
})

test('the logo moves only while music plays', async ($, on) => {
  await boot($, on, { strip: true })
  const ui = await $.ui.mount({ ...BAND })
  expect(await ui.find({ type: 'Text', text: '▃▇▅' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /playing/ })).toBeUndefined()
  await $.turn.start({ turnId: 't1' })
  expect(await ui.find({ type: 'Text', text: /playing/ })).toBeDefined()
  await $.turn.complete({ turnId: 't1', answer: '' })
  expect(await ui.find({ type: 'Text', text: /playing/ })).toBeUndefined()
})

test('the Desktop band draws the logo as an SVG', async ($, on) => {
  await boot($, on, { strip: true, surfaces: ['desktop'] })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
})

test('the pane charts the week and drops the hotkey from Desktop labels', async ($, on) => {
  const now = Date.now()
  const line = (ago: number, ms: number) => JSON.stringify({ at: now - ago, ms, blockedMs: 0, outcome: 'success' })
  await boot($, on, { surfaces: ['desktop'], files: { '.vibeaudio/history.jsonl': [line(1000, 60000), line(2 * 86400000, 30000)].join('\n') } })
  await run($, '')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^[\u2581-\u2588\u00b7 ]+$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', label: 'Mute 1h' })).toBeDefined()
})

const SPINNER = {
  plugin: 'vibeaudio-mod',
  component: 'Spinner',
  requestId: 'spin',
  surface: 'terminal',
  viewport: { columns: 100, rows: 30 },
  props: { word: 'Thinking', message: null, suffix: '…', mode: 'thinking' },
} as const

test('with the band on, the spinner says what is playing', async ($, on) => {
  const s = await boot($, on, { strip: true, files: { '.vibeaudio/config.json': JSON.stringify({ genre: 'jazz' }) } })
  await $.turn.start({ turnId: 't1' })
  await $.ui.mount({ ...SPINNER })
  expect(s.seen.filter((e) => e.component === 'Spinner').pop().props.suffix).toBe(' · ♪ jazz…')
})

test('with the band off, the spinner is left alone', async ($, on) => {
  const s = await boot($, on)
  await $.turn.start({ turnId: 't1' })
  await $.ui.mount({ ...SPINNER })
  expect(s.seen.filter((e) => e.component === 'Spinner').pop().props.suffix).toBe('…')
})

test('the pane picks its colours from the theme', async ($, on) => {
  await boot($, on, { theme: 'light', files: { '.vibeaudio/config.json': JSON.stringify({ genre: '8bit' }) } })
  await run($, '')
  const ui = await $.ui.mount({ ...PANE })
  expect(await ui.find({ type: 'Text', text: '8BIT', color: '#17753f' })).toBeDefined()
})

test('an unknown theme gets the middle palette', async ($, on) => {
  await boot($, on, { theme: 'auto', files: { '.vibeaudio/config.json': JSON.stringify({ genre: '8bit' }) } })
  await run($, '')
  const ui = await $.ui.mount({ ...PANE })
  expect(await ui.find({ type: 'Text', text: '8BIT', color: '#1f9d55' })).toBeDefined()
})

test('the status chip is a dark block only on a dark theme', async ($, on) => {
  const until = Date.now() + 4 * 60000
  await boot($, on, { theme: 'light', files: { '.vibeaudio/muted': JSON.stringify({ since: 'x', until }) } })
  await run($, '')
  const ui = await $.ui.mount({ ...PANE })
  const light = await ui.find({ type: 'Text', text: /^MUTED \d+ MIN$/ })
  expect(light.props.color).toBe('#96590a')
  expect(light.props.backgroundColor).toBeUndefined()
})

test('a dark theme keeps the dark status chip', async ($, on) => {
  const until = Date.now() + 4 * 60000
  await boot($, on, { theme: 'dark', files: { '.vibeaudio/muted': JSON.stringify({ since: 'x', until }) } })
  await run($, '')
  const ui = await $.ui.mount({ ...PANE })
  expect(await ui.find({ type: 'Text', text: /MUTED/, color: '#ffb454', backgroundColor: '#140c22' })).toBeDefined()
})

test('band needs on or off', async ($, on) => {
  const s = await boot($, on)
  await run($, 'band maybe')
  expect(s.saved.get('strip')).toBe(false)
})

const DOCTOR_PANE = { ...PANE, requestId: 'vibeaudio-doctor' }
const REPORT = [
  '\u001b[1m\u001b[36mVibeAudio\u001b[0m v0.21.0 doctor',
  '',
  '  \u001b[32m\u2714\u001b[0m Audio player              \u001b[90mafplay\u001b[0m',
  '  \u001b[33m!\u001b[0m Codex hook trust          \u001b[90m6 hooks not yet approved\u001b[0m',
  '      fix: start codex and approve each VibeAudio hook once',
  '',
  '\u001b[32mNo problems\u001b[0m, 1 to look at.',
].join('\n')

test('here saves for this project only', async ($, on) => {
  const s = await boot($, on)
  await run($, 'genre zen here')
  await run($, 'volume 20 here')
  await run($, 'music off here')
  await run($, 'genre zen everywhere')
  expect(s.ran).toEqual([
    ['vibe', '--genre', 'zen', '--here'],
    ['vibe', '--volume', '20', '--here'],
    ['vibe', '--music', 'off', '--here'],
  ])
})

test('a folder\'s own settings are what the pane shows, found from a subfolder', async ($, on) => {
  await boot($, on, {
    cwd: '/work/app/src',
    files: { '.vibeaudio/config.json': JSON.stringify({ genre: 'ocean', volume: 25, projects: { '/work/app': { genre: 'zen' } } }) },
  })
  await run($, '')
  const ui = await $.ui.mount({ ...PANE })
  expect(await ui.find({ type: 'Text', text: 'music on - sound on - this project' })).toBeDefined()
})

test('the pane saves for the project when asked to', async ($, on) => {
  const s = await boot($, on)
  await run($, '')
  const ui = await $.ui.mount({ ...PANE })
  await ui.press({ key: 'scope' })
  await ui.press({ key: 'vol-up' })
  expect(s.ran).toEqual([['vibe', '--volume', '50', '--here']])
})

test('doctor shows the report even though vibe exits 1 on a problem', async ($, on) => {
  const s = await boot($, on, { doctor: REPORT })
  const r = await run($, 'doctor')
  expect(s.ran).toEqual([['vibe', '--doctor']])
  expect(r.text).toBeUndefined()
  const ui = await $.ui.mount({ ...DOCTOR_PANE })
  expect(await ui.find({ type: 'Text', text: /Codex hook trust/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /fix: start codex/ })).toBeDefined()
})

test('where nothing draws, doctor answers with the problems only', async ($, on) => {
  await boot($, on, { surfaces: [], doctor: REPORT })
  const r = await run($, 'doctor')
  expect(r.text).toContain('Codex hook trust')
  expect(r.text).toContain('fix: start codex')
  expect(r.text).not.toContain('Audio player')
})

const USAGE = { startedAt: 0, context: { percent: 42.4 }, rateLimits: [{ kind: 'five_hour', percentUsed: 31 }, { kind: 'seven_day', percentUsed: 12 }] }

test('the band shows context and rate limits only after usage is turned on', async ($, on) => {
  await boot($, on, { strip: true, usage: USAGE })
  const ui = await $.ui.mount({ ...BAND })
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeUndefined()
  await run($, 'usage on')
  expect(await ui.find({ type: 'Text', text: 'ctx 42%  5h 31%  7d 12%' })).toBeDefined()
  await run($, 'usage off')
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeUndefined()
})

test('usage turns the figure warning-coloured near the limit and rejects other words', async ($, on) => {
  const s = await boot($, on, { strip: true, usage: { startedAt: 0, context: { percent: 91 }, rateLimits: [] } })
  const ui = await $.ui.mount({ ...BAND })
  await run($, 'usage on')
  const hot = await ui.find({ type: 'Text', text: 'ctx 91%' })
  expect(hot.props.color).toBe('warning')
  const r = await run($, 'usage maybe')
  expect(r.text ?? s.toasts.join()).toContain('usage on|off')
})

test('help lists the commands and the "here" option', async ($, on) => {
  const s = await boot($, on, {})
  const r = await run($, 'help')
  const out = (r.text ?? s.toasts.join()) as string
  expect(out).toContain('Usage: /vibeaudio')
  expect(out).toContain('here')
  expect(s.ran).toEqual([])
})

test('the pane redraws at the first press of Band and Usage', async ($, on) => {
  await boot($, on, { strip: true })
  await run($, '')
  const ui = await $.ui.mount({ ...PANE })
  expect(await ui.find({ type: 'Button', label: 'Band off' })).toBeDefined()
  await ui.press({ key: 'strip' })
  expect(await ui.find({ type: 'Button', label: 'Band on' })).toBeDefined()
  expect(await ui.find({ type: 'Button', label: 'Usage on' })).toBeDefined()
  await ui.press({ key: 'usage' })
  expect(await ui.find({ type: 'Button', label: 'Usage off' })).toBeDefined()
})

test('the pane has Stop, Preview, Announce and a 15 minute mute, each one CLI call', async ($, on) => {
  const s = await boot($, on, { files: { '.vibeaudio/config.json': JSON.stringify({ genre: 'zen' }) } })
  await run($, '')
  const ui = await $.ui.mount({ ...PANE })
  await ui.press({ key: 'mute-short' })
  await ui.press({ key: 'stop' })
  await ui.press({ key: 'preview' })
  await ui.press({ key: 'announce' })
  expect(s.ran).toEqual([
    ['vibe', '--mute', '15'],
    ['vibe', '--stop'],
    ['vibe', '--preview', 'zen'],
    ['vibe', '--announcements', 'off'],
  ])
  expect((await run($, 'announce maybe')).text ?? s.toasts.join()).toContain('announce on|off')
})
