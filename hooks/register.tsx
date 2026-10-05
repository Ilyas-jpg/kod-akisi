// Kod Akışı: Claude çalışırken modelin akışını (turn.step) dinler; yazdığı
// dosyayı, yaptığı düzenlemeyi ve çalıştırdığı komutu yan panelde canlı çizer.
// Hiçbir olayı değiştirmez: her parça ve her araç sonucu geldiği gibi geçer.

import type { CodeProps, Elements, Register, Timer, TurnStepChunk } from 'claude-code'

import type { Feed, Hunk, Kind, Phase, Row, Stage, Status } from '../types'
import {
  clamp,
  clean,
  countChanges,
  feedJson,
  fitEnd,
  fitHunks,
  fitStart,
  fmtCount,
  fmtMs,
  fmtSize,
  lastLines,
  liveHunk,
  newReader,
  newTail,
  oneLine,
  outputTail,
  shortPath,
  sparkline,
  tailLines,
  tailOf,
  tailPush,
  tailView,
  toHunks,
  toolLabel,
  windowSource,
} from './akis'
import type { Reader, Tail } from './akis'

const PANE = 'kod-akisi'
const TITLE = 'Kod Akışı'
const SITE = 'ilyassaltay.com'
const feedRef = { plugin: 'kod-akisi', key: 'feed' } as const
const closedRef = { plugin: 'kod-akisi', key: 'isClosed' } as const

const FLUSH_MS = 80
const BEAT_MS = 400
const IDLE_MS = 5 * 60_000
const ITEMS_MAX = 40
const ROWS_MAX = 12
const SPARK_MAX = 64
const TICKER_MAX = 400
const STAGE_CHARS = 6000
const TOOL_W = 10

const VIOLET = '#8B5CF6'
const CYAN = '#06B6D4'
const PINK = '#EC4899'
const AMBER = '#F59E0B'
const GREEN = '#10B981'
const RED = '#EF4444'
const BLUE = '#3B82F6'
const EMERALD = '#00B57A'

const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
const CURSOR = '▍'

const KIND_COLOR: Record<Kind, string> = { write: CYAN, edit: PINK, shell: AMBER, other: BLUE }

const PHASES: Record<Phase, { label: string; color: string }> = {
  idle: { label: 'hazır', color: GREEN },
  thinking: { label: 'düşünüyor', color: VIOLET },
  talking: { label: 'anlatıyor', color: BLUE },
  writing: { label: 'yazıyor', color: CYAN },
  running: { label: 'çalıştırıyor', color: AMBER },
}

const LOOKS: Record<Status, { glyph: string; color: string; label: string; isDim: boolean }> = {
  streaming: { glyph: '▸', color: CYAN, label: 'yazılıyor', isDim: false },
  ready: { glyph: '◇', color: BLUE, label: 'sırada', isDim: false },
  running: { glyph: '▸', color: AMBER, label: 'çalışıyor', isDim: false },
  done: { glyph: '✓', color: GREEN, label: 'tamam', isDim: true },
  error: { glyph: '✗', color: RED, label: 'hata', isDim: false },
  denied: { glyph: '⊘', color: AMBER, label: 'reddedildi', isDim: false },
  stopped: { glyph: '◌', color: AMBER, label: 'durduruldu', isDim: true },
}

/** Sahneye çıkan araçlar: hangi argüman akar, hangi dille boyanır. */
const SPECS = new Map<string, { kind: Kind; main: string; language: string }>([
  ['Write', { kind: 'write', main: 'content', language: '' }],
  ['Edit', { kind: 'edit', main: 'new_string', language: '' }],
  ['NotebookEdit', { kind: 'write', main: 'new_source', language: '' }],
  ['Bash', { kind: 'shell', main: 'command', language: 'bash' }],
  ['PowerShell', { kind: 'shell', main: 'command', language: 'powershell' }],
])

