import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { paint, textOf, walk } from './boya'
import type { Node } from './boya'

const PANE = 'kod-akisi'
const BS = String.fromCharCode(92)
const SURFACES = ['desktop', 'terminal'] as const

type Chunk = Record<string, unknown>

const THOUGHT =
  'Önce çizginin neden ikiye bölündüğünü anlamam gerekiyor. Hız grafiği blok karakterlerle çiziliyor ' +
  've genişliği sütun sayısından hesaplanıyor; orantılı yazıda bu hesap tutmuyor, satır taşıp alta ' +
  'sarıyor. Grafiği vektör çizip satırın genişliğine esnetirsem yazı tipinden bağımsız olur. Ardından ' +
  'örnek sayısını genişliğe bağlayacağım ki çubuklar yolun ortasında kaybolmasın, sonra testleri çalıştıracağım'

const usageOf = (tokens: number) => ({
  input_tokens: 10,
  output_tokens: tokens,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  model: 'm',
})

/** Motorun yerine geçen taban kancalar ve akışı süren yardımcılar. */
function setup($: Engine, on: On, entries?: Record<string, unknown>) {
  const clock = mock.clock(on)
  let script: Chunk[] = []

  mock.store(on, entries)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.spawn', (_$, e) => ({ model: 'm', agentId: `ajan-${e.tool_use_id}` }))
  on('agent.list', () => ({ value: [] }))
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  on('turn.step', async function* (_$, e) {
    for (const chunk of script) {
      yield chunk as never
    }

    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use' as const, usage: null }
  })

  const stream = async (chunks: Chunk[], agentId?: string): Promise<void> => {
    script = chunks

    for await (const chunk of $.turn.step({
      turnId: 't1',
      index: 0,
      model: 'm',
      messageCount: 1,
      ...(agentId === undefined ? {} : { agentId }),
    })) {
      void chunk
    }

    await clock.advance(1000)
  }

  const tool = (name: string, id: string, input: Record<string, unknown>): Chunk[] => [
    { kind: 'tool', index: 1, id, name },
    { kind: 'input', index: 1, json: JSON.stringify(input) },
  ]

  const spawn = (id: string, kind: string, task: string) =>
    $.agent.spawn({
      tool_use_id: id,
      prompt: task,
      description: task,
      subagentType: kind,
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'm',
      background: false,
      fork: false,
    })

  const mount = (surface: (typeof SURFACES)[number], columns = 90, rows = 40, view: { agentId?: string } = {}) =>
    $.ui.mount({
      plugin: PANE,
      surface,
      component: 'Pane',
      requestId: PANE,
      props: {
        title: 'Kod Akışı',
        isFocused: false,
        bodyColumns: columns,
        placement: 'dock' as const,
        scroll: { offset: 0, bodyRows: rows },
        view,
      },
      viewport: { columns, rows },
    })

  const begin = async (): Promise<void> => {
    await $.session.start({ cwd: `C:${BS}proje`, surface: 'desktop', isInteractive: true })
    await $.turn.start({ text: 'yaz', turnId: 't1' })
    await clock.settle()
  }

  const end = async (agentId?: string): Promise<void> => {
    await $.turn.complete({
      answer: 'bitti',
      reason: 'answer',
      durationMs: 4200,
      isAborted: false,
      turnId: agentId ?? 't1',
      ...(agentId === undefined ? {} : { agentId }),
    })
    await clock.advance(1000)
  }

  return { clock, stream, tool, spawn, mount, begin, end }
}

