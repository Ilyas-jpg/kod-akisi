// Kod Akışı: saf mantık. Motorla ($) konuşan her şey register.tsx'te durur.

import type { Hunk } from '../types'

// --- Akan JSON okuyucu ------------------------------------------------------

export type Reader = {
  depth: number
  inString: boolean
  isKey: boolean
  expectKey: boolean
  esc: boolean
  uni: string | null
  key: string
  keyBuf: string
}

export const newReader = (): Reader => ({
  depth: 0,
  inString: false,
  isKey: false,
  expectKey: false,
  esc: false,
  uni: null,
  key: '',
  keyBuf: '',
})

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' }
const QUOTE = 34
const BACKSLASH = 92

/**
 * Araç argümanlarının JSON'unu parça parça okur. Üst düzey string değerlerin
 * çözülmüş metnini, geldiği anda `sink(key, text)` ile verir; kaçış dizisi iki
 * parçaya bölünse de doğru çözer. İç içe değerler atlanır.
 */
export function feedJson(
  r: Reader,
  piece: string,
  sink: (key: string, text: string) => void,
): void {
  const n = piece.length
  let i = 0

  const emit = (text: string): void => {
    if (r.depth !== 1) {
      return
    }

    if (r.isKey) {
      r.keyBuf += text
    } else {
      sink(r.key, text)
    }
  }

  while (i < n) {
    if (r.inString) {
      if (r.uni !== null) {
        r.uni += piece.charAt(i++)

        if (r.uni.length === 4) {
          const code = Number.parseInt(r.uni, 16)
          r.uni = null

          if (!Number.isNaN(code)) {
            emit(String.fromCharCode(code))
          }
        }

        continue
      }

      if (r.esc) {
        const c = piece.charAt(i++)
        r.esc = false

        if (c === 'u') {
          r.uni = ''
        } else {
          emit(ESCAPES[c] ?? c)
        }

        continue
      }

      let j = i

      while (j < n) {
        const code = piece.charCodeAt(j)

        if (code === QUOTE || code === BACKSLASH) {
          break
        }

        j++
      }

      if (j > i) {
        emit(piece.slice(i, j))
        i = j
        continue
      }

      if (piece.charCodeAt(i++) === BACKSLASH) {
        r.esc = true
        continue
      }

      r.inString = false

      if (r.depth === 1 && r.isKey) {
        r.key = r.keyBuf
        r.keyBuf = ''
        r.isKey = false
      }

      continue
    }

    const c = piece.charAt(i++)

    if (c === '"') {
      r.inString = true

      if (r.depth === 1) {
        if (r.expectKey) {
          r.isKey = true
          r.keyBuf = ''
        } else {
          sink(r.key, '')
        }
      }
    } else if (c === '{' || c === '[') {
      r.depth++

      if (r.depth === 1) {
        r.expectKey = true
      }
    } else if (c === '}' || c === ']') {
      r.depth--
    } else if (c === ':') {
      if (r.depth === 1) {
        r.expectKey = false
      }
    } else if (c === ',') {
      if (r.depth === 1) {
        r.expectKey = true
      }
    }
  }
}

// --- Kuyruk tamponu ---------------------------------------------------------

export const TAIL_MAX = 8000

/** Akan metnin yalnız son kısmını tutar; satır numarası ve toplamlar doğru kalır. */
export type Tail = { text: string; firstLine: number; newlines: number; chars: number }

export const newTail = (): Tail => ({ text: '', firstLine: 1, newlines: 0, chars: 0 })

function countNewlines(text: string, end = text.length): number {
  let count = 0

  for (let at = text.indexOf('\n'); at !== -1 && at < end; at = text.indexOf('\n', at + 1)) {
    count++
  }

  return count
}

