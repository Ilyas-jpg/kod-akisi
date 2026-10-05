import { expect, mock, test } from 'claude-code/testing'

import {
  CODE_MAX,
  TAIL_MAX,
  clean,
  feedJson,
  fitHunks,
  liveHunk,
  newReader,
  newTail,
  rowsOf,
  shortPath,
  sparkSplit,
  sparkSvg,
  sparkline,
  tailLines,
  tailOf,
  tailPush,
  tailText,
  tailView,
  toHunks,
  windowSource,
  wrapTail,
} from '../hooks/akis'

const PANE = 'kod-akisi'
const BS = String.fromCharCode(92)

const paneProps = (columns: number, rows: number) => ({
  title: 'Kod Akışı',
  isFocused: false,
  bodyColumns: columns,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: rows },
  view: {},
})

function read(json: string, size: number): Record<string, string> {
  const got: Record<string, string> = {}
  const reader = newReader()

  for (let at = 0; at < json.length; at += size) {
    feedJson(reader, json.slice(at, at + size), (key, text) => {
      got[key] = (got[key] ?? '') + text
    })
  }

  return got
}

test('akan JSON: her boyutta parçalansa da aynı sonucu verir', () => {
  const input = {
    file_path: `C:${BS}proje${BS}a.ts`,
    content: `const s = "tırnak"\n\tgirinti ${BS} ters bölü ç ş ğ`,
    replace_all: true,
    nested: { content: 'iç içe değer alınmaz' },
    list: ['alınmaz'],
    after: 'son alan',
  }
  const want = { file_path: input.file_path, content: input.content, after: input.after }

  for (const size of [1, 2, 3, 7, 1000]) {
    expect(read(JSON.stringify(input), size)).toEqual(want)
  }
})

test('akan JSON: bölünmüş unicode kaçışı ve vekil çift', () => {
  const json = `{"content":"${BS}u00e7 ${BS}ud83d${BS}ude00 ${BS}/ bitti"}`

  for (const size of [1, 4, 5]) {
    expect(read(json, size)).toEqual({ content: 'ç 😀 / bitti' })
  }
})

test('kuyruk: uzun akışta satır numarası ve toplamlar doğru kalır', () => {
  const tail = newTail()
  let full = ''

  for (let n = 1; n <= 4000; n++) {
    const line = `satır ${n}\n`
    full += line
    tailPush(tail, line)
  }

  expect(tail.chars).toBe(full.length)
  expect(tailLines(tail)).toBe(4001)
  expect(tail.text.length <= TAIL_MAX * 2).toBe(true)
  expect(tail.text.startsWith(`satır ${tail.firstLine}\n`)).toBe(true)

  const view = tailView(tail, 500)
  expect(view.text.startsWith(`satır ${view.firstLine}\n`)).toBe(true)

  const whole = tailOf(full)
  expect(whole.chars).toBe(full.length)
  expect(whole.text.startsWith(`satır ${whole.firstLine}\n`)).toBe(true)
})

test('pencere: son satırlar, doğru başlangıç numarası, imleç ve boyut sınırı', () => {
  const text = Array.from({ length: 50 }, (_, n) => `satır ${n + 1}`).join('\n')
  const view = windowSource(text, 101, 5, 80, '▍')

  expect(view.startLine).toBe(146)
  expect(view.source).toBe('satır 46\nsatır 47\nsatır 48\nsatır 49\nsatır 50▍')

  const wide = Array.from({ length: 200 }, () => 'x'.repeat(300)).join('\n')
  expect(windowSource(wide, 1, 200, 300).source.length <= CODE_MAX).toBe(true)
})

test('temizlik: ANSI ve kontrol karakterleri gider, sekme ve satır sonu kalır', () => {
  const esc = String.fromCharCode(27)

  expect(clean(`a${esc}[31mkırmızı${esc}[0m\r\n\tb${String.fromCharCode(7)}`)).toBe('akırmızı\n\tb')
})

test('fark: ortak baş ve son bağlam olur, sayılar tutar', () => {
  const hunk = liveHunk('a\nb\nc', 'a\nB\nc', true)

  expect(hunk.lines).toEqual([' a', '-b', '+B', ' c'])
  expect(fitHunks([hunk], 20, 80, false)).toBe('@@ -1,3 +1,3 @@\n a\n-b\n+B\n c')
})

test('fark: akarken son satır eşleşmeye girmez, pencere uçtan tutulur', () => {
  const hunk = liveHunk('a\nb', 'a\nb', false)
  expect(hunk.lines).toEqual([' a', '-b', '+b'])

  const long = liveHunk('', Array.from({ length: 10 }, (_, n) => `yeni ${n + 1}`).join('\n'), false)
  expect(fitHunks([long], 4, 80, true, '▍')).toBe('@@ -1,0 +8,3 @@\n+yeni 8\n+yeni 9\n+yeni 10▍')
})

