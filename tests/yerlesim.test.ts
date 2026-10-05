import { expect, mock, test } from 'claude-code/testing'

import { paint, textOf, walk } from './boya'
import type { Node } from './boya'

const PANE = 'kod-akisi'
const BS = String.fromCharCode(92)
const SIZES = [
  [92, 32],
  [60, 18],
  [34, 10],
  [150, 50],
] as const
/** Hücre düzenine güvenen dolgu: orantılı yazıda satırı taşırıp alt satıra sarar. */
const FILL = /[▁▂▃▄▅▆▇█─]{8,}/

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

const THOUGHT =
  'Önce çizginin neden ikiye bölündüğünü anlamam gerekiyor. Hız grafiği blok karakterlerle çiziliyor ' +
  've genişliği sütun sayısından hesaplanıyor; orantılı yazıda bu hesap tutmuyor, satır taşıp alta ' +
  'sarıyor. Grafiği vektör çizip satırın genişliğine esnetirsem yazı tipinden bağımsız olur. Ardından ' +
  'örnek sayısını genişliğe bağlayacağım ki çubuklar yolun ortasında kaybolmasın, sonra testleri çalıştıracağım.'

test('yerleşim: her boyutta, iki yüzeyde de satırlar panele sığar', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)

  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.spawn', (_$, e) => ({ model: 'm', agentId: `ajan-${e.tool_use_id}` }))
  on('tool.call', (_$, e) => ({
    result: {},
    text: e.tool === 'Bash' ? 'PASS  tests/akis.test.ts\n  10 pass\n  0 fail\nRan 10 tests across 1 file.' : 'ok',
  }))

  let script: Array<Record<string, unknown>> = []

  on('turn.step', async function* (_$, e) {
    for (const chunk of script) {
      yield chunk as never
    }

    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use' as const, usage: null }
  })

  const stream = async (chunks: Array<Record<string, unknown>>, agentId?: string): Promise<void> => {
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

  const tool = (name: string, id: string, input: Record<string, unknown>, cut = 0): Array<Record<string, unknown>> => {
    const json = JSON.stringify(input)

    return [
      { kind: 'tool', index: 1, id, name },
      { kind: 'input', index: 1, json: cut > 0 ? json.slice(0, json.length - cut) : json },
    ]
  }

  const run = async (name: string, id: string, input: Record<string, unknown>, agentId?: string): Promise<void> => {
    await stream(tool(name, id, input), agentId)
    await $.tool.call({ tool: name, tool_use_id: id, ...input, ...(agentId === undefined ? {} : { agentId }) } as never)
    await clock.advance(1000)
  }

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

  await $.session.start({ cwd: `C:${BS}proje`, surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'yaz', turnId: 't1' })

  await stream([{ kind: 'thinking', index: 0, text: THOUGHT }])
  await run('Read', 'r1', { file_path: `C:${BS}proje${BS}hooks${BS}register.tsx` })
  await run('Grep', 'g1', { pattern: 'turn\\.step', path: `C:${BS}proje${BS}types` })
  await run('Edit', 'e1', { file_path: `C:${BS}proje${BS}hooks${BS}akis.ts`, old_string: 'const a = 1', new_string: 'const a = 2' })
  await run('Bash', 'b1', { command: 'claude plugin test .', description: 'Mod testlerini çalıştır' })

  await spawn('a1', 'Explore', 'Kod tabanında turn.step kullanımını tara')
  await spawn('a2', 'code-reviewer', 'Değişiklikleri gözden geçir')
  await run('Grep', 'ag1', { pattern: 'agentId', path: `C:${BS}proje${BS}hooks` }, 'ajan-a1')
  await stream(tool('Read', 'ar1', { file_path: `C:${BS}proje${BS}tests${BS}akis.test.ts` }), 'ajan-a2')

  const body = Array.from({ length: 60 }, (_, n) =>
    n % 7 === 0 ? `export function adim${n}(girdi: string): string {` : `  const deger${n} = girdi.slice(${n}) + '${'x'.repeat(n % 5 === 0 ? 70 : 6)}'`,
  ).join('\n')

  await stream([
    { kind: 'thinking', index: 0, text: THOUGHT },
    ...tool('Write', 'w1', { file_path: `C:${BS}proje${BS}hooks${BS}register.tsx`, content: body }, 2),
  ])

  const check = async (label: string, isShown: boolean): Promise<void> => {
    const problems: string[] = []

    for (const [columns, rows] of SIZES) {
      for (const surface of ['terminal', 'desktop'] as const) {
        const at = `${label} · ${surface} · ${columns} x ${rows}`
        const ui = await $.ui.mount({
          plugin: PANE,
          surface,
          component: 'Pane',
          requestId: PANE,
          props: paneProps(columns, rows),
          viewport: { columns, rows },
        })
        const tree = (await ui.drawn()) as Node

        if (surface === 'terminal') {
          const lines = paint(tree, columns)

          if (isShown && (columns === 92 || columns === 60)) {
            show(`\n=== ${at} ===\n${lines.join('\n')}`)
          }

          problems.push(...lines.filter(line => line.length > columns).map(line => `${at}: geniş satır: ${line}`))

          if (lines.length > rows) {
            problems.push(`${at}: ${lines.length} satır`)
          }
        } else {
          const texts = walk(tree).filter(node => node.type === 'Text')
          // Kod kartı uzun satırı sarar; sarılmış hâliyle de panel taşmaz.
          const lines = paint(tree, columns, Math.max(16, Math.floor(columns * 0.9) - 11))

          // Orantılı yazıda sütun hesabı tutmaz: uzun dolgu satırı yazıyla çizilmez.
          problems.push(...texts.map(textOf).filter(text => FILL.test(text)).map(text => `${at}: dolgu: ${text}`))

          if (lines.length > rows + 2) {
            problems.push(`${at}: ${lines.length} satır`)
          }
        }

        await ui.unmount()
      }
    }

    expect(problems).toEqual([])
  }

  await check('Write akarken, iki ajan çalışırken', true)

  await $.tool.call({ tool: 'Write', tool_use_id: 'w1', file_path: `C:${BS}proje${BS}hooks${BS}register.tsx`, content: body } as never)
  await clock.advance(1000)
  await $.turn.complete({ answer: 'tarandı', reason: 'answer', durationMs: 21_000, isAborted: false, turnId: 'a1', agentId: 'ajan-a1' })
  await stream(
    tool(
      'Edit',
      'e2',
      {
        file_path: `C:${BS}proje${BS}hooks${BS}akis.ts`,
        old_string: 'export function adim(girdi: string) {\n  const a = 1\n  return a\n}',
        new_string: 'export function adim(girdi: string): number {\n  const a = girdi.length\n  retu',
      },
      2,
    ),
  )
  await check('Edit akarken', true)

  await $.turn.complete({ answer: 'incelendi', reason: 'answer', durationMs: 34_000, isAborted: false, turnId: 'a2', agentId: 'ajan-a2' })
  await run('PowerShell', 'p1', { command: 'Get-ChildItem hooks\n| Select-Object Name, Length', description: 'Dosyaları listele' })
  await check('komut bitti', false)

  await $.turn.complete({ answer: 'bitti', reason: 'answer', durationMs: 83_000, isAborted: false, turnId: 't1' })
  await clock.advance(1000)
  await check('tur bitti', true)
})