/** `cut`tan sonraki ilk satır başını verir; satır çok uzunsa satır ortasından keser. */
function lineStartAfter(text: string, cut: number): number {
  const newline = text.indexOf('\n', cut)

  if (newline !== -1 && newline + 1 <= cut + (text.length - cut) / 2) {
    return newline + 1
  }

  const code = text.charCodeAt(cut)

  return code >= 0xdc00 && code <= 0xdfff ? cut + 1 : cut
}

export function tailPush(tail: Tail, text: string): void {
  if (text === '') {
    return
  }

  tail.chars += text.length
  tail.newlines += countNewlines(text)
  tail.text += text

  if (tail.text.length > TAIL_MAX * 2) {
    const cut = lineStartAfter(tail.text, tail.text.length - TAIL_MAX)
    tail.firstLine += countNewlines(tail.text, cut)
    tail.text = tail.text.slice(cut)
  }
}

/** Bütün metinden kuyruk kurar (araç çağrısının kesin argümanı geldiğinde). */
export function tailOf(full: string): Tail {
  const tail = newTail()
  tail.chars = full.length
  tail.newlines = countNewlines(full)

  if (full.length <= TAIL_MAX) {
    tail.text = full

    return tail
  }

  const cut = lineStartAfter(full, full.length - TAIL_MAX)
  tail.firstLine = 1 + countNewlines(full, cut)
  tail.text = full.slice(cut)

  return tail
}

export const tailLines = (tail: Tail): number => (tail.chars === 0 ? 0 : tail.newlines + 1)

/** Kuyruğun son `max` karakteri, satır başından başlayacak şekilde. */
export function tailView(tail: Tail, max: number): { text: string; firstLine: number } {
  if (tail.text.length <= max) {
    return { text: tail.text, firstLine: tail.firstLine }
  }

  const cut = lineStartAfter(tail.text, tail.text.length - max)

  return { text: tail.text.slice(cut), firstLine: tail.firstLine + countNewlines(tail.text, cut) }
}

// --- Metin temizliği ve ölçü ------------------------------------------------

const ANSI = /\u001B\[[0-9;?]*[ -/]*[@-~]/g
// Code öğesi sekme ve satır sonu dışında kontrol karakteri kabul etmez.
const CONTROLS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g

export const clean = (text: string): string => text.replace(ANSI, '').replace(CONTROLS, '')

export const oneLine = (text: string): string => clean(text).replace(/\s+/g, ' ').trim()

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

export function fitEnd(text: string, width: number): string {
  if (width <= 0) {
    return ''
  }

  return text.length <= width ? text : `${text.slice(0, width - 1)}…`
}

export function fitStart(text: string, width: number): string {
  if (width <= 0) {
    return ''
  }

  return text.length <= width ? text : `…${text.slice(text.length - width + 1)}`
}

// --- Code öğesi için pencereleme -------------------------------------------

/** Code öğesinin `source` sınırı 10 000 karakter; pay bırakıyoruz. */
export const CODE_MAX = 9500

export type SourceWindow = { source: string; startLine: number }

/** Metnin son `rows` satırı; `cursor` verilirse son satırın ucuna eklenir. */
export function windowSource(
  text: string,
  firstLine: number,
  rows: number,
  width: number,
  cursor = '',
): SourceWindow {
  const lines = text.split('\n')

  if (cursor === '' && lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop()
  }

  const from = Math.max(0, lines.length - Math.max(1, rows))
  const shown = lines.slice(from).map(line => fitEnd(line, width))
  let startLine = firstLine + from

  if (cursor !== '') {
    shown[shown.length - 1] = `${shown[shown.length - 1] ?? ''}${cursor}`
  }

  let size = shown.reduce((sum, line) => sum + line.length + 1, 0)

  while (size > CODE_MAX && shown.length > 1) {
    size -= (shown.shift() ?? '').length + 1
    startLine++
  }

  return { source: shown.join('\n'), startLine }
}

/** Çıktının son `rows` satırı. */
export function lastLines(text: string, rows: number, width: number): string {
  return windowSource(text, 1, rows, width).source
}

/** Araç çıktısının gösterilecek kuyruğu: ANSI'siz, kırpılmış, sondaki boşluklar atılmış. */
export function outputTail(text: string, maxLines = 60): string {
  const lines = clean(text.slice(-8000))
    .split('\n')
    .map(line => line.replace(/\t/g, '  ').trimEnd())

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }

  return lines
    .slice(-maxLines)
    .map(line => fitEnd(line, 300))
    .join('\n')
}