test('fark: araç sonucundaki yama güvenle okunur', () => {
  const hunks = toHunks([
    { oldStart: 12, oldLines: 2, newStart: 12, newLines: 2, lines: [' x', '-y', '+z', `${BS} No newline at end of file`] },
    { oldStart: 'bozuk' },
    null,
  ])

  expect(hunks).toEqual([{ oldStart: 12, newStart: 12, lines: [' x', '-y', '+z'] }])
  expect(fitHunks(hunks, 10, 80, false)).toBe('@@ -12,2 +12,2 @@\n x\n-y\n+z')
  expect(toHunks('yama değil')).toEqual([])
})

test('biçim: yol kısaltma ve hız grafiği', () => {
  expect(shortPath(`C:${BS}proje${BS}src${BS}a.ts`, `C:${BS}proje`)).toBe('src/a.ts')
  expect(shortPath('D:/x/y/z/w/a.ts', 'C:/proje')).toBe('…/z/w/a.ts')
  expect(sparkline([0, 60, 120], 5)).toBe('▁▁▁▄█')
})

test('hız grafiği: veri gelmemiş kısım ayrılır, genişlik hiç aşılmaz', () => {
  // Baştaki dolgu ve sıfır örnekler soluk kısımdır; veri başladıktan sonraki duraklama canlı kısımda kalır.
  expect(sparkSplit([0, 0, 60, 0, 120], 8)).toEqual({ flat: '▁▁▁▁▁', live: '▄▁█' })
  expect(sparkSplit([], 4)).toEqual({ flat: '▁▁▁▁', live: '' })

  const many = Array.from({ length: 300 }, (_, n) => n)
  const split = sparkSplit(many, 40)

  expect((split.flat + split.live).length).toBe(40)
})

test('hız grafiği: vektör hâli tek parçadır ve genişliğe esner', () => {
  const svg = sparkSvg([0, 30, 120, 0, 240], 10, '#06B6D4')

  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="22"')).toBe(true)
  // Yüzey resmi satırın genişliğine çeker; oran korunmaz ki satır hiç taşmasın.
  expect(svg.includes('preserveAspectRatio="none"')).toBe(true)
  // Sıfır örnek çubuk bırakmaz: üç çubuk, en yenisi en sağda ve en uzun.
  expect(svg.match(/M\d+ \d+h4/g)).toEqual(['M37 18h4', 'M43 11h4', 'M55 1h4'])
  expect(sparkSvg([], 10, '#06B6D4').includes('<path')).toBe(false)
  expect(sparkSvg(Array.from({ length: 500 }, () => 99), 240, '#06B6D4').length < 9000).toBe(true)
})

test('düz yazı: kelime kelime sarılır, akan uç görünür kalır', () => {
  expect(wrapTail('bir iki üç dört beş altı yedi', 10, 2)).toEqual(['dört beş', 'altı yedi'])
  expect(wrapTail('kısa', 10, 3)).toEqual(['kısa'])
  expect(wrapTail('abcdefghijklmnop son', 8, 5)).toEqual(['abcdefgh', 'ijklmnop', 'son'])
  expect(tailText('bir iki üç dört beş', 9)).toBe('…dört beş')
  expect(tailText('kısa', 9)).toBe('kısa')
})

test('pencere: saran yüzeyde uzun satırın tuttuğu yer hesaba katılır', () => {
  const text = ['kısa', 'x'.repeat(45), 'orta uzunlukta bir satır', 'son'].join('\n')
  const view = windowSource(text, 1, 4, 80, '', 20)

  // 45 karakterlik satır 20 karakterlik kartta üç satır tutar: dört satıra son üç satır sığmaz.
  expect(view.source).toBe('orta uzunlukta bir satır\nson')
  expect(view.startLine).toBe(3)
  expect(rowsOf(view.source, 20) <= 4).toBe(true)
  // Kırpan yüzeyde her satır tek satırdır.
  expect(windowSource(text, 1, 4, 80).source.split('\n').length).toBe(4)

  const hunk = { oldStart: 1, newStart: 1, lines: ['+' + 'a'.repeat(50), '+b', '+c'] }

  expect(fitHunks([hunk], 4, 80, true, '', 20)).toBe('@@ -1,0 +2,2 @@\n+b\n+c')
  expect(fitHunks([hunk], 4, 80, false, '', 20)).toBe(`@@ -1,0 +1,1 @@\n+${'a'.repeat(50)}`)
})