/** Başka araçlarda uzun ya da çok satırlı gelirse sahneye alınan argümanlar. */
const PAYLOADS = new Map<string, string>([
  ['code', ''],
  ['content', ''],
  ['source', ''],
  ['script', ''],
  ['body', ''],
  ['sql', 'sql'],
  ['query', 'sql'],
  ['html', 'html'],
  ['widget_code', 'html'],
  ['markdown', 'markdown'],
  ['prompt', 'markdown'],
  ['message', 'markdown'],
])

const TITLE_KEYS = [
  'pattern',
  'query',
  'url',
  'path',
  'skill',
  'subagent_type',
  'description',
  'command',
  'prompt',
  'title',
  'name',
  'question',
  'text',
]

type Live = {
  id: string
  name: string
  kind: Kind
  mainKey: string
  language: string
  reader: Reader
  fields: Map<string, Tail>
  hunks: Hunk[]
  output: string
  status: Status
  startedAt: number
  ms: number
  isAgent: boolean
}

type Table = Pick<Elements['terminal'], 'Box' | 'Text' | 'Code' | 'Link'>

const EMPTY: Feed = {
  rows: [],
  stage: null,
  isWorking: false,
  phase: 'idle',
  ticker: '',
  tick: 0,
  speeds: [],
  tools: 0,
  tokens: 0,
  elapsedMs: 0,
}

// Modülün kendi belleği: sıcak yeniden yüklemede sıfırlanır, çizilen durum
// $.state'te kalır ve session.start'ta geri alınır.
const S = {
  items: [] as Live[],
  byId: new Map<string, Live>(),
  stage: null as Live | null,
  restored: null as Feed | null,
  cwd: '',
  isWorking: false,
  phase: 'idle' as Phase,
  ticker: '',
  tickerPhase: 'idle' as Phase,
  tick: 0,
  speeds: [] as number[],
  typed: 0,
  typedSeen: 0,
  tools: 0,
  tokens: 0,
  startedAt: 0,
  elapsedMs: 0,
  lastEvent: 0,
  lastFlush: 0,
  isDirty: false,
  pending: undefined as Promise<void> | undefined,
  timer: undefined as Timer | undefined,
  beat: undefined as Timer | undefined,
}

// Motor ($) bir değişkende tutulamaz; kancanın içinde kurulan bu üç kapanış
// zamanlayıcıların ve kısılmış yazının motora ulaştığı tek yoldur.
type Io = {
  save: (feed: Feed) => Promise<unknown>
  after: (ms: number, fn: () => void) => Timer
  every: (ms: number, fn: () => void) => Timer
}

let io: Io | undefined

const now = (): number => Date.now()

const textOf = (live: Live, key: string): string => live.fields.get(key)?.text ?? ''

// --- Akıştan gelen araç çağrıları -------------------------------------------

function startLive(id: string, name: string, isAgent: boolean): Live {
  const spec = SPECS.get(name)
  const live: Live = {
    id,
    name,
    kind: spec?.kind ?? 'other',
    mainKey: spec?.main ?? '',
    language: spec?.language ?? '',
    reader: newReader(),
    fields: new Map(),
    hunks: [],
    output: '',
    status: 'streaming',
    startedAt: now(),
    ms: 0,
    isAgent,
  }

  S.items.push(live)
  S.byId.set(id, live)

  if (S.items.length > ITEMS_MAX) {
    const gone = S.items.shift()

    if (gone !== undefined) {
      S.byId.delete(gone.id)
    }
  }

  if (spec !== undefined) {
    S.stage = live
  }

  return live
}

function take(live: Live, key: string, text: string): void {
  let tail = live.fields.get(key)

  if (tail === undefined) {
    tail = newTail()
    live.fields.set(key, tail)
  }

  tailPush(tail, text)
  S.typed += text.length

  const language = PAYLOADS.get(key)

  if (live.mainKey === '' && language !== undefined && (tail.newlines > 0 || tail.chars >= 160)) {
    live.mainKey = key
    live.kind = 'write'
    live.language = language
    S.stage = live
  }
}

