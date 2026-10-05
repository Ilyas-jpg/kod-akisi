export type Kind = 'write' | 'edit' | 'shell' | 'other'

export type Status = 'streaming' | 'ready' | 'running' | 'done' | 'error' | 'denied' | 'stopped'

export type Phase = 'idle' | 'thinking' | 'talking' | 'writing' | 'running'

export type AgentStatus = 'running' | 'done' | 'error' | 'stopped'

export type Hunk = { oldStart: number; newStart: number; lines: string[] }

/** Günlükteki bir araç çağrısı. `agent` ana döngüde boştur; alt ajanda etiketi ve rengi taşır. */
export type Row = {
  id: string
  tool: string
  kind: Kind
  title: string
  meta: string
  status: Status
  agent: string
  color: string
}

export type Stage = {
  id: string
  tool: string
  kind: Kind
  title: string
  meta: string
  path: string
  language: string
  body: string
  firstLine: number
  old: string
  hunks: Hunk[]
  output: string
  status: Status
  agent: string
  color: string
}

/** Modelin düşünce metninin ucu; `isLive` blok hâlâ akarken doğrudur. */
export type Thought = { text: string; isLive: boolean }

/** Çalışan ya da yeni bitmiş bir alt ajanın şeridi. */
export type AgentRow = {
  id: string
  label: string
  task: string
  doing: string
  meta: string
  status: AgentStatus
  color: string
}

export type Feed = {
  rows: Row[]
  stage: Stage | null
  thought: Thought | null
  agents: AgentRow[]
  /** Şeritte gösterilmeyen alt ajan sayısı. */
  moreAgents: number
  /** O an çalışan alt ajan sayısı. */
  busyAgents: number
  /** Ana döngü ya da bir alt ajan çalışıyor. */
  isWorking: boolean
  /** Ana döngünün evresi; ana döngü boştaysa `idle`. */
  phase: Phase
  ticker: string
  /** Düşünce üretildi ama metni bu oturuma gönderilmiyor: nasıl açılacağı gösterilir. */
  isThoughtHidden: boolean
  tick: number
  speeds: number[]
  tools: number
  tokens: number
  elapsedMs: number
}

declare module 'claude-code' {
  interface PluginState {
    'kod-akisi': { feed: Feed; isClosed: boolean }
  }
}