test('düşünce: akan metin kendi kutusunda görünür, tur bitince kalkar', async ($, on) => {
  const { stream, tool, mount, begin, end } = setup($, on)

  await begin()
  await stream([
    { kind: 'thinking', index: 0, text: THOUGHT.slice(0, 180) },
    { kind: 'thinking', index: 0, text: THOUGHT.slice(180) },
  ])

  for (const surface of SURFACES) {
    const ui = await mount(surface, 60, 40)
    const tree = (await ui.drawn()) as Node

    expect(await ui.find({ type: 'Text', text: /^Düşünce$/ })).toBeDefined()
    expect(await ui.find({ text: /akıyor/ })).toBeDefined()
    // Akan uç her zaman çizilir: metnin sonu ve imleç.
    expect(walk(tree).some(node => node.type === 'Text' && /çalıştıracağım▍$/.test(textOf(node)))).toBe(true)

    if (surface === 'terminal') {
      // Hücre ızgarasında satırları kendimiz sararız: hiçbiri paneli aşmaz.
      expect(paint(tree, 60).filter(line => line.length > 60)).toEqual([])
    } else {
      // Orantılı yazıda sarmayı yüzey yapar; sabit yükseklikli kutu üstten keser.
      const clip = walk(tree).find(node => node.type === 'Box' && node.props?.overflow === 'hidden')

      expect(clip?.props?.justifyContent).toBe('flex-end')
      expect(typeof clip?.props?.height).toBe('number')
    }

    await ui.unmount()
  }

  // Araç başlayınca düşünce biter ama kutu okunabilsin diye yerinde kalır.
  await stream(tool('Read', 'r1', { file_path: `C:${BS}proje${BS}a.ts` }))

  const ui = await mount('desktop')

  expect(await ui.find({ type: 'Text', text: /^Düşünce$/ })).toBeDefined()
  expect(await ui.find({ text: /akıyor/ })).toBeUndefined()

  await end()
  expect(await ui.find({ type: 'Text', text: /^Düşünce$/ })).toBeUndefined()
  await ui.unmount()
})

test('düşünce gizliyse: nasıl açılacağı yüzeye göre yazılır, metin gelince kalkar', async ($, on) => {
  const { stream, tool, mount, begin } = setup($, on)

  await begin()
  // Az şey göründü ama çok token harcandı: düşünce üretildi, metni gönderilmedi.
  await stream([...tool('Read', 'r1', { file_path: `C:${BS}proje${BS}a.ts` }), { kind: 'stop', stopReason: 'tool_use', usage: usageOf(900) }])

  const desktop = await mount('desktop')
  const terminal = await mount('terminal')

  expect(await desktop.find({ text: /Transcript view › Thinking/ })).toBeDefined()
  expect(await terminal.find({ text: /showThinkingSummaries/ })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: /^Düşünce$/ })).toBeUndefined()

  await stream([{ kind: 'thinking', index: 0, text: 'şimdi metin geliyor' }])
  expect(await desktop.find({ text: /Transcript view/ })).toBeUndefined()
  expect(await desktop.find({ type: 'Text', text: /^Düşünce$/ })).toBeDefined()

  await desktop.unmount()
  await terminal.unmount()
})

test('düşünce gizliyse: ipucu birkaç oturumdan sonra bir daha çıkmaz', async ($, on) => {
  const { stream, tool, mount, begin } = setup($, on, { hints: 3 })

  await begin()
  await stream([...tool('Read', 'r1', { file_path: `C:${BS}proje${BS}a.ts` }), { kind: 'stop', stopReason: 'tool_use', usage: usageOf(900) }])

  const ui = await mount('desktop')

  expect(await ui.find({ text: /Transcript view/ })).toBeUndefined()
  await ui.unmount()
})

test('alt ajan: kendi şeridinde görünür, sahneye adıyla çıkar, günlükte renkle işaretlenir', async ($, on) => {
  const { clock, stream, tool, spawn, mount, begin, end } = setup($, on)

  await begin()
  await spawn('a1', 'Explore', 'Kod tabanını tara')
  await stream(tool('Grep', 'ag1', { pattern: 'agentId' }), 'ajan-a1')
  await stream(tool('Write', 'aw1', { file_path: `C:${BS}proje${BS}not.md`, content: 'ajanın yazdığı\niki satır' }), 'ajan-a1')

  for (const surface of SURFACES) {
    const ui = await mount(surface)
    const tree = (await ui.drawn()) as Node
    const lines = paint(tree, 90)

    // Başlık çalışan ajanı sayar, şerit türünü ve o anki işini gösterir.
    expect(await ui.find({ text: /düşünüyor · 1 ajan/ })).toBeDefined()
    expect(lines.some(line => /Explore\s+Write not\.md/.test(line))).toBe(true)
    // Sahnedeki kod ajanınsa başlığında adı durur.
    expect(await ui.find({ type: 'Text', text: 'Explore ›' })).toBeDefined()
    expect(String((await ui.find({ type: 'Code' }))?.props.source)).toContain('ajanın yazdığı')
    // Günlükte ajanın satırı şerit rengiyle işaretlenir.
    expect(lines.some(line => /^▎.\s+Grep\s+agentId/.test(line))).toBe(true)
    await ui.unmount()
  }

  // Ana konuşma yazmaya başlayınca sahne ona döner.
  await stream(tool('Write', 'w1', { file_path: `C:${BS}proje${BS}ana.ts`, content: 'ana konuşmanın kodu' }))

  const ui = await mount('terminal')

  expect(String((await ui.find({ type: 'Code' }))?.props.source)).toContain('ana konuşmanın kodu')
  expect(await ui.find({ type: 'Text', text: 'Explore ›' })).toBeUndefined()

  // Ajan bitince şeridi soluk kalır; yeni turda kalkar.
  await end('ajan-a1')
  expect(await ui.find({ text: /1 ajan/ })).toBeUndefined()
  expect(paint((await ui.drawn()) as Node, 90).some(line => /^✓ Explore\s+Kod tabanını tara/.test(line))).toBe(true)

  await end()
  await $.turn.start({ text: 'devam', turnId: 't2' })
  await clock.advance(1000)
  expect(await ui.find({ type: 'Text', text: 'Explore' })).toBeUndefined()
  await ui.unmount()
})

