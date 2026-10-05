import { expect, mock, test } from 'claude-code/testing'

const PANE = 'kod-akisi'
const BS = String.fromCharCode(92)

type Node = string | { type: string; props?: Record<string, unknown>; children?: Node[] }

/** Panelin düz metin önizlemesini test çıktısına basar: gözle bakmak için. */
const show = (text: string): void => {
  ;(globalThis as { console?: { log: (line: string) => void } }).console?.log(text)
}

const paneProps = (columns: number, rows: number) => ({
  title: 'Kod Akışı',
  isFocused: false,
  bodyColumns: columns,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: rows },
  view: {},
})

/**
 * Çizilen ağacı, hücre düzenine yakın bir düz metne çevirir. Code satırlarını
 * yüzeyin yaptığı gibi genişliğe kırpar; kalan her şey olduğu gibi kalır.
 */
function paint(node: Node, width: number): string[] {
  if (typeof node === 'string') {
    return [node]
  }

  const props = node.props ?? {}
  const children = (node.children ?? []).filter(child => child !== null && child !== undefined)

  if (node.type === 'Code') {
    const first = typeof props.startLine === 'number' ? props.startLine : undefined

    return String(props.source)
      .split('\n')
      .map((line, at) => (first === undefined ? line : `${String(first + at).padStart(4)} ${line}`))
      .map(line => (line.length > width ? `${line.slice(0, width - 1)}…` : line))
  }

  const isFramed = typeof props.borderStyle === 'string'
  const inner = isFramed ? width - 4 : width

  if (node.type === 'Link') {
    return [String(props.label ?? props.href)]
  }

  if (node.type !== 'Box') {
    return [children.map(child => paint(child, inner).join('')).join('')]
  }

  let lines =
    props.flexDirection === 'column'
      ? children.flatMap(child => paint(child, inner))
      : [children.map(child => paint(child, inner).join('')).join('')]

  if (typeof props.minHeight === 'number') {
    while (lines.length < props.minHeight) {
      lines.push('')
    }
  }

  if (isFramed) {
    lines = [`╭${'─'.repeat(inner + 2)}╮`, ...lines.map(line => `│ ${line.padEnd(inner)} │`), `╰${'─'.repeat(inner + 2)}╯`]
  }

  return lines
}

test('yerleşim: her boyutta satırlar panele sığar', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)

  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', (_$, e) => ({
    result: {},
    text: e.tool === 'Bash' ? 'PASS  tests/akis.test.ts\n  10 pass\n  0 fail\nRan 10 tests across 1 file.' : 'ok',
  }))

  let script: { name: string; id: string; json: string } = { name: '', id: '', json: '' }

  on('turn.step', async function* (_$, e) {
    yield { kind: 'thinking' as const, index: 0, text: 'Şimdi panelin pencereleme mantığını kuruyorum, sonra testleri çalıştıracağım.' }
    yield { kind: 'tool' as const, index: 1, id: script.id, name: script.name }
    yield { kind: 'input' as const, index: 1, json: script.json }

    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use' as const, usage: null }
  })

  const step = async (name: string, id: string, input: Record<string, unknown>, cut = 0): Promise<void> => {
    const json = JSON.stringify(input)
    script = { name, id, json: cut > 0 ? json.slice(0, json.length - cut) : json }

    for await (const chunk of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 })) {
      void chunk
    }

    await clock.advance(1000)
  }

  const run = async (tool: string, id: string, input: Record<string, unknown>): Promise<void> => {
    await step(tool, id, input)
    await $.tool.call({ tool, tool_use_id: id, ...input } as never)
    await clock.advance(1000)
  }

  await $.session.start({ cwd: `C:${BS}proje`, surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'yaz', turnId: 't1' })

  await run('Read', 'r1', { file_path: `C:${BS}proje${BS}hooks${BS}register.tsx` })
  await run('Grep', 'g1', { pattern: 'turn\\.step', path: `C:${BS}proje${BS}types` })
  await run('Edit', 'e1', { file_path: `C:${BS}proje${BS}hooks${BS}akis.ts`, old_string: 'const a = 1', new_string: 'const a = 2' })
  await run('Bash', 'b1', { command: 'claude plugin test .', description: 'Mod testlerini çalıştır' })

  const body = Array.from({ length: 60 }, (_, n) =>
    n % 7 === 0 ? `export function adim${n}(girdi: string): string {` : `  const deger${n} = girdi.slice(${n}) + '${'x'.repeat(n % 5 === 0 ? 70 : 6)}'`,
  ).join('\n')

  await step('Write', 'w1', { file_path: `C:${BS}proje${BS}hooks${BS}register.tsx`, content: body }, 2)

  const check = async (label: string, isShown: boolean): Promise<void> => {
    for (const [columns, rows] of [[92, 32], [60, 18], [34, 10], [150, 50]] as const) {
      const ui = await $.ui.mount({
        plugin: PANE,
        surface: 'desktop',
        component: 'Pane',
        requestId: PANE,
        props: paneProps(columns, rows),
        viewport: { columns, rows },
      })
      const lines = paint((await ui.drawn()) as Node, columns)

      if (isShown && columns === 92) {
        show(`\n=== ${label} · ${columns} x ${rows} ===\n${lines.join('\n')}`)
      }

      expect(lines.filter(line => line.length > columns)).toEqual([])
      expect(lines.length <= rows).toBe(true)
      await ui.unmount()
    }
  }

  await check('Write akarken', true)

  await $.tool.call({ tool: 'Write', tool_use_id: 'w1', file_path: `C:${BS}proje${BS}hooks${BS}register.tsx`, content: body } as never)
  await clock.advance(1000)
  await step('Edit', 'e2', {
    file_path: `C:${BS}proje${BS}hooks${BS}akis.ts`,
    old_string: 'export function adim(girdi: string) {\n  const a = 1\n  return a\n}',
    new_string: 'export function adim(girdi: string): number {\n  const a = girdi.length\n  retu',
  }, 2)
  await check('Edit akarken', true)

  await run('PowerShell', 'p1', { command: 'Get-ChildItem hooks\n| Select-Object Name, Length', description: 'Dosyaları listele' })
  await check('komut bitti', false)

  await $.turn.complete({ answer: 'bitti', reason: 'answer', durationMs: 83_000, isAborted: false, turnId: 't1' })
  await clock.advance(1000)
  await check('tur bitti', true)
})