/** Kesin argüman akışta eksik kaldıysa (ya da akış hiç görülmediyse) tamamlar. */
function setField(live: Live, key: string, value: unknown): void {
  if (typeof value === 'string' && live.fields.get(key)?.chars !== value.length) {
    live.fields.set(key, tailOf(value))
  }
}

function titleOf(live: Live): string {
  const path = textOf(live, 'file_path') || textOf(live, 'notebook_path')

  if (path !== '') {
    return shortPath(oneLine(path), S.cwd)
  }

  if (live.kind === 'shell') {
    return oneLine(textOf(live, 'description') || textOf(live, 'command')).slice(0, 200)
  }

  for (const key of TITLE_KEYS) {
    const value = key === live.mainKey ? '' : textOf(live, key)

    if (value !== '') {
      return oneLine(value).slice(0, 200)
    }
  }

  return ''
}

function changesOf(live: Live): string {
  const { added, removed } = countChanges(live.hunks)

  return `+${added} −${removed}`
}

function toRow(live: Live): Row {
  const main = live.fields.get(live.mainKey)
  let meta = live.ms >= 100 ? fmtMs(live.ms) : ''

  if (live.kind === 'edit' && live.hunks.length > 0) {
    meta = changesOf(live)
  } else if (main !== undefined && (live.kind === 'write' || live.kind === 'edit')) {
    meta = `${tailLines(main)} satır`
  }

  return {
    id: live.id,
    tool: toolLabel(live.name),
    kind: live.kind,
    title: titleOf(live),
    meta,
    status: live.status,
    isAgent: live.isAgent,
  }
}

function toStage(live: Live): Stage {
  const main = live.fields.get(live.mainKey)
  const view = main === undefined ? { text: '', firstLine: 1 } : tailView(main, STAGE_CHARS)
  const old = live.fields.get('old_string')
  const ms = live.status === 'running' ? now() - live.startedAt : live.ms
  const parts: string[] = []

  if (live.kind === 'edit' && live.hunks.length > 0) {
    parts.push(changesOf(live))
  } else if (main !== undefined && live.kind !== 'shell') {
    parts.push(`${tailLines(main)} satır`, fmtSize(main.chars))
  }

  if (ms >= 100) {
    parts.push(fmtMs(ms))
  }

  return {
    id: live.id,
    tool: toolLabel(live.name),
    kind: live.kind,
    title: titleOf(live),
    meta: parts.join(' · '),
    path: oneLine(textOf(live, 'file_path') || textOf(live, 'notebook_path')),
    language: live.language,
    body: clean(view.text),
    firstLine: view.firstLine,
    old: old === undefined ? '' : clean(tailView(old, STAGE_CHARS).text),
    hunks: live.hunks,
    output: live.output,
    status: live.status,
  }
}

// --- Duruma yazma: kısılmış, tek uçuşta bir yazı -----------------------------

function snapshot(): Feed {
  const kept = S.restored === null ? [] : S.restored.rows.filter(row => !S.byId.has(row.id))

  return {
    rows: [...kept, ...S.items.slice(-ROWS_MAX).map(toRow)].slice(-ROWS_MAX),
    stage: S.stage === null ? (S.restored?.stage ?? null) : toStage(S.stage),
    isWorking: S.isWorking,
    phase: S.phase,
    ticker: oneLine(S.ticker).slice(-300),
    tick: S.tick,
    speeds: S.speeds.slice(-SPARK_MAX),
    tools: S.tools,
    tokens: S.tokens,
    elapsedMs: S.elapsedMs,
  }
}

