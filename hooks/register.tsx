// Kod Akışı: Claude çalışırken modelin akışını (turn.step) dinler; yazdığı
// dosyayı, yaptığı düzenlemeyi, çalıştırdığı komutu ve gönderiliyorsa düşünce
// metnini yan panelde canlı çizer. Alt ajanların her biri kendi şeridinde izlenir.
// Hiçbir olayı değiştirmez: her parça ve her araç sonucu geldiği gibi geçer.

import type { CodeProps, Elements, Register, Timer, TurnStepChunk } from 'claude-code'

import type {
  AgentRow,
  AgentStatus,
  Feed,
  Hunk,
  Kind,
  Phase,
  Row,
  Stage,
  Status,
  Thought,
} from '../types'
import {
  RULE_SVG,
  SPARK_HEIGHT,
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
  liveHunk,
  newReader,
  newTail,
  oneLine,
  outputTail,
  rowsOf,
  shortPath,
  sparkSplit,
  sparkSvg,
  tailLines,
  tailOf,
  tailPush,
  tailText,
  tailView,
  toHunks,
  toolLabel,
  windowSource,
  wrapTail,
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
/** Sahnedeki akış bu kadar süredir veri almadıysa başka bir döngü sahneyi alabilir. */
const STICKY_MS = 1200
const ITEMS_MAX = 24
const TRACKS_MAX = 12
const ROWS_MAX = 12
const AGENT_ROWS = 4
const SPARK_MAX = 240
const TICKER_MAX = 400
const THOUGHT_MAX = 2400
const STAGE_CHARS = 6000
const TOOL_W = 10
const AGENT_W = 12
/** Bir yanıtta, görünen metnin açıklayamadığı bu kadar token varsa düşünce gizli akmıştır. */
const HIDDEN_TOKENS = 200
const HINT_SESSIONS = 3
const HINT_TURNS = 2

const VIOLET = '#8B5CF6'
const CYAN = '#06B6D4'
const PINK = '#EC4899'
const AMBER = '#F59E0B'
const GREEN = '#10B981'
const RED = '#EF4444'
const BLUE = '#3B82F6'
const EMERALD = '#00B57A'

/** Alt ajan şeritlerinin renkleri; günlükteki satırlar aynı renkle işaretlenir. */
const AGENT_COLORS = ['#A78BFA', '#34D399', '#F472B6', '#FBBF24', '#60A5FA', '#FB7185', '#2DD4BF']

const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
const CURSOR = '▍'
const LANE = '▎'

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

const AGENT_LOOKS: Record<AgentStatus, { glyph: string; color: string; isDim: boolean }> = {
  running: { glyph: '▸', color: VIOLET, isDim: false },
  done: { glyph: '✓', color: GREEN, isDim: true },
  error: { glyph: '✗', color: RED, isDim: false },
  stopped: { glyph: '◌', color: AMBER, isDim: true },
}

/** Düşünce metni gelmiyorsa nasıl açılacağı; yüzeye göre yol farklıdır. */
const HINTS = {
  desktop:
    'Düşünce metni bu oturuma gönderilmiyor. Başlık menüsünden Transcript view › Thinking seçince burada akar.',
  other:
    'Düşünce metni bu oturuma gönderilmiyor. Ayarlarda showThinkingSummaries açılınca burada akar.',
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

/**
 * Bir model döngüsü: ana konuşma (`id` boş) ya da bir alt ajan. Her döngünün
 * kendi araç çağrıları, sahnesi ve düşüncesi vardır.
 */
type Track = {
  id: string
  label: string
  task: string
  color: string
  /** Ana döngü ya da motorun alt ajan olarak bildirdiği döngü; öbürleri çizilmez. */
  isKnown: boolean
  isProbed: boolean
  status: AgentStatus
  phase: Phase
  items: Live[]
  stage: Live | null
  thought: string
  isThinking: boolean
  ticker: string
  lastKind: string
  tools: number
  tokens: number
  startedAt: number
  endedAt: number
  lastEvent: number
}

type Live = {
  id: string
  name: string
  track: Track
  seq: number
  kind: Kind
  mainKey: string
  language: string
  reader: Reader
  fields: Map<string, Tail>
  hunks: Hunk[]
  output: string
  status: Status
  startedAt: number
  fedAt: number
  ms: number
}

/** Bir yanıtta akıştan görülen karakter ve düşünce metni; gizli düşünceyi ayırt eder. */
type Step = { seen: number; thought: number }

type Table = Pick<Elements['terminal'], 'Box' | 'Text' | 'Code' | 'Link'>

type Draw = {
  t: Table
  /** Vektör çizen yüzeylerde (terminal dışı) Svg öğesi. */
  svg: Elements['desktop']['Svg'] | undefined
  cols: number
  frame: string
  isTerminal: boolean
  /** Yüzey uzun kod satırını sarıyorsa bir ekran satırına sığan karakter; kırpıyorsa 0. */
  cap: number
  hint: string
}

const EMPTY: Feed = {
  rows: [],
  stage: null,
  thought: null,
  agents: [],
  moreAgents: 0,
  busyAgents: 0,
  isWorking: false,
  phase: 'idle',
  ticker: '',
  isThoughtHidden: false,
  tick: 0,
  speeds: [],
  tools: 0,
  tokens: 0,
  elapsedMs: 0,
}

const now = (): number => Date.now()

const newTrack = (id: string): Track => ({
  id,
  label: '',
  task: '',
  color: '',
  isKnown: id === '',
  isProbed: false,
  status: 'running',
  phase: 'idle',
  items: [],
  stage: null,
  thought: '',
  isThinking: false,
  ticker: '',
  lastKind: '',
  tools: 0,
  tokens: 0,
  startedAt: now(),
  endedAt: 0,
  lastEvent: now(),
})

// Modülün kendi belleği: sıcak yeniden yüklemede sıfırlanır, çizilen durum
// $.state'te kalır ve session.start'ta geri alınır.
const S = {
  main: newTrack(''),
  agents: new Map<string, Track>(),
  byId: new Map<string, Live>(),
  stage: null as Live | null,
  restored: null as Feed | null,
  cwd: '',
  isWorking: false,
  seq: 0,
  colorAt: 0,
  tick: 0,
  speeds: [] as number[],
  typed: 0,
  typedSeen: 0,
  tools: 0,
  tokens: 0,
  startedAt: 0,
  elapsedMs: 0,
  lastFlush: 0,
  isDirty: false,
  hasThought: false,
  isHidden: false,
  canHint: false,
  isHinting: false,
  hintTurns: 0,
  pending: undefined as Promise<void> | undefined,
  timer: undefined as Timer | undefined,
  beat: undefined as Timer | undefined,
}

// Motor ($) bir değişkende tutulamaz; kancanın içinde kurulan bu kapanışlar
// zamanlayıcıların ve kısılmış yazının motora ulaştığı tek yoldur.
type Io = {
  save: (feed: Feed) => Promise<unknown>
  after: (ms: number, fn: () => void) => Timer
  every: (ms: number, fn: () => void) => Timer
  hinted: () => Promise<unknown>
}

let io: Io | undefined

const textOf = (live: Live, key: string): string => live.fields.get(key)?.text ?? ''

const isOpen = (live: Live): boolean =>
  live.status === 'streaming' || live.status === 'ready' || live.status === 'running'

const isHot = (live: Live): boolean => live.status === 'streaming' && now() - live.fedAt < STICKY_MS

const knownAgents = (): Track[] => [...S.agents.values()].filter(track => track.isKnown)

const busyAgents = (): Track[] => knownAgents().filter(track => track.status === 'running')

// --- Döngüler: ana konuşma ve alt ajanlar -----------------------------------

function forget(track: Track): void {
  for (const live of track.items) {
    S.byId.delete(live.id)
  }

  S.agents.delete(track.id)
}

function trackOf(agentId: string | undefined): Track {
  if (agentId === undefined || agentId === '') {
    return S.main
  }

  let track = S.agents.get(agentId)

  if (track === undefined) {
    track = newTrack(agentId)
    S.agents.set(agentId, track)

    // Yer açılır: önce motorun kendi iç döngüleri ve işi bitmiş ajanlar gider.
    const spare = [...S.agents.values()].filter(old => old !== track && (!old.isKnown || old.status !== 'running'))

    for (const old of spare.slice(0, Math.max(0, S.agents.size - TRACKS_MAX))) {
      forget(old)
    }
  }

  return track
}

/** Motor bir döngünün alt ajan olduğunu bildirdiğinde şeridi görünür olur. */
function reveal(track: Track, label: string, task: string): void {
  if (track === S.main) {
    return
  }

  track.label = oneLine(label) || track.label || 'ajan'
  track.task = oneLine(task) || track.task

  if (!track.isKnown) {
    track.isKnown = true
    track.color = AGENT_COLORS[S.colorAt++ % AGENT_COLORS.length] ?? VIOLET
    S.tools += track.tools
    S.tokens += track.tokens

    if (track.status === 'running') {
      startBeat()
    }
  }

  touch()
}

/** Döngü durdu: açık kalan çağrıları kapanır, evresi boşa döner. */
function settle(track: Track, status: AgentStatus): void {
  track.status = status
  track.phase = 'idle'
  track.isThinking = false
  track.ticker = ''
  track.endedAt = now()

  for (const live of track.items) {
    if (isOpen(live)) {
      live.status = 'stopped'
    }
  }
}

// --- Akıştan gelen araç çağrıları -------------------------------------------

/**
 * Ortak sahneyi ister. Ana konuşma her zaman alır; bir alt ajan, sahnedeki
 * başka döngünün akışı hâlâ sıcakken araya girmez (paralel ajanlar sahneyi
 * titretmesin diye).
 */
function claimStage(live: Live): void {
  const held = S.stage

  if (!live.track.isKnown) {
    return
  }

  if (held === null || held.track === live.track || live.track === S.main || !isHot(held)) {
    S.stage = live
  }
}

function startLive(track: Track, id: string, name: string): Live {
  const spec = SPECS.get(name)
  const live: Live = {
    id,
    name,
    track,
    seq: S.seq++,
    kind: spec?.kind ?? 'other',
    mainKey: spec?.main ?? '',
    language: spec?.language ?? '',
    reader: newReader(),
    fields: new Map(),
    hunks: [],
    output: '',
    status: 'streaming',
    startedAt: now(),
    fedAt: now(),
    ms: 0,
  }

  track.items.push(live)
  S.byId.set(id, live)

  if (track.items.length > ITEMS_MAX) {
    const gone = track.items.shift()

    if (gone !== undefined) {
      S.byId.delete(gone.id)
    }
  }

  if (spec !== undefined) {
    track.stage = live
    claimStage(live)
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
  live.fedAt = now()

  if (live.track.isKnown) {
    S.typed += text.length
  }

  const language = PAYLOADS.get(key)

  if (live.mainKey === '' && language !== undefined && (tail.newlines > 0 || tail.chars >= 160)) {
    live.mainKey = key
    live.kind = 'write'
    live.language = language
    live.track.stage = live
  }

  if (live.mainKey !== '' && S.stage !== live) {
    claimStage(live)
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

  // Alt ajan çağrısı: önce türü, sonra görevin kısa adı.
  const agent = textOf(live, 'subagent_type')
  const task = textOf(live, 'description')

  if (agent !== '' && task !== '') {
    return oneLine(`${agent} · ${task}`).slice(0, 200)
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
    agent: live.track.label,
    color: live.track.color,
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
    agent: live.track.label,
    color: live.track.color,
  }
}

function toThought(track: Track): Thought | null {
  // Düşünce özeti markdown ile gelir; bantta düz yazı akar.
  const text = oneLine(track.thought.replace(/^#{1,6}\s+/gm, '').replace(/\*\*/g, ''))

  return text === '' ? null : { text: tailText(text, THOUGHT_MAX), isLive: track.isThinking }
}

function toAgentRow(track: Track): AgentRow {
  const isRunning = track.status === 'running'
  const last = track.items[track.items.length - 1]
  const doing = isRunning && last !== undefined ? `${toolLabel(last.name)} ${titleOf(last)}` : ''
  const ms = (isRunning ? now() : track.endedAt) - track.startedAt

  return {
    id: track.id,
    label: track.label,
    task: track.task.slice(0, 200),
    doing: oneLine(doing).slice(0, 200),
    meta: track.tools > 0 ? `${track.tools} araç · ${fmtMs(ms)}` : fmtMs(ms),
    status: track.status,
    color: track.color,
  }
}

// --- Duruma yazma: kısılmış, tek uçuşta bir yazı -----------------------------

/** Şeride sığan ajanlar: çalışanlar önce gelir, sıra başlama sırasıdır. */
function pickAgents(known: readonly Track[]): Track[] {
  const busy = known.filter(track => track.status === 'running')
  const rest = known.filter(track => track.status !== 'running')
  const spare = AGENT_ROWS - busy.length
  const picked = new Set([...busy.slice(-AGENT_ROWS), ...(spare > 0 ? rest.slice(-spare) : [])])

  return known.filter(track => picked.has(track))
}

function snapshot(): Feed {
  const known = knownAgents()
  const shown = pickAgents(known)
  const busy = known.filter(track => track.status === 'running').length
  const lives = [S.main, ...known].flatMap(track => track.items).sort((a, b) => a.seq - b.seq)
  const kept = S.restored === null ? [] : S.restored.rows.filter(row => !S.byId.has(row.id))

  return {
    rows: [...kept, ...lives.slice(-ROWS_MAX).map(toRow)].slice(-ROWS_MAX),
    stage: S.stage === null ? (S.restored?.stage ?? null) : toStage(S.stage),
    thought: S.isWorking ? toThought(S.main) : null,
    agents: shown.map(toAgentRow),
    moreAgents: known.length - shown.length,
    busyAgents: busy,
    isWorking: S.isWorking || busy > 0,
    phase: S.isWorking ? S.main.phase : 'idle',
    ticker: oneLine(S.main.ticker).slice(-300),
    isThoughtHidden: S.isHinting && S.isWorking && !S.hasThought,
    tick: S.tick,
    speeds: S.speeds.slice(-SPARK_MAX),
    tools: S.tools,
    tokens: S.tokens,
    elapsedMs: S.elapsedMs,
  }
}

/** Görünümde bir alt ajanın konuşması açıkken panel o ajanın akışını çizer. */
function agentFeed(track: Track, base: Feed): Feed {
  const isRunning = track.status === 'running'

  return {
    ...base,
    rows: track.items.slice(-ROWS_MAX).map(live => ({ ...toRow(live), agent: '', color: '' })),
    stage: track.stage === null ? null : { ...toStage(track.stage), agent: '', color: '' },
    thought: isRunning ? toThought(track) : null,
    agents: [],
    moreAgents: 0,
    busyAgents: 0,
    isWorking: isRunning,
    phase: isRunning ? track.phase : 'idle',
    ticker: oneLine(track.ticker).slice(-300),
    isThoughtHidden: false,
    tools: track.tools,
    tokens: track.tokens,
    elapsedMs: (isRunning ? now() : track.endedAt) - track.startedAt,
  }
}

/** Önceki sürümün yazdığı durumda olmayan alanları tamamlar. */
function complete(held: Feed): Feed {
  const rows: Row[] = (held.rows ?? []).map(row => ({ ...row, agent: row.agent ?? '', color: row.color ?? '' }))
  const stage = held.stage ?? null

  return {
    ...EMPTY,
    ...held,
    rows,
    stage: stage === null ? null : { ...stage, agent: stage.agent ?? '', color: stage.color ?? '' },
    thought: held.thought ?? null,
    agents: held.agents ?? [],
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

  const settled = (): void => {
    S.pending = undefined

    if (S.isDirty) {
      touch()
    }
  }

  try {
    S.pending = save(snapshot()).then(settled, settled)

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
      const at = now()

      S.speeds.push(Math.round(((S.typed - S.typedSeen) * 1000) / BEAT_MS))
      S.typedSeen = S.typed

      if (S.speeds.length > SPARK_MAX) {
        S.speeds.shift()
      }

      // Uzun süre ses vermeyen döngü bırakılmış sayılır.
      if (S.isWorking && !S.main.items.some(isOpen) && at - S.main.lastEvent > IDLE_MS) {
        S.isWorking = false
        settle(S.main, 'stopped')
      }

      for (const track of busyAgents()) {
        if (!track.items.some(isOpen) && at - track.lastEvent > IDLE_MS) {
          settle(track, 'stopped')
        }
      }

      if (S.isWorking) {
        S.elapsedMs = at - S.startedAt
      } else if (busyAgents().length === 0) {
        stopBeat()
      }

      touch()
    })
  } catch {
    S.beat = undefined
  }
}

/** Düşünce gizli akıyorsa ipucunu bu tur için açar; birkaç tur ve oturumla sınırlıdır. */
function armHint(): void {
  if (S.isHinting || !S.canHint || !S.isHidden || S.hasThought || S.hintTurns >= HINT_TURNS) {
    return
  }

  S.isHinting = true
  S.hintTurns++

  if (S.hintTurns === 1) {
    io?.hinted().catch(() => undefined)
  }
}

function begin(isFresh: boolean): void {
  S.isWorking = true
  S.main.status = 'running'
  S.main.lastEvent = now()

  if (isFresh) {
    S.main.phase = 'thinking'
    S.main.ticker = ''
    S.main.thought = ''
    S.main.isThinking = false
    S.main.lastKind = ''
    S.tools = 0
    S.tokens = 0
    S.speeds = []
    S.typedSeen = S.typed
    S.elapsedMs = 0
    S.startedAt = now()
    S.isHinting = false

    // Yeni turda işi bitmiş ajanların şeridi kalkar; çalışanlar yerinde kalır.
    for (const track of [...S.agents.values()]) {
      if (!track.isKnown || track.status !== 'running') {
        forget(track)
      }
    }

    armHint()
  }

  startBeat()
  touch()
}

function finish(durationMs: number): void {
  S.isWorking = false
  S.elapsedMs = durationMs
  settle(S.main, 'done')

  if (busyAgents().length === 0) {
    stopBeat()
  }

  touch()
}

function agentFinished(agentId: string, status: AgentStatus): void {
  const track = S.agents.get(agentId)

  if (track === undefined) {
    return
  }

  settle(track, status)

  if (!S.isWorking && busyAgents().length === 0) {
    stopBeat()
  }

  if (track.isKnown) {
    touch()
  }
}

function observe(track: Track, blocks: Map<number, Live>, chunk: TurnStepChunk, step: Step): void {
  if (chunk.kind === 'engine') {
    return
  }

  track.lastEvent = now()

  if (chunk.kind === 'thinking') {
    if (!track.isThinking) {
      track.isThinking = true
      track.thought = ''
    }

    track.thought = (track.thought + chunk.text).slice(-THOUGHT_MAX * 2)
    track.phase = 'thinking'
    step.seen += chunk.text.length
    step.thought += chunk.text.length

    if (chunk.text !== '' && track.isKnown) {
      S.hasThought = true
      S.typed += chunk.text.length
    }
  } else if (chunk.kind === 'text') {
    if (track.lastKind !== 'text') {
      track.ticker = ''
    }

    track.isThinking = false
    track.ticker = (track.ticker + chunk.text).slice(-TICKER_MAX)
    track.phase = 'talking'
    step.seen += chunk.text.length

    if (track.isKnown) {
      S.typed += chunk.text.length
    }
  } else if (chunk.kind === 'tool') {
    track.isThinking = false
    blocks.set(chunk.index, startLive(track, chunk.id, chunk.name))
    track.phase = 'writing'
  } else if (chunk.kind === 'input') {
    const live = blocks.get(chunk.index)

    step.seen += chunk.json.length

    if (live !== undefined) {
      feedJson(live.reader, chunk.json, (key, text) => take(live, key, text))
      track.phase = 'writing'
    }
  } else {
    const tokens = chunk.usage?.output_tokens ?? 0

    track.isThinking = false
    track.tokens += tokens

    if (track.isKnown) {
      S.tokens += tokens
    }

    // Çıktı tokenleri görünen metinden çok fazlaysa düşünce metni gönderilmemiştir.
    if (track === S.main && step.thought === 0 && tokens - step.seen / 2 >= HIDDEN_TOKENS) {
      S.isHidden = true
      armHint()
    }

    for (const live of blocks.values()) {
      if (live.status === 'streaming') {
        live.status = 'ready'
      }
    }
  }

  track.lastKind = chunk.kind

  if (track.isKnown) {
    touch()
  }
}

// --- Araç çalışırken ---------------------------------------------------------

function toolStarted(args: Record<string, unknown>): Live | undefined {
  const id = typeof args.tool_use_id === 'string' ? args.tool_use_id : ''
  const name = typeof args.tool === 'string' ? args.tool : ''

  if (id === '' || name === '') {
    return undefined
  }

  const track = trackOf(typeof args.agentId === 'string' ? args.agentId : undefined)
  const live = S.byId.get(id) ?? startLive(track, id, name)
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
  live.track.tools++
  live.track.phase = 'running'
  live.track.lastEvent = now()

  if (live.track.isKnown) {
    S.tools++
    touch()
  }

  return live
}

function toolEnded(live: Live, ran: Record<string, unknown>): void {
  const track = live.track
  const result = typeof ran.result === 'object' && ran.result !== null ? (ran.result as Record<string, unknown>) : {}

  live.ms = now() - live.startedAt
  live.status = typeof ran.deny === 'string' ? 'denied' : ran.isError === true ? 'error' : 'done'

  if (live.kind === 'edit') {
    live.hunks = toHunks(result.structuredPatch)
  }

  if (live.kind === 'shell' || live.status !== 'done') {
    const text = typeof ran.deny === 'string' ? ran.deny : typeof ran.text === 'string' ? ran.text : ''
    live.output = outputTail(text)
  }

  // Alt ajan çağrısının sonucu ajanın kimliğini taşır: şerit buradan da tanınır.
  // Arka planda başlatılan ajan henüz hiç adım atmamış olabilir.
  if (typeof result.agentId === 'string' && textOf(live, 'description') !== '') {
    const kind = typeof result.agentType === 'string' ? result.agentType : textOf(live, 'subagent_type')
    const agent =
      S.agents.get(result.agentId) ??
      (result.status === 'async_launched' ? trackOf(result.agentId) : undefined)

    if (agent !== undefined && !agent.isKnown) {
      reveal(agent, kind, textOf(live, 'description'))
    }
  }

  const isAlive = track === S.main ? S.isWorking : track.status === 'running'

  track.phase = isAlive ? 'thinking' : 'idle'
  track.lastEvent = now()

  if (track.isKnown) {
    touch()
  }
}

// --- Panel ---------------------------------------------------------------------

// Terminal hücre ızgarasıdır: metin sütuna tam kırpılır ve boşlukla doldurulur.
// Öbür yüzeylerde yazı orantılıdır; sütun sayısı yalnız kaba bir üst sınırdır.

/** Sonu kırpılabilen metin: orantılı yazıda fazlasını yüzey kendisi üç noktayla keser. */
const endFit = (d: Draw, text: string, room: number): string =>
  d.isTerminal ? fitEnd(text, room).padEnd(Math.max(0, room)) : fitEnd(text, room * 2)

/** Sonu önemli metin (dosya yolu): baştan kırpılır, orantılı yazıda sona taşmasın diye pay bırakılır. */
const startFit = (d: Draw, text: string, room: number): string =>
  d.isTerminal ? fitStart(text, room).padEnd(Math.max(0, room)) : fitStart(text, room)

/** Orantılı yüzeyde üst üste duran kutular arasına yarım satırlık nefes. */
const gapOf = (d: Draw): { marginTop?: number } => (d.isTerminal ? {} : { marginTop: 0.5 })

function headerRow(d: Draw, feed: Feed, scope: string) {
  const { Box, Text } = d.t
  const phase = PHASES[feed.phase]
  const isMain = feed.phase !== 'idle'
  const agents = feed.busyAgents > 0 ? `${feed.busyAgents} ajan` : ''
  let label = phase.label

  if (feed.isWorking && !isMain) {
    label = agents === '' ? 'çalışıyor' : `${agents} çalışıyor`
  } else if (feed.isWorking && agents !== '') {
    label = `${phase.label} · ${agents}`
  }

  const state = feed.isWorking ? `${d.frame} ${label}` : label
  const title = scope === '' ? TITLE : `${TITLE} › ${scope}`
  const time = fmtMs(feed.elapsedMs)
  // Dar panelde önce token sayısı, sonra araç sayısı düşer.
  const options =
    feed.tools + feed.tokens > 0
      ? [`${feed.tools} araç · ${fmtCount(feed.tokens)} token · ${time}`, `${feed.tools} araç · ${time}`, time]
      : []
  const room = d.cols - title.length - 2 - state.length - 2
  const stats = options.find(option => option.length <= room) ?? ''

  return (
    <Box>
      <Box flexShrink={0}>
        <Text bold color={VIOLET}>
          {title}
        </Text>
      </Box>
      <Box flexGrow={1} minWidth={0} marginLeft={2}>
        <Text color={feed.isWorking && !isMain ? VIOLET : phase.color} dimColor={!feed.isWorking} wrap="truncate-end">
          {state}
        </Text>
      </Box>
      {stats !== '' && (
        <Box flexShrink={0} marginLeft={2}>
          <Text dimColor>{stats}</Text>
        </Box>
      )}
    </Box>
  )
}

function pulseRow(d: Draw, feed: Feed) {
  const { Box, Text, Link } = d.t
  const Svg = d.svg

  // Boştayken çizginin ucunda imza durur; terminalde düz yazı (genişliği belli),
  // öbür yüzeylerde tıklanır bağlantı.
  if (!feed.isWorking) {
    if (Svg === undefined) {
      return (
        <Box>
          <Text dimColor wrap="truncate-end">{`${'─'.repeat(Math.max(0, d.cols - SITE.length - 1))} `}</Text>
          <Text color={EMERALD}>{SITE}</Text>
        </Box>
      )
    }

    return (
      <Box alignItems="center">
        <Box flexGrow={1} minWidth={0} flexDirection="column">
          <Svg source={RULE_SVG} alt="ayırıcı çizgi" height={2} />
        </Box>
        <Box flexShrink={0} marginLeft={1}>
          <Link href={`https://${SITE}`} label={SITE} />
        </Box>
      </Box>
    )
  }

  const speed = `${fmtCount(feed.speeds[feed.speeds.length - 1] ?? 0)} karakter/sn`

  // Terminal hücre ızgarasıdır: blok karakterler tam oturur. Öbür yüzeylerde
  // yazı orantılıdır; grafik vektör çizilir ve satırın genişliğine esner.
  if (Svg === undefined) {
    const spark = sparkSplit(feed.speeds, d.cols - speed.length - 2)

    return (
      <Box>
        {spark.flat !== '' && (
          <Text color={CYAN} dimColor wrap="truncate-end">
            {spark.flat}
          </Text>
        )}
        {spark.live !== '' && (
          <Text color={CYAN} wrap="truncate-end">
            {spark.live}
          </Text>
        )}
        <Text dimColor wrap="truncate-end">{`  ${speed}`}</Text>
      </Box>
    )
  }

  return (
    <Box alignItems="center">
      <Box flexGrow={1} minWidth={0} flexDirection="column">
        <Svg
          source={sparkSvg(feed.speeds, clamp(Math.round((d.cols - 17) * 1.38), 24, SPARK_MAX), CYAN)}
          alt={`Akış hızı: ${speed}`}
          height={SPARK_HEIGHT}
        />
      </Box>
      <Box flexShrink={0} minWidth={15} marginLeft={2} justifyContent="flex-end">
        <Text dimColor>{speed}</Text>
      </Box>
    </Box>
  )
}

/** Anlatım metninin canlı ucu; düşünce kutusu sığmıyorsa düşüncenin ucu da buradan akar. */
function tickerRow(d: Draw, feed: Feed, isBoxed: boolean) {
  const { Box, Text } = d.t
  const isTalking = feed.isWorking && feed.phase === 'talking' && feed.ticker !== ''
  const thought = !isBoxed && feed.isWorking && feed.phase === 'thinking' ? feed.thought : null

  if (!isTalking && thought === null) {
    return <Text> </Text>
  }

  const phase = PHASES[isTalking ? 'talking' : 'thinking']
  const text = isTalking ? feed.ticker : (thought?.text ?? '')

  return (
    <Box>
      <Box flexShrink={0}>
        <Text color={phase.color}>{phase.label}</Text>
      </Box>
      <Box flexGrow={1} minWidth={0} marginLeft={2}>
        <Text dimColor italic wrap="truncate-end">
          {fitStart(text, d.cols - phase.label.length - 2)}
        </Text>
      </Box>
    </Box>
  )
}

/**
 * Düşünce kutusu: metnin son `lines` satırı. Terminalde satırları kendimiz
 * sararız; orantılı yazıda sarmayı yüzey yapar, sabit yükseklikli kutu taşan
 * kısmı üstten keser ve akan uç hep görünür kalır.
 */
function thoughtBox(d: Draw, thought: Thought, lines: number) {
  const { Box, Text } = d.t
  const inner = d.cols - 4
  const text = thought.isLive ? `${thought.text}${CURSOR}` : thought.text
  const isDim = !thought.isLive
  let body
  let used = lines

  if (d.isTerminal) {
    const shown = wrapTail(text, inner, lines)

    used = shown.length
    body = shown.map(line => (
      <Text italic dimColor={isDim} wrap="truncate-end">
        {line}
      </Text>
    ))
  } else if (text.length >= inner * lines * 1.3) {
    body = (
      <Box height={lines} overflow="hidden" flexDirection="column" justifyContent="flex-end">
        <Box flexShrink={0}>
          <Text italic dimColor={isDim}>
            {tailText(text, inner * lines * 2)}
          </Text>
        </Box>
      </Box>
    )
  } else {
    used = clamp(Math.ceil(text.length / inner), 1, lines)
    body = (
      <Text italic dimColor={isDim}>
        {text}
      </Text>
    )
  }

  const node = (
    <Box flexDirection="column" borderStyle="round" borderColor={VIOLET} borderDimColor={isDim} paddingX={1} {...gapOf(d)}>
      <Box>
        <Box flexGrow={1} minWidth={0}>
          <Text bold color={VIOLET} dimColor={isDim}>
            Düşünce
          </Text>
        </Box>
        <Box flexShrink={0} marginLeft={2}>
          <Text color={thought.isLive ? VIOLET : GREEN} dimColor={isDim}>
            {thought.isLive ? `${d.frame} akıyor` : 'tamam'}
          </Text>
        </Box>
      </Box>
      {body}
    </Box>
  )

  return { node, used: used + 3 }
}

/** Düşünce metni gönderilmiyorsa nasıl açılacağını söyleyen soluk not. */
function hintLines(d: Draw) {
  const { Text } = d.t

  if (!d.isTerminal) {
    return { node: <Text dimColor>{d.hint}</Text>, used: Math.ceil(d.hint.length / d.cols) }
  }

  const shown = wrapTail(d.hint, d.cols, 4)

  return {
    node: shown.map(line => (
      <Text dimColor wrap="truncate-end">
        {line}
      </Text>
    )),
    used: shown.length,
  }
}

function agentRow(d: Draw, row: AgentRow) {
  const { Box, Text } = d.t
  const look = AGENT_LOOKS[row.status]
  const isRunning = row.status === 'running'
  const room = d.cols - 2 - AGENT_W - 1 - row.meta.length - 1

  return (
    <Box>
      <Box width={2} flexShrink={0}>
        <Text color={isRunning ? row.color || VIOLET : look.color}>{isRunning ? d.frame : look.glyph}</Text>
      </Box>
      <Box width={AGENT_W + 1} flexShrink={0}>
        <Text bold={!look.isDim} dimColor={look.isDim} color={row.color || VIOLET} wrap="truncate-end">
          {fitEnd(row.label, AGENT_W)}
        </Text>
      </Box>
      <Box flexGrow={1} minWidth={0}>
        <Text dimColor={look.isDim} wrap="truncate-end">
          {endFit(d, row.doing !== '' ? row.doing : row.task, room)}
        </Text>
      </Box>
      <Box flexShrink={0} marginLeft={1}>
        <Text dimColor>{row.meta}</Text>
      </Box>
    </Box>
  )
}

function logRow(d: Draw, row: Row, hasLanes: boolean) {
  const { Box, Text } = d.t
  const look = LOOKS[row.status]
  const isLive = row.status === 'streaming' || row.status === 'running'
  const lane = hasLanes ? 1 : 0
  const room = d.cols - lane - 2 - TOOL_W - 1 - (row.meta === '' ? 0 : row.meta.length + 1)
  const title = (row.title.includes('/') ? startFit : endFit)(d, row.title, room)

  return (
    <Box>
      {hasLanes && (
        <Box width={1} flexShrink={0}>
          {row.agent === '' ? <Text> </Text> : <Text color={row.color || VIOLET}>{LANE}</Text>}
        </Box>
      )}
      <Box width={2} flexShrink={0}>
        <Text color={look.color}>{isLive ? d.frame : look.glyph}</Text>
      </Box>
      <Box width={TOOL_W + 1} flexShrink={0}>
        <Text bold={!look.isDim} dimColor={look.isDim} color={KIND_COLOR[row.kind]} wrap="truncate-end">
          {fitEnd(row.tool, TOOL_W)}
        </Text>
      </Box>
      <Box flexGrow={1} minWidth={0}>
        <Text dimColor={look.isDim} wrap="truncate-end">
          {title}
        </Text>
      </Box>
      {row.meta !== '' && (
        <Box flexShrink={0} marginLeft={1}>
          <Text dimColor>{row.meta}</Text>
        </Box>
      )}
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
function stageBox(d: Draw, stage: Stage, rows: number) {
  const { Box, Text, Code } = d.t
  const inner = d.cols - 4
  const width = Math.max(40, inner) + 60
  // Satır numaralı kod kartında numara sütunu da yer tutar.
  const cap = d.cap > 0 && stage.kind === 'write' ? Math.max(12, d.cap - 5) : d.cap
  // Saran yüzeyde her kod kartının kendi iç boşluğu bir satır kadardır.
  const card = d.isTerminal ? 0 : 1
  const color = KIND_COLOR[stage.kind]
  const look = LOOKS[stage.status]
  const isStreaming = stage.status === 'streaming'
  const cursor = isStreaming ? CURSOR : ''
  const isLive = isStreaming || stage.status === 'running'
  const tool = fitEnd(stage.tool, Math.max(1, inner - 4))
  // Dar panelde önce sayaçlar, sonra ajan adı, en son durum yazısı düşer; başlık hep sığar.
  let badge = isLive ? `${d.frame} ${look.label}` : look.label
  let meta = stage.meta
  let agent = stage.agent === '' ? '' : `${fitEnd(stage.agent, AGENT_W)} ›`
  const roomOf = (): number =>
    inner -
    (agent === '' ? 0 : agent.length + 1) -
    tool.length -
    1 -
    (meta === '' ? 0 : meta.length + 2) -
    (badge.length + 2)
  let room = roomOf()

  if (room < 10) {
    meta = ''
    room = roomOf()
  }

  if (room < 10) {
    agent = ''
    room = roomOf()
  }

  if (room < 4) {
    badge = isLive ? d.frame : look.glyph
    room = roomOf()
  }

  const outLines = stage.output === '' ? 0 : rowsOf(stage.output, cap)
  let outRows = 0

  if (outLines > 0) {
    const share = Math.max(2, Math.floor(rows / 3))

    outRows =
      stage.kind === 'shell'
        ? Math.max(1, rows - 1 - card - Math.min(rowsOf(stage.body, cap), share))
        : Math.min(outLines, share)
  }

  const mainRows = outRows > 0 ? Math.max(1, rows - outRows - 1 - card) : rows
  let source = ''
  let more: Partial<CodeProps> = {}

  if (stage.kind === 'edit') {
    const isDraft = stage.hunks.length === 0
    const hunks = isDraft ? [liveHunk(stage.old, stage.body, !isStreaming)] : stage.hunks

    source = fitHunks(hunks, mainRows, width, isDraft && isStreaming, cursor, cap)
    more = { format: 'diff' }
  } else {
    const view = windowSource(stage.body, stage.firstLine, mainRows, width, cursor, cap)

    source = stage.body === '' && cursor === '' ? '' : view.source
    more = stage.kind === 'write' ? { startLine: view.startLine } : {}
  }

  const output = outRows > 0 ? windowSource(stage.output, 1, outRows, width, '', cap).source : ''
  const used =
    (source === '' ? 1 : rowsOf(source, cap) + card) + (output === '' ? 0 : 1 + rowsOf(output, cap) + card)

  const node = (
    <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} {...gapOf(d)}>
      <Box>
        {agent !== '' && (
          <Box flexShrink={0} marginRight={1}>
            <Text color={stage.color || VIOLET}>{agent}</Text>
          </Box>
        )}
        <Box flexShrink={0}>
          <Text bold color={color}>
            {tool}
          </Text>
        </Box>
        <Box flexGrow={1} minWidth={0} marginLeft={1}>
          <Text wrap="truncate-end">{startFit(d, stage.title, room)}</Text>
        </Box>
        {meta !== '' && (
          <Box flexShrink={0} marginLeft={2}>
            <Text dimColor>{meta}</Text>
          </Box>
        )}
        <Box flexShrink={0} marginLeft={2}>
          <Text color={look.color}>{badge}</Text>
        </Box>
      </Box>
      {source === '' ? <Text dimColor>…</Text> : <Code {...codeProps(stage, source, more)} />}
      {output !== '' && (
        <Text dimColor wrap="truncate-end">
          {d.isTerminal ? '─'.repeat(Math.max(1, inner)) : 'çıktı'}
        </Text>
      )}
      {output !== '' && <Code source={output} wrap="truncate-end" />}
    </Box>
  )

  return { node, used }
}

function paneTree(d: Draw, feed: Feed, scope: string, rows: number) {
  const { Box, Text } = d.t
  const stage = feed.stage
  const others = feed.rows.filter(row => row.id !== stage?.id).reverse()
  const hasLanes = others.some(row => row.agent !== '')
  // Kısa panelde ajan şeridi daralır; en kısasında yalnız başlıktaki sayı kalır.
  const agentRoom = rows >= 24 ? AGENT_ROWS : rows >= 16 ? 2 : rows >= 12 ? 1 : 0
  const busy = feed.agents.filter(row => row.status === 'running')
  const agents = agentRoom === 0 ? [] : (busy.length >= agentRoom ? busy : feed.agents).slice(-agentRoom)
  const more = agentRoom === 0 ? 0 : feed.moreAgents + feed.agents.length - agents.length
  // Başlık, nabız, akış satırı ve bir satır pay.
  let left = rows - 4 - agents.length - (more > 0 ? 1 : 0)
  const lines = feed.thought === null ? 0 : left >= 30 ? 5 : left >= 22 ? 4 : left >= 16 ? 3 : 0
  const thought = feed.thought !== null && lines > 0 ? thoughtBox(d, feed.thought, lines) : null
  const hint = thought === null && feed.isThoughtHidden && left >= 12 ? hintLines(d) : null

  left -= (thought?.used ?? 0) + (hint?.used ?? 0)

  const top = (
    <Box flexDirection="column">
      {headerRow(d, feed, scope)}
      {pulseRow(d, feed)}
      {agents.map(row => agentRow(d, row))}
      {more > 0 && <Text dimColor wrap="truncate-end">{`  +${more} ajan daha`}</Text>}
      {thought !== null && thought.node}
      {hint !== null && hint.node}
    </Box>
  )

  if (stage === null) {
    return (
      <Box flexDirection="column">
        {top}
        {tickerRow(d, feed, thought !== null)}
        {others.length === 0 && agents.length === 0 && (
          <Text dimColor>
            Claude bir dosya yazarken, düzenlerken ya da komut çalıştırırken kod burada canlı akar.
          </Text>
        )}
        {others.slice(0, Math.max(0, left)).map(row => logRow(d, row, hasLanes))}
      </Box>
    )
  }

  // Kod büyüdükçe günlüğe en az `logMin` satır kalır; kod kısaysa günlük genişler.
  const logMin = Math.min(others.length, left >= 28 ? 6 : left >= 20 ? 4 : left >= 13 ? 2 : 0)
  const box = stageBox(d, stage, Math.max(3, left - 3 - logMin))

  return (
    <Box flexDirection="column">
      {top}
      {box.node}
      {tickerRow(d, feed, thought !== null)}
      {others.slice(0, Math.max(0, left - 3 - box.used)).map(row => logRow(d, row, hasLanes))}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    let hinted = 0

    try {
      const held = await $.store.get('hints')

      hinted = typeof held === 'number' ? held : 0
    } catch {
      // Depo okunamadıysa ipucu hiç gösterilmemiş sayılır.
    }

    io = {
      save: feed => $.state.set(feedRef, feed),
      after: (ms, fn) => $.clock.after(ms, fn),
      every: (ms, fn) => $.clock.every(ms, fn),
      hinted: () => $.store.set('hints', hinted + 1),
    }
    S.cwd = e.cwd
    S.canHint = hinted < HINT_SESSIONS

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

      if (held !== undefined && S.main.items.length === 0) {
        const feed = complete(held)

        S.restored = {
          ...feed,
          thought: null,
          agents: feed.agents.map(row => (row.status === 'running' ? { ...row, status: 'stopped' } : row)),
          busyAgents: 0,
          isWorking: false,
          phase: 'idle',
          isThoughtHidden: false,
          rows: feed.rows.map(row =>
            row.status === 'streaming' || row.status === 'running' ? { ...row, status: 'stopped' } : row,
          ),
        }
        S.tools = feed.tools
        S.tokens = feed.tokens
        S.elapsedMs = feed.elapsedMs
        S.tick = feed.tick
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
      hinted: () => Promise.resolve(),
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
      } else {
        agentFinished(e.agentId, e.reason === 'error' ? 'error' : e.isAborted ? 'stopped' : 'done')
      }
    } catch {
      // Gözlem hiçbir zaman turu durdurmaz.
    }

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)

    try {
      if (typeof started.agentId === 'string') {
        reveal(trackOf(started.agentId), e.name ?? e.subagentType, e.description)
      }
    } catch {
      // Gözlem hiçbir zaman ajanı durdurmaz.
    }

    return started
  })

  on('turn.step', async function* ($, e, next) {
    const blocks = new Map<number, Live>()
    const step: Step = { seen: 0, thought: 0 }
    let track = S.main

    try {
      track = trackOf(e.agentId)

      if (track === S.main) {
        if (!S.isWorking) {
          begin(false)
        }
      } else {
        if (track.status !== 'running') {
          track.status = 'running'
          track.endedAt = 0
        }

        if (track.phase === 'idle') {
          track.phase = 'thinking'
        }

        if (track.isKnown) {
          startBeat()
        } else if (!track.isProbed) {
          // agent.spawn görülmediyse (modül sonradan yüklendi, takım arkadaşı)
          // motorun ajan listesine sorulur; listede yoksa motorun kendi iç döngüsüdür.
          const unknown = track

          unknown.isProbed = true
          $.agent
            .list()
            .then(list => {
              const info = list.find(agent => agent.id === unknown.id)

              if (info !== undefined) {
                reveal(unknown, info.name ?? info.type, info.description)
              }
            })
            .catch(() => undefined)
        }
      }
    } catch {
      // Gözlem hiçbir zaman akışı durdurmaz.
    }

    for await (const chunk of next(e)) {
      try {
        observe(track, blocks, chunk, step)
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
    const svg = e.surface === 'terminal' ? undefined : $.ui.resolve(e).Svg
    const held = (await $.state.get(feedRef)).value
    const base = held === undefined ? EMPTY : complete(held)
    // Görünümde bir alt ajanın konuşması açıksa panel o ajanı izler.
    const viewed = S.agents.get(e.props.view?.agentId ?? '')
    const feed = viewed !== undefined && viewed.isKnown ? agentFeed(viewed, base) : base
    const cols = clamp(Math.floor(e.props.bodyColumns || e.viewport?.columns || 80), 30, 240)
    const rows = clamp(Math.floor(e.props.scroll?.bodyRows || e.viewport?.rows || 30), 9, 140)
    const isTerminal = e.surface === 'terminal'
    const d: Draw = {
      t,
      svg,
      cols,
      frame: SPIN.charAt(feed.tick % SPIN.length),
      isTerminal,
      // Kod kartı tek aralıklı yazıyla ve kendi iç boşluğuyla çizilir: sütunların hepsi koda kalmaz.
      cap: isTerminal ? 0 : Math.max(16, Math.floor(cols * 0.9) - 11),
      hint: e.surface === 'desktop' ? HINTS.desktop : HINTS.other,
    }

    return paneTree(d, feed, feed === base ? '' : fitEnd(viewed?.label ?? '', AGENT_W), rows)
  })
}
