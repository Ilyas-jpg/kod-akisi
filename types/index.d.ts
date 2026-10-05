export type Kind = 'write' | 'edit' | 'shell' | 'other'

export type Status = 'streaming' | 'ready' | 'running' | 'done' | 'error' | 'denied' | 'stopped'

export type Phase = 'idle' | 'thinking' | 'talking' | 'writing' | 'running'

export type Hunk = { oldStart: number; newStart: number; lines: string[] }

export type Row = {
  id: string
  tool: string
  kind: Kind
  title: string
  meta: string
  status: Status
  isAgent: boolean
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
}

export type Feed = {
  rows: Row[]
  stage: Stage | null
  isWorking: boolean
  phase: Phase
  ticker: string
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