function flush(): Promise<void> {
  if (S.pending !== undefined) {
    return S.pending
  }

  const save = io?.save

  if (save === undefined) {
    return Promise.resolve()
  }

  S.isDirty = false
  S.lastFlush = now()
  S.tick++

  const settle = (): void => {
    S.pending = undefined

    if (S.isDirty) {
      touch()
    }
  }

  try {
    S.pending = save(snapshot()).then(settle, settle)

    return S.pending
  } catch {
    return Promise.resolve()
  }
}

/** Bekleyen ve sırada duran yazıların hepsini bitirir (panel açılmadan önce). */
async function drain(): Promise<void> {
  for (let round = 0; round < 5 && (S.pending !== undefined || S.isDirty); round++) {
    await (S.pending ?? flush())
  }
}

function touch(): void {
  S.isDirty = true

  if (io === undefined || S.pending !== undefined || S.timer !== undefined) {
    return
  }

  const wait = FLUSH_MS - (now() - S.lastFlush)

  if (wait <= 0) {
    void flush()

    return
  }

  try {
    S.timer = io.after(wait, () => {
      S.timer = undefined
      void flush()
    })
  } catch {
    void flush()
  }
}

// --- Tur yaşam döngüsü ve nabız ----------------------------------------------

function stopBeat(): void {
  S.beat?.cancel()
  S.beat = undefined
}

function startBeat(): void {
  if (io === undefined || S.beat !== undefined) {
    return
  }

  try {
    S.beat = io.every(BEAT_MS, () => {
      S.speeds.push(Math.round(((S.typed - S.typedSeen) * 1000) / BEAT_MS))
      S.typedSeen = S.typed

      if (S.speeds.length > SPARK_MAX) {
        S.speeds.shift()
      }

      const isBusy = S.items.some(live => live.status === 'streaming' || live.status === 'running')

      if (S.isWorking && !isBusy && now() - S.lastEvent > IDLE_MS) {
        S.isWorking = false
        S.phase = 'idle'
      }

      if (S.isWorking) {
        S.elapsedMs = now() - S.startedAt
      } else {
        stopBeat()
      }

      touch()
    })
  } catch {
    S.beat = undefined
  }
}

function begin(isFresh: boolean): void {
  S.isWorking = true
  S.lastEvent = now()

  if (isFresh) {
    S.phase = 'thinking'
    S.ticker = ''
    S.tools = 0
    S.tokens = 0
    S.speeds = []
    S.typedSeen = S.typed
    S.elapsedMs = 0
    S.startedAt = now()
  }

  startBeat()
  touch()
}

function finish(durationMs: number): void {
  S.isWorking = false
  S.phase = 'idle'
  S.ticker = ''
  S.elapsedMs = durationMs

  for (const live of S.items) {
    if (!live.isAgent && (live.status === 'streaming' || live.status === 'ready' || live.status === 'running')) {
      live.status = 'stopped'
    }
  }

  stopBeat()
  touch()
}

function speak(phase: Phase, text: string): void {
  if (S.tickerPhase !== phase) {
    S.tickerPhase = phase
    S.ticker = ''
  }

  S.phase = phase
  S.ticker = (S.ticker + text).slice(-TICKER_MAX)
}

function observe(blocks: Map<number, Live>, chunk: TurnStepChunk, isAgent: boolean): void {
  if (chunk.kind === 'engine') {
    return
  }

  S.lastEvent = now()

  if (chunk.kind === 'thinking') {
    speak('thinking', chunk.text)
  } else if (chunk.kind === 'text') {
    speak('talking', chunk.text)
  } else if (chunk.kind === 'tool') {
    blocks.set(chunk.index, startLive(chunk.id, chunk.name, isAgent))
    S.phase = 'writing'
  } else if (chunk.kind === 'input') {
    const live = blocks.get(chunk.index)

    if (live !== undefined) {
      feedJson(live.reader, chunk.json, (key, text) => take(live, key, text))
      S.phase = 'writing'
    }
  } else {
    S.tokens += chunk.usage?.output_tokens ?? 0

    for (const live of blocks.values()) {
      if (live.status === 'streaming') {
        live.status = 'ready'
      }
    }
  }

  touch()
}

