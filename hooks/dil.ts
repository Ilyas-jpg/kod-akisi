// Kod Akışı: arayüz dili. Varsayılan İngilizce; `/kod-akisi tr` Türkçeye çevirir
// ve tercih depoda kalır. Motorla konuşmaz: yalnız metin ve sayı biçimi.

import type { Phase, Status } from '../types'

export type Lang = 'en' | 'tr'

export const TITLE = 'Kod Akışı'

export type Words = {
  phase: Record<Phase, string>
  status: Record<Status, string>
  second: string
  rate: string
  lines: (count: number) => string
  tools: (count: number) => string
  tokens: (count: string) => string
  agents: (count: number) => string
  /** Ana döngü boştayken çalışan ajanlar: "2 agents running". */
  agentsBusy: (agents: string) => string
  busy: string
  moreAgents: (count: number) => string
  /** Adı bildirilmemiş alt ajanın şerit etiketi. */
  agent: string
  thought: string
  flowing: string
  done: string
  output: string
  divider: string
  rateAlt: (speed: string) => string
  empty: string
  hintDesktop: string
  hintOther: string
  commandDescription: string
  commandHint: string
  toastReady: string
  closed: string
  open: string
  notPlaced: (reason: string) => string
  langSet: string
}

const EN: Words = {
  phase: { idle: 'ready', thinking: 'thinking', talking: 'talking', writing: 'writing', running: 'running' },
  status: {
    streaming: 'writing',
    ready: 'queued',
    running: 'running',
    done: 'done',
    error: 'error',
    denied: 'denied',
    stopped: 'stopped',
  },
  second: 's',
  rate: 'chars/s',
  lines: count => (count === 1 ? '1 line' : `${count} lines`),
  tools: count => (count === 1 ? '1 tool' : `${count} tools`),
  tokens: count => `${count} tokens`,
  agents: count => (count === 1 ? '1 agent' : `${count} agents`),
  agentsBusy: agents => `${agents} running`,
  busy: 'running',
  moreAgents: count => (count === 1 ? '+1 more agent' : `+${count} more agents`),
  agent: 'agent',
  thought: 'Thinking',
  flowing: 'streaming',
  done: 'done',
  output: 'output',
  divider: 'divider',
  rateAlt: speed => `Stream rate: ${speed}`,
  empty: 'When Claude writes a file, edits one or runs a command, the code streams here live.',
  hintDesktop:
    'Thinking text is not being sent to this session. Choose Transcript view › Thinking in the title menu and it streams here.',
  hintOther:
    'Thinking text is not being sent to this session. Turn on showThinkingSummaries in settings and it streams here.',
  commandDescription: `Opens the ${TITLE} pane; "off" closes it, "tr" or "en" sets the language`,
  commandHint: '[off|tr|en]',
  toastReady: `${TITLE} is ready: type /kod-akisi to open the pane`,
  closed: `${TITLE} closed. Type /kod-akisi to open it again.`,
  open: `The ${TITLE} pane is open.`,
  notPlaced: reason => `The ${TITLE} pane could not be placed right now: ${reason}`,
  langSet: 'Language: English. Type /kod-akisi tr for Turkish.',
}

const TR: Words = {
  phase: { idle: 'hazır', thinking: 'düşünüyor', talking: 'anlatıyor', writing: 'yazıyor', running: 'çalıştırıyor' },
  status: {
    streaming: 'yazılıyor',
    ready: 'sırada',
    running: 'çalışıyor',
    done: 'tamam',
    error: 'hata',
    denied: 'reddedildi',
    stopped: 'durduruldu',
  },
  second: 'sn',
  rate: 'karakter/sn',
  lines: count => `${count} satır`,
  tools: count => `${count} araç`,
  tokens: count => `${count} token`,
  agents: count => `${count} ajan`,
  agentsBusy: agents => `${agents} çalışıyor`,
  busy: 'çalışıyor',
  moreAgents: count => `+${count} ajan daha`,
  agent: 'ajan',
  thought: 'Düşünce',
  flowing: 'akıyor',
  done: 'tamam',
  output: 'çıktı',
  divider: 'ayırıcı çizgi',
  rateAlt: speed => `Akış hızı: ${speed}`,
  empty: 'Claude bir dosya yazarken, düzenlerken ya da komut çalıştırırken kod burada canlı akar.',
  hintDesktop:
    'Düşünce metni bu oturuma gönderilmiyor. Başlık menüsünden Transcript view › Thinking seçince burada akar.',
  hintOther: 'Düşünce metni bu oturuma gönderilmiyor. Ayarlarda showThinkingSummaries açılınca burada akar.',
  commandDescription: `${TITLE} panelini açar; "kapat" kapatır, "tr" ya da "en" dili seçer`,
  commandHint: '[kapat|tr|en]',
  toastReady: `${TITLE} hazır: paneli açmak için /kod-akisi yaz`,
  closed: `${TITLE} kapatıldı. Yeniden açmak için /kod-akisi yaz.`,
  open: `${TITLE} paneli açık.`,
  notPlaced: reason => `${TITLE} paneli şu an yerleştirilemedi: ${reason}`,
  langSet: 'Dil: Türkçe. İngilizce için /kod-akisi en yaz.',
}

// Modülün kendi belleği: yeniden yüklemede varsayılana döner, session.start
// depodaki tercihi geri okur.
let current: Lang = 'en'

export const getLang = (): Lang => current

export const setLang = (lang: Lang): void => {
  current = lang
}

export const words = (): Words => (current === 'tr' ? TR : EN)

/** Depodan ya da dışarıdan gelen değeri dile çevirir; tanımıyorsa `undefined`. */
export const toLang = (value: unknown): Lang | undefined => (value === 'tr' || value === 'en' ? value : undefined)

/** Tek ondalıklı sayı; ondalık işareti dile göre nokta ya da virgül. */
export const decimal = (value: number): string =>
  current === 'tr' ? value.toFixed(1).replace('.', ',') : value.toFixed(1)

export type Arg = 'off' | 'tr' | 'en' | ''

const ARGS: Record<string, Arg> = {
  kapat: 'off',
  off: 'off',
  close: 'off',
  tr: 'tr',
  turkce: 'tr',
  türkçe: 'tr',
  turkish: 'tr',
  en: 'en',
  english: 'en',
  ingilizce: 'en',
}

/**
 * `/kod-akisi` komutunun argümanını okur. Büyük harfle yazılmış "İNGİLİZCE" ya da
 * "ENGLISH" de tanınsın diye noktalı ve noktasız i tek harfe indirilir.
 */
export function readArg(raw: string): Arg {
  const plain = raw
    .trim()
    .toLowerCase()
    .replace(/̇/g, '')
    .replace(/ı/g, 'i')

  return ARGS[plain] ?? ''
}