test('alt ajan: ana konuşma bitse de çalışan ajan panelde izlenir', async ($, on) => {
  const { stream, tool, spawn, mount, begin, end } = setup($, on)

  await begin()
  await spawn('a1', 'general-purpose', 'Arka planda testleri koştur')
  await stream(tool('Bash', 'ab1', { command: 'npm test', description: 'Testleri çalıştır' }), 'ajan-a1')
  await end()

  const ui = await mount('desktop')

  expect(await ui.find({ text: /1 ajan çalışıyor/ })).toBeDefined()
  // Çalışma sürdükçe imza yerine hız grafiği durur.
  expect(await ui.find({ type: 'Link' })).toBeUndefined()
  expect(await ui.find({ type: 'Svg' })).toBeDefined()

  await end('ajan-a1')
  expect(await ui.find({ text: /hazır/ })).toBeDefined()
  expect((await ui.find({ type: 'Link' }))?.props.href).toBe('https://ilyassaltay.com')
  await ui.unmount()
})

test('alt ajan: motorun kendi iç döngüleri panele karışmaz', async ($, on) => {
  const { stream, tool, mount, begin } = setup($, on)

  await begin()
  await stream(tool('Write', 'w1', { file_path: `C:${BS}proje${BS}ana.ts`, content: 'ana konuşmanın kodu' }))
  // Ajan olarak bildirilmemiş bir döngü: sıkıştırma, hafıza gibi iç işler.
  await stream(
    [{ kind: 'thinking', index: 0, text: 'iç döngünün düşüncesi' }, ...tool('Write', 'x1', { file_path: `C:${BS}proje${BS}gizli.md`, content: 'iç döngünün yazdığı' })],
    'ic-dongu-1',
  )

  const ui = await mount('desktop')
  const shown = walk((await ui.drawn()) as Node).map(node => (node.type === 'Code' ? String(node.props?.source) : textOf(node)))

  expect(shown.some(text => text.includes('iç döngünün'))).toBe(false)
  expect(shown.some(text => text.includes('gizli.md'))).toBe(false)
  expect(String((await ui.find({ type: 'Code' }))?.props.source)).toContain('ana konuşmanın kodu')
  expect(await ui.find({ text: /ajan/ })).toBeUndefined()
  await ui.unmount()
})

test('alt ajan: görünümde bir ajanın konuşması açıkken panel o ajanı izler', async ($, on) => {
  const { stream, tool, spawn, mount, begin } = setup($, on)

  await begin()
  await stream(tool('Read', 'r1', { file_path: `C:${BS}proje${BS}ana.ts` }))
  await spawn('a1', 'Explore', 'Kod tabanını tara')
  await stream([{ kind: 'thinking', index: 0, text: 'ajanın düşüncesi' }, ...tool('Write', 'aw1', { file_path: `C:${BS}proje${BS}not.md`, content: 'ajanın yazdığı' })], 'ajan-a1')
  await stream(tool('Write', 'w1', { file_path: `C:${BS}proje${BS}ana.ts`, content: 'ana konuşmanın kodu' }))

  const ui = await mount('terminal', 90, 40, { agentId: 'ajan-a1' })
  const lines = paint((await ui.drawn()) as Node, 90)

  expect(lines[0]?.startsWith('Kod Akışı › Explore')).toBe(true)
  expect(String((await ui.find({ type: 'Code' }))?.props.source)).toContain('ajanın yazdığı')
  expect(await ui.find({ text: /ajanın düşüncesi/ })).toBeDefined()
  // Ana konuşmanın satırları bu görünümde yer almaz.
  expect(lines.some(line => line.includes('ana.ts'))).toBe(false)
  await ui.unmount()
})