// --- Araç çalışırken ---------------------------------------------------------

function toolStarted(args: Record<string, unknown>): Live | undefined {
  const id = typeof args.tool_use_id === 'string' ? args.tool_use_id : ''
  const name = typeof args.tool === 'string' ? args.tool : ''

  if (id === '' || name === '') {
    return undefined
  }

  const live = S.byId.get(id) ?? startLive(id, name, args.agentId !== undefined)
  const spec = SPECS.get(name)

  if (spec !== undefined) {
    for (const key of [spec.main, 'file_path', 'notebook_path', 'old_string', 'description']) {
      setField(live, key, args[key])
    }
  } else if (live.fields.size === 0) {
    for (const [key, value] of Object.entries(args)) {
      if (key !== 'tool' && key !== 'tool_use_id' && key !== 'agentId' && typeof value === 'string') {
        take(live, key, value)
      }
    }
  }

  live.status = 'running'
  live.startedAt = now()
  S.tools++
  S.phase = 'running'
  S.lastEvent = now()
  touch()

  return live
}

function toolEnded(live: Live, ran: Record<string, unknown>): void {
  live.ms = now() - live.startedAt
  live.status = typeof ran.deny === 'string' ? 'denied' : ran.isError === true ? 'error' : 'done'

  if (live.kind === 'edit' && typeof ran.result === 'object' && ran.result !== null) {
    live.hunks = toHunks((ran.result as Record<string, unknown>).structuredPatch)
  }

  if (live.kind === 'shell' || live.status !== 'done') {
    const text = typeof ran.deny === 'string' ? ran.deny : typeof ran.text === 'string' ? ran.text : ''
    live.output = outputTail(text)
  }

  S.phase = S.isWorking ? 'thinking' : 'idle'
  S.lastEvent = now()
  touch()
}

// --- Panel ---------------------------------------------------------------------

function headerRow(t: Table, feed: Feed, cols: number, frame: string) {
  const { Box, Text } = t
  const phase = PHASES[feed.phase]
  const state = feed.isWorking ? `${frame} ${phase.label}` : phase.label
  const stats =
    feed.tools + feed.tokens > 0
      ? `${feed.tools} araç · ${fmtCount(feed.tokens)} token · ${fmtMs(feed.elapsedMs)}`
      : ''
  const gap = cols - TITLE.length - 2 - state.length - stats.length

  return (
    <Box>
      <Text bold color={VIOLET}>
        {TITLE}
      </Text>
      <Text color={phase.color} dimColor={!feed.isWorking}>
        {`  ${state}`}
      </Text>
      {gap >= 2 && stats !== '' && <Text dimColor>{`${' '.repeat(gap)}${stats}`}</Text>}
    </Box>
  )
}

function pulseRow(t: Table, feed: Feed, cols: number, isTerminal: boolean) {
  const { Box, Text, Link } = t

  // Boştayken çizginin ucunda imza durur; terminalde düz yazı (genişliği belli),
  // öbür yüzeylerde tıklanır bağlantı.
  if (!feed.isWorking) {
    return (
      <Box>
        <Text dimColor>{`${'─'.repeat(Math.max(0, cols - SITE.length - 1))} `}</Text>
        {isTerminal ? <Text color={EMERALD}>{SITE}</Text> : <Link href={`https://${SITE}`} label={SITE} />}
      </Box>
    )
  }

  const speed = `${fmtCount(feed.speeds[feed.speeds.length - 1] ?? 0)} karakter/sn`

  return (
    <Box>
      <Text color={CYAN}>{sparkline(feed.speeds, cols - speed.length - 2)}</Text>
      <Text dimColor>{`  ${speed}`}</Text>
    </Box>
  )
}