test('uçtan uca: akan Write, Edit ve komut panelde çizilir', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)

  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', (_$, e) =>
    e.tool === 'Edit'
      ? {
          result: {
            structuredPatch: [
              { oldStart: 7, oldLines: 1, newStart: 7, newLines: 1, lines: ['-const a = 1', '+const a = 2'] },
            ],
          },
          text: 'tamam',
        }
      : { result: {}, text: 'satır 1\nsatır 2\nçıktının sonu' },
  )

  let script: { name: string; id: string; pieces: string[] } = { name: '', id: '', pieces: [] }

  on('turn.step', async function* (_$, e) {
    yield { kind: 'thinking' as const, index: 0, text: 'önce dosyayı yazacağım' }
    yield { kind: 'tool' as const, index: 1, id: script.id, name: script.name }

    for (const json of script.pieces) {
      yield { kind: 'input' as const, index: 1, json }
    }

    yield { kind: 'stop' as const, stopReason: 'tool_use' as const, usage: null }

    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use' as const, usage: null }
  })

  const step = async (name: string, id: string, input: Record<string, unknown>): Promise<void> => {
    const json = JSON.stringify(input)
    script = { name, id, pieces: [json.slice(0, 9), json.slice(9, 31), json.slice(31)] }

    for await (const chunk of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 })) {
      void chunk
    }

    await clock.advance(1000)
  }

  await $.session.start({ cwd: `C:${BS}proje`, surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'yaz', turnId: 't1' })
  await clock.settle()

  const body = Array.from({ length: 40 }, (_, n) => `const satir${n + 1} = ${n + 1}`).join('\n')
  await step('Write', 'toolu_write', { file_path: `C:${BS}proje${BS}src${BS}demo.ts`, content: body })

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({
      plugin: PANE,
      surface,
      component: 'Pane',
      requestId: PANE,
      props: paneProps(90, 30),
      viewport: { columns: 90, rows: 30 },
    })
    const code = await ui.find({ type: 'Code' })

    expect(String(code?.props.source).endsWith('const satir40 = 40')).toBe(true)
    expect(code?.props.path).toBe('C:/proje/src/demo.ts'.replace(/\//g, BS))
    expect(code?.props.startLine).toBe(41 - String(code?.props.source).split('\n').length)
    expect(await ui.find({ text: /src\/demo\.ts/ })).toBeDefined()
    expect(await ui.find({ text: /sırada/ })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({
    plugin: PANE,
    surface: 'desktop',
    component: 'Pane',
    requestId: PANE,
    props: paneProps(90, 30),
    viewport: { columns: 90, rows: 30 },
  })

  await step('Edit', 'toolu_edit', {
    file_path: `C:${BS}proje${BS}src${BS}demo.ts`,
    old_string: 'const a = 1',
    new_string: 'const a = 2',
  })
  expect((await ui.find({ type: 'Code' }))?.props.format).toBe('diff')
  expect(String((await ui.find({ type: 'Code' }))?.props.source)).toBe('@@ -1,1 +1,1 @@\n-const a = 1\n+const a = 2')

  await $.tool.call({
    tool: 'Edit',
    tool_use_id: 'toolu_edit',
    file_path: `C:${BS}proje${BS}src${BS}demo.ts`,
    old_string: 'const a = 1',
    new_string: 'const a = 2',
  })
  await clock.advance(1000)
  expect(String((await ui.find({ type: 'Code' }))?.props.source)).toBe('@@ -7,1 +7,1 @@\n-const a = 1\n+const a = 2')
  expect(await ui.find({ text: /\+1 −1/ })).toBeDefined()

  await step('Bash', 'toolu_bash', { command: 'npm test', description: 'Testleri çalıştır' })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'toolu_bash', command: 'npm test', description: 'Testleri çalıştır' })
  await clock.advance(1000)
  expect((await ui.find({ type: 'Code', text: /npm test/ }))?.props.language).toBe('bash')
  expect(await ui.find({ type: 'Code', text: /çıktının sonu/ })).toBeDefined()
  expect(await ui.find({ text: /Testleri çalıştır/ })).toBeDefined()

  await $.turn.complete({
    answer: 'bitti',
    reason: 'answer',
    durationMs: 4200,
    isAborted: false,
    turnId: 't1',
  })
  await clock.advance(1000)
  expect(await ui.find({ text: /hazır/ })).toBeDefined()
  expect(await ui.find({ text: /2 araç/ })).toBeDefined()
  expect((await ui.find({ type: 'Link' }))?.props.href).toBe('https://ilyassaltay.com')
  await ui.unmount()
})
