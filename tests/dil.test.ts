import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { fmtCount, fmtMs, fmtSize } from '../hooks/akis'
import { readArg, setLang } from '../hooks/dil'

const PANE = 'kod-akisi'
const BS = String.fromCharCode(92)

/** Motorun yerine geçen taban kancalar; komut kaydında verilen açıklamalar `described`da toplanır. */
function setup($: Engine, on: On, entries?: Record<string, unknown>) {
  const clock = mock.clock(on)
  const described: string[] = []
  // Depoya ne yazıldığı da denetlendiği için hazır depo yerine bellekteki bu eşleme kullanılır.
  const kept = new Map<string, unknown>(Object.entries(entries ?? {}))

  on('store.get', (_$, e) => ({ value: kept.get(e.key) }))
  on('store.set', (_$, e) => {
    kept.set(e.key, e.value)

    return { value: undefined }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => {
    described.push(`${e.description} ${e.argumentHint ?? ''}`)

    return { value: { command: e.name } }
  })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  on('turn.step', async function* (_$, e) {
    yield { kind: 'tool' as const, index: 1, id: 'toolu_dil', name: 'Write' }
    yield {
      kind: 'input' as const,
      index: 1,
      json: JSON.stringify({ file_path: `C:${BS}proje${BS}a.ts`, content: 'const a = 1\nconst b = 2' }),
    }
    yield { kind: 'stop' as const, stopReason: 'tool_use' as const, usage: null }

    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use' as const, usage: null }
  })

  const start = () => $.session.start({ cwd: `C:${BS}proje`, surface: 'desktop', isInteractive: true })

  const mount = () =>
    $.ui.mount({
      plugin: PANE,
      surface: 'terminal',
      component: 'Pane',
      requestId: PANE,
      props: {
        title: 'Kod Akışı',
        isFocused: false,
        bodyColumns: 90,
        placement: 'dock' as const,
        scroll: { offset: 0, bodyRows: 30 },
        view: {},
      },
      viewport: { columns: 90, rows: 30 },
    })

  const write = async (): Promise<void> => {
    await $.turn.start({ text: 'write', turnId: 't1' })
    await clock.settle()

    for await (const chunk of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 })) {
      void chunk
    }

    await clock.advance(1000)
  }

  const finish = async (): Promise<void> => {
    await $.turn.complete({ answer: 'done', reason: 'answer', durationMs: 4200, isAborted: false, turnId: 't1' })
    await clock.advance(1000)
  }

  return { clock, described, kept, start, mount, write, finish }
}

// Testin içe aktardığı dil.ts ile motorun yüklediği modülünki ayrı kopyalardır:
// eklentinin dili buradan okunamaz, panelde ne çizildiğine bakılır.

test('dil: depodaki tercih Türkçeyse arayüz Türkçe açılır', async ($, on) => {
  const { described, start, mount, write } = setup($, on, { lang: 'tr' })

  await start()
  expect(described[0]).toContain('dili seçer')
  expect(described[0]).toContain('[kapat|tr|en]')

  const ui = await mount()

  await write()
  expect(await ui.find({ text: /sırada/ })).toBeDefined()
  expect(await ui.find({ text: /2 satır/ })).toBeDefined()
  await ui.unmount()
})

// Bir önceki test eklentiyi Türkçe bıraktı: tercih yoksa dil taşınmaz, varsayılana döner.
test('dil: tercih yoksa arayüz İngilizce açılır', async ($, on) => {
  const { described, start, mount, write, finish } = setup($, on)

  await start()
  expect(described[0]).toContain('sets the language')
  expect(described[0]).toContain('[off|tr|en]')

  const ui = await mount()

  await write()
  expect(await ui.find({ text: /queued/ })).toBeDefined()
  expect(await ui.find({ text: /2 lines/ })).toBeDefined()
  expect(await ui.find({ text: /sırada|satır/ })).toBeUndefined()

  await finish()
  expect(await ui.find({ text: /ready/ })).toBeDefined()
  expect(await ui.find({ text: /hazır/ })).toBeUndefined()
  await ui.unmount()
})

test('dil: /kod-akisi tr Türkçeye çevirir ve tercihi depoya yazar', async ($, on) => {
  const { kept, start, mount, write } = setup($, on)
  const run = (args: string) => $.command.run({ command: 'kod-akisi', args } as never)

  await start()

  const ui = await mount()

  await write()
  expect(await ui.find({ text: /queued/ })).toBeDefined()

  expect((await run('TR')).text).toContain('Türkçe')
  expect(kept.get('lang')).toBe('tr')
  // Açık panel yeni dille hemen yeniden çizilir.
  expect(await ui.find({ text: /sırada/ })).toBeDefined()
  expect(await ui.find({ text: /2 satır/ })).toBeDefined()
  expect(await ui.find({ text: /queued/ })).toBeUndefined()

  expect((await run('english')).text).toContain('English')
  expect(kept.get('lang')).toBe('en')
  expect(await ui.find({ text: /queued/ })).toBeDefined()
  expect(await ui.find({ text: /sırada/ })).toBeUndefined()
  await ui.unmount()
})

test('dil: komut argümanı büyük harfle ve iki dilde de tanınır', () => {
  expect(readArg('kapat')).toBe('off')
  expect(readArg(' OFF ')).toBe('off')
  expect(readArg('close')).toBe('off')
  expect(readArg('tr')).toBe('tr')
  expect(readArg('TÜRKÇE')).toBe('tr')
  expect(readArg('Turkish')).toBe('tr')
  expect(readArg('EN')).toBe('en')
  expect(readArg('ENGLISH')).toBe('en')
  // Türkçe klavyede büyük İ ve küçük ı: ikisi de aynı kelimeye çıkar.
  expect(readArg('İNGİLİZCE')).toBe('en')
  expect(readArg('ıngılızce')).toBe('en')
  expect(readArg('')).toBe('')
  expect(readArg('başka bir şey')).toBe('')
})

test('dil: ondalık işareti ve saniye kısaltması dile uyar', () => {
  setLang('en')
  expect(fmtMs(1500)).toBe('1.5 s')
  expect(fmtCount(1234)).toBe('1.2k')
  expect(fmtSize(3379)).toBe('3.3 KB')

  setLang('tr')
  expect(fmtMs(1500)).toBe('1,5 sn')
  expect(fmtCount(1234)).toBe('1,2k')
  expect(fmtSize(3379)).toBe('3,3 KB')

  // Dile bağlı olmayanlar aynı kalır.
  expect(fmtMs(250)).toBe('250 ms')
  expect(fmtMs(83_000)).toBe('1:23')
  setLang('en')
})