function tickerRow(t: Table, feed: Feed, cols: number) {
  const { Box, Text } = t
  const isSpeaking = feed.isWorking && feed.ticker !== '' && (feed.phase === 'thinking' || feed.phase === 'talking')

  if (!isSpeaking) {
    return <Text> </Text>
  }

  const phase = PHASES[feed.phase]

  return (
    <Box>
      <Text color={phase.color}>{`${phase.label}  `}</Text>
      <Text dimColor italic wrap="truncate-end">
        {fitStart(feed.ticker, cols - phase.label.length - 2)}
      </Text>
    </Box>
  )
}

function logRow(t: Table, row: Row, cols: number, frame: string) {
  const { Box, Text } = t
  const look = LOOKS[row.status]
  const isLive = row.status === 'streaming' || row.status === 'running'
  const room = cols - 2 - TOOL_W - 1 - (row.meta === '' ? 0 : row.meta.length + 1)
  const title = (row.title.includes('/') ? fitStart : fitEnd)(row.title, room)

  return (
    <Box>
      <Text color={look.color}>{`${isLive ? frame : look.glyph} `}</Text>
      <Text bold={!look.isDim} dimColor={look.isDim} color={KIND_COLOR[row.kind]}>
        {fitEnd(row.tool, TOOL_W).padEnd(TOOL_W)}
      </Text>
      <Text dimColor={look.isDim} wrap="truncate-end">{` ${title.padEnd(Math.max(0, room))}`}</Text>
      {row.meta !== '' && <Text dimColor>{` ${row.meta}`}</Text>}
    </Box>
  )
}

function codeProps(stage: Stage, source: string, more: Partial<CodeProps>): CodeProps {
  const props: CodeProps = { source, wrap: 'truncate-end', ...more }

  if (stage.language !== '') {
    props.language = stage.language
  } else if (stage.path !== '') {
    props.path = stage.path
  }

  return props
}

/**
 * Sahne: akan kodun kendisi. `rows` kod alanının üst sınırı; kutu içeriği
 * kadar yer tutar ve kaç satır kullandığını `used` ile bildirir.
 */