// --- Fark (diff) ------------------------------------------------------------

const SPACE = 32
const PLUS = 43
const MINUS = 45

const isOld = (line: string): boolean => {
  const code = line.charCodeAt(0)

  return code === SPACE || code === MINUS
}

const isNew = (line: string): boolean => {
  const code = line.charCodeAt(0)

  return code === SPACE || code === PLUS
}

const hunkHeader = (oldStart: number, newStart: number, lines: readonly string[]): string =>
  `@@ -${oldStart},${lines.filter(isOld).length} +${newStart},${lines.filter(isNew).length} @@`

/**
 * Akış sırasındaki Edit için tek parçalı fark: ortak baş satırlar bağlam,
 * kalanı eksi ve artı. `isFinal` olunca ortak son satırlar da bağlama düşer.
 */
export function liveHunk(oldText: string, newText: string, isFinal: boolean): Hunk {
  const before = oldText === '' ? [] : oldText.split('\n')
  const after = newText === '' ? [] : newText.split('\n')
  // Akarken son satır henüz bitmemiştir, eşleşmeye katılmaz.
  const limit = Math.min(before.length, isFinal ? after.length : after.length - 1)
  let head = 0

  while (head < limit && before[head] === after[head]) {
    head++
  }

  let tail = 0

  if (isFinal) {
    const room = Math.min(before.length, after.length) - head

    while (tail < room && before[before.length - 1 - tail] === after[after.length - 1 - tail]) {
      tail++
    }
  }

  return {
    oldStart: 1,
    newStart: 1,
    lines: [
      ...before.slice(0, head).map(line => ` ${line}`),
      ...before.slice(head, before.length - tail).map(line => `-${line}`),
      ...after.slice(head, after.length - tail).map(line => `+${line}`),
      ...before.slice(before.length - tail).map(line => ` ${line}`),
    ],
  }
}

/** Edit sonucundaki `structuredPatch`i güvenle Hunk listesine çevirir. */
export function toHunks(raw: unknown): Hunk[] {
  if (!Array.isArray(raw)) {
    return []
  }

  const hunks: Hunk[] = []
  let budget = 600

  for (const item of raw) {
    if (budget <= 0 || typeof item !== 'object' || item === null) {
      break
    }

    const { oldStart, newStart, lines } = item as Record<string, unknown>

    if (typeof oldStart !== 'number' || typeof newStart !== 'number' || !Array.isArray(lines)) {
      continue
    }

    const kept: string[] = []

    for (const line of lines) {
      if (typeof line !== 'string' || line.startsWith('\\')) {
        continue
      }

      if (budget-- <= 0) {
        break
      }

      const text = clean(line)
      const mark = text.charCodeAt(0)

      kept.push(fitEnd(mark === SPACE || mark === PLUS || mark === MINUS ? text : ` ${text}`, 400))
    }

    if (kept.length > 0) {
      hunks.push({ oldStart, newStart, lines: kept })
    }
  }

  return hunks
}

export function countChanges(hunks: readonly Hunk[]): { added: number; removed: number } {
  let added = 0
  let removed = 0

  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      const mark = line.charCodeAt(0)

      if (mark === PLUS) {
        added++
      } else if (mark === MINUS) {
        removed++
      }
    }
  }

  return { added, removed }
}