function stageBox(t: Table, stage: Stage, cols: number, rows: number, frame: string) {
  const { Box, Text, Code } = t
  const inner = cols - 4
  const width = Math.max(40, inner) + 60
  const color = KIND_COLOR[stage.kind]
  const look = LOOKS[stage.status]
  const isStreaming = stage.status === 'streaming'
  const cursor = isStreaming ? CURSOR : ''
  const isLive = isStreaming || stage.status === 'running'
  const tool = fitEnd(stage.tool, Math.max(1, inner - 4))
  // Dar panelde önce sayaçlar, sonra durum yazısı düşer; başlık hep sığar.
  let badge = `  ${isLive ? `${frame} ${look.label}` : look.label}`
  let meta = stage.meta === '' ? '' : `  ${stage.meta}`
  let room = inner - tool.length - 1 - meta.length - badge.length

  if (room < 10) {
    meta = ''
    room = inner - tool.length - 1 - badge.length
  }

  if (room < 4) {
    badge = `  ${isLive ? frame : look.glyph}`
    room = inner - tool.length - 1 - badge.length
  }

  const outLines = stage.output === '' ? 0 : stage.output.split('\n').length
  let outRows = 0

  if (outLines > 0) {
    const share = Math.max(2, Math.floor(rows / 3))

    outRows =
      stage.kind === 'shell'
        ? Math.max(1, rows - 1 - Math.min(stage.body.split('\n').length, share))
        : Math.min(outLines, share)
  }

  const mainRows = outRows > 0 ? Math.max(1, rows - outRows - 1) : rows
  let source = ''
  let more: Partial<CodeProps> = {}

  if (stage.kind === 'edit') {
    const isLive = stage.hunks.length === 0
    const hunks = isLive ? [liveHunk(stage.old, stage.body, !isStreaming)] : stage.hunks

    source = fitHunks(hunks, mainRows, width, isLive && isStreaming, cursor)
    more = { format: 'diff' }
  } else {
    const view = windowSource(stage.body, stage.firstLine, mainRows, width, cursor)

    source = stage.body === '' && cursor === '' ? '' : view.source
    more = stage.kind === 'write' ? { startLine: view.startLine } : {}
  }

  const output = outRows > 0 ? lastLines(stage.output, outRows, width) : ''
  const used =
    (source === '' ? 1 : source.split('\n').length) + (output === '' ? 0 : 1 + output.split('\n').length)

  const node = (
    <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
      <Box>
        <Text bold color={color}>
          {tool}
        </Text>
        <Text wrap="truncate-end">{` ${fitStart(stage.title, room).padEnd(Math.max(0, room))}`}</Text>
        {meta !== '' && <Text dimColor>{meta}</Text>}
        <Text color={look.color}>{badge}</Text>
      </Box>
      {source === '' ? <Text dimColor>…</Text> : <Code {...codeProps(stage, source, more)} />}
      {output !== '' && <Text dimColor>{'─'.repeat(Math.max(1, inner))}</Text>}
      {output !== '' && <Code source={output} wrap="truncate-end" />}
    </Box>
  )

  return { node, used }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    io = {
      save: feed => $.state.set(feedRef, feed),
      after: (ms, fn) => $.clock.after(ms, fn),
      every: (ms, fn) => $.clock.every(ms, fn),
    }
    S.cwd = e.cwd

    try {
      await $.command.register({
        name: 'kod-akisi',
        description: 'Kod Akışı panelini açar; "kapat" yazınca kapatır',
        argumentHint: '[kapat]',
      })
    } catch {
      // Komut kaydı düşerse panel yine otomatik açılır.
    }

    try {
      const held = (await $.state.get(feedRef)).value

      if (held !== undefined && S.items.length === 0) {
        S.restored = {
          ...held,
          isWorking: false,
          phase: 'idle',
          rows: held.rows.map(row =>
            row.status === 'streaming' || row.status === 'running' ? { ...row, status: 'stopped' } : row,
          ),
        }
        S.tools = held.tools
        S.tokens = held.tokens
        S.elapsedMs = held.elapsedMs
        S.tick = held.tick
        touch()
      }
    } catch {
      // İlk yüklemede durum yoktur.
    }

    const open = async (): Promise<void> => {
      try {
        if ((await $.store.get('auto')) === false) {
          return
        }
      } catch {
        // Depo okunamadıysa varsayılan: açık.
      }

      try {
        if ((await $.state.get(closedRef)).value === true) {
          return
        }

        const opened = await $.ui.open({ id: PANE, title: TITLE })

        if (!opened.isPlaced) {
          $.ui.toast(`${TITLE} hazır: paneli açmak için /kod-akisi yaz`, { timeoutMs: 9000 })
        }
      } catch {
        // Panel açılamadıysa oturumu rahatsız etme; /kod-akisi her zaman açar.
      }
    }

    void open()

    return next(e)
  })

  on('session.end', ($, e, next) => {
    stopBeat()
    S.timer?.cancel()
    S.timer = undefined

    return next(e)
  })

  on('command.run', { command: 'kod-akisi' }, async ($, e) => {
    if (e.args.trim().toLocaleLowerCase('tr') === 'kapat') {
      await $.store.set('auto', false).catch(() => undefined)
      await $.ui.close({ id: PANE }).catch(() => undefined)

      return { text: `${TITLE} kapatıldı. Yeniden açmak için /kod-akisi yaz.` }
    }

    await $.store.set('auto', true).catch(() => undefined)
    await $.state.set(closedRef, false).catch(() => undefined)
    await drain()

    const opened = await $.ui.open({ id: PANE, title: TITLE })

    return {
      text: opened.isPlaced
        ? `${TITLE} paneli açık.`
        : `${TITLE} paneli şu an yerleştirilemedi: ${opened.reason}`,
    }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') {
      await $.state.set(closedRef, true).catch(() => undefined)
    }

    return next(e)
  })

  on('turn.start', ($, e, next) => {
    // session.start görülmeden yüklenen modül için ikinci bağlama noktası.
    io ??= {
      save: feed => $.state.set(feedRef, feed),
      after: (ms, fn) => $.clock.after(ms, fn),
      every: (ms, fn) => $.clock.every(ms, fn),
    }

    try {
      begin(true)
    } catch {
      // Gözlem hiçbir zaman turu durdurmaz.
    }

    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    try {
      if (e.agentId === undefined) {
        finish(e.durationMs)
        $.ui.log(`tur bitti: ${S.tools} araç, ${S.typed} karakter aktı`, { to: 'debug' })
      }
    } catch {
      // Gözlem hiçbir zaman turu durdurmaz.
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const blocks = new Map<number, Live>()
    const isAgent = e.agentId !== undefined

    try {
      if (!isAgent && !S.isWorking) {
        begin(false)
      }
    } catch {
      // Gözlem hiçbir zaman akışı durdurmaz.
    }

    for await (const chunk of next(e)) {
      try {
        observe(blocks, chunk, isAgent)
      } catch {
        // Gözlem hiçbir zaman akışı durdurmaz.
      }

      yield chunk
    }
  })

  on('tool.call', async ($, e, next) => {
    let live: Live | undefined

    try {
      live = toolStarted(e as unknown as Record<string, unknown>)
    } catch {
      // Gözlem hiçbir zaman aracı durdurmaz.
    }

    const ran = await next(e)

    try {
      if (live !== undefined) {
        toolEnded(live, ran as unknown as Record<string, unknown>)
      }
    } catch {
      // Gözlem hiçbir zaman sonucu değiştirmez.
    }

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t: Table = $.ui.resolve(e)
    const { Box, Text } = t
    const feed = (await $.state.get(feedRef)).value ?? EMPTY
    const cols = clamp(Math.floor(e.props.bodyColumns || e.viewport?.columns || 80), 30, 240)
    const rows = clamp(Math.floor(e.props.scroll?.bodyRows || e.viewport?.rows || 30), 9, 140)
    const frame = SPIN.charAt(feed.tick % SPIN.length)
    const isTerminal = e.surface === 'terminal'
    const stage = feed.stage
    const others = feed.rows.filter(row => row.id !== stage?.id).reverse()

    if (stage === null) {
      return (
        <Box flexDirection="column">
          {headerRow(t, feed, cols, frame)}
          {pulseRow(t, feed, cols, isTerminal)}
          {tickerRow(t, feed, cols)}
          {others.length === 0 && (
            <Text dimColor>
              Claude bir dosya yazarken, düzenlerken ya da komut çalıştırırken kod burada canlı akar.
            </Text>
          )}
          {others.slice(0, Math.max(0, rows - 4)).map(row => logRow(t, row, cols, frame))}
        </Box>
      )
    }

    // Kod büyüdükçe günlüğe en az `logMin` satır kalır; kod kısaysa günlük genişler.
    const logMin = Math.min(others.length, rows >= 30 ? 6 : rows >= 22 ? 4 : rows >= 15 ? 2 : 0)
    const box = stageBox(t, stage, cols, Math.max(3, rows - 7 - logMin), frame)
    const logRows = Math.max(0, rows - 7 - box.used)

    return (
      <Box flexDirection="column">
        {headerRow(t, feed, cols, frame)}
        {pulseRow(t, feed, cols, isTerminal)}
        {box.node}
        {tickerRow(t, feed, cols)}
        {others.slice(0, logRows).map(row => logRow(t, row, cols, frame))}
      </Box>
    )
  })
}