function buildDiff(
  hunks: readonly Hunk[],
  rows: number,
  width: number,
  fromEnd: boolean,
  cursor: string,
): string {
  const out: string[] = []

  if (fromEnd) {
    const hunk = hunks[hunks.length - 1]

    if (hunk === undefined) {
      return ''
    }

    const skip = Math.max(0, hunk.lines.length - (rows - 1))
    const skipped = hunk.lines.slice(0, skip)
    const kept = hunk.lines.slice(skip).map(line => fitEnd(line, width))

    if (kept.length === 0) {
      return ''
    }

    out.push(
      hunkHeader(
        hunk.oldStart + skipped.filter(isOld).length,
        hunk.newStart + skipped.filter(isNew).length,
        kept,
      ),
      ...kept,
    )
  } else {
    let room = rows

    for (const hunk of hunks) {
      if (room < 2) {
        break
      }

      const kept = hunk.lines.slice(0, room - 1).map(line => fitEnd(line, width))

      if (kept.length === 0) {
        continue
      }

      out.push(hunkHeader(hunk.oldStart, hunk.newStart, kept), ...kept)
      room -= kept.length + 1
    }
  }

  if (out.length === 0) {
    return ''
  }

  if (cursor !== '') {
    out[out.length - 1] = `${out[out.length - 1] ?? ''}${cursor}`
  }

  return out.join('\n')
}

/**
 * Fark parçalarını `rows` satıra sığan birleşik-fark metnine çevirir; başlık
 * sayıları gösterilen satırlardan yeniden hesaplanır. `fromEnd` akan ucu tutar.
 */
export function fitHunks(
  hunks: readonly Hunk[],
  rows: number,
  width: number,
  fromEnd: boolean,
  cursor = '',
): string {
  for (let room = Math.max(2, rows); room >= 2; room = Math.floor(room * 0.7)) {
    const text = buildDiff(hunks, room, width, fromEnd, cursor)

    if (text.length <= CODE_MAX) {
      return text
    }
  }

  return ''
}

// --- Başlık, sayaç, biçim ---------------------------------------------------

const BARS = '▁▂▃▄▅▆▇█'

/** Hız örneklerinden blok karakterli mini grafik; en yeni örnek sağda. */
export function sparkline(samples: readonly number[], width: number): string {
  if (width <= 0) {
    return ''
  }

  const shown = samples.slice(-width)
  const top = Math.max(120, ...shown)

  return shown
    .map(value => BARS.charAt(Math.min(7, Math.floor((Math.max(0, value) / top) * 7.999))))
    .join('')
    .padStart(width, '▁')
}

const comma = (value: number): string => value.toFixed(1).replace('.', ',')

export function fmtCount(n: number): string {
  if (n < 1000) {
    return String(Math.round(n))
  }

  return n < 10_000 ? `${comma(n / 1000)}k` : `${Math.round(n / 1000)}k`
}

export function fmtMs(ms: number): string {
  if (ms < 1000) {
    return `${Math.max(0, Math.round(ms))} ms`
  }

  if (ms < 60_000) {
    return `${comma(ms / 1000)} sn`
  }

  const seconds = Math.floor(ms / 1000)

  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export const fmtSize = (chars: number): string =>
  chars < 1024 ? `${chars} B` : `${comma(chars / 1024)} KB`

/** Yolu çalışma dizinine göre kısaltır; dışarıdaysa son üç parçayı bırakır. */
export function shortPath(path: string, cwd: string): string {
  const full = path.replace(/\\/g, '/')
  const base = cwd.replace(/\\/g, '/').replace(/\/+$/, '')

  if (base !== '' && full.toLowerCase().startsWith(`${base.toLowerCase()}/`)) {
    return full.slice(base.length + 1)
  }

  const parts = full.split('/').filter(part => part !== '')

  return parts.length <= 3 ? full : `…/${parts.slice(-3).join('/')}`
}

/** `mcp__sunucu__arac` adından yalnız araç kısmını bırakır. */
export function toolLabel(name: string): string {
  if (!name.startsWith('mcp__')) {
    return name
  }

  const parts = name.split('__')

  return parts[parts.length - 1] || name
}
