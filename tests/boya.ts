// Çizilen ağacı hücre düzenine yakın bir düz metne çevirir. Terminalin yaptığı
// yerleşimin kabasıdır: satır kutuları, sabit genişlik, esneyen kutu, kenar
// boşluğu, kırpma ve sarma. Testler bununla satırların panele sığdığına bakar.

export type Node = string | { type: string; props?: Record<string, unknown>; children?: Node[] }

type Tag = Exclude<Node, string>

const num = (value: unknown): number => (typeof value === 'number' ? value : 0)

const kids = (node: Tag): Node[] =>
  (node.children ?? []).filter(child => typeof child === 'string' || (typeof child === 'object' && child !== null))

const cut = (text: string, width: number): string =>
  text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text

export function textOf(node: Node): string {
  if (typeof node === 'string') {
    return node
  }

  if (node.type === 'Link') {
    return String(node.props?.label ?? node.props?.href ?? '')
  }

  return kids(node).map(textOf).join('')
}

/** Ağaçtaki bütün öğeler, kökten yapraklara. */
export function walk(node: Node): Tag[] {
  return typeof node === 'string' ? [] : [node, ...kids(node).flatMap(walk)]
}

function wrap(text: string, width: number): string[] {
  const room = Math.max(1, width)
  const lines: string[] = []
  let line = ''

  for (const word of text.split(' ')) {
    let rest = word

    while (rest.length > room) {
      if (line !== '') {
        lines.push(line)
        line = ''
      }

      lines.push(rest.slice(0, room))
      rest = rest.slice(room)
    }

    if (line === '') {
      line = rest
    } else if (line.length + 1 + rest.length <= room) {
      line = `${line} ${rest}`
    } else {
      lines.push(line)
      line = rest
    }
  }

  return [...lines, line]
}

/** Bir öğenin satır içinde kendiliğinden tuttuğu genişlik (kenar boşlukları dahil). */
function natural(node: Node): number {
  if (typeof node === 'string') {
    return node.length
  }

  const props = node.props ?? {}

  if (node.type === 'Text' || node.type === 'Link') {
    return textOf(node).length
  }

  if (node.type !== 'Box') {
    return 0
  }

  const margin = num(props.marginLeft) + num(props.marginRight)

  if (typeof props.width === 'number') {
    return props.width + margin
  }

  const frame = typeof props.borderStyle === 'string' ? 2 + 2 * num(props.paddingX) : 0
  const sizes = kids(node).map(natural)
  const inner = props.flexDirection === 'column' ? Math.max(0, ...sizes) : sizes.reduce((sum, size) => sum + size, 0)

  return Math.max(inner + frame, num(props.minWidth)) + margin
}

function row(children: Node[], width: number, justify: unknown, cap: number): string[] {
  const slots = children.map(child => {
    const props = typeof child === 'string' ? {} : (child.props ?? {})
    const isBox = typeof child !== 'string' && child.type === 'Box'
    const left = isBox ? num(props.marginLeft) : 0
    const right = isBox ? num(props.marginRight) : 0

    return {
      child,
      left,
      right,
      size: natural(child) - left - right,
      grow: isBox ? num(props.flexGrow) : 0,
      isRigid: isBox && (props.flexShrink === 0 || typeof props.width === 'number'),
    }
  })
  let free = width - slots.reduce((sum, slot) => sum + slot.size + slot.left + slot.right, 0)
  const growers = slots.filter(slot => slot.grow > 0)

  if (free > 0 && growers.length > 0) {
    growers.forEach((slot, at) => {
      slot.size += Math.floor(free / growers.length) + (at < free % growers.length ? 1 : 0)
    })
    free = 0
  }

  // Taşma: önce esneyen kutular, sonra küçülebilen öbürleri daralır.
  for (const slot of [...growers, ...slots.filter(slot => slot.grow === 0 && !slot.isRigid).reverse()]) {
    if (free >= 0) {
      break
    }

    const taken = Math.min(slot.size, -free)

    slot.size -= taken
    free += taken
  }

  const line = slots
    .map(slot => {
      const text = (paint(slot.child, slot.size, cap)[0] ?? '').slice(0, slot.size)

      return `${' '.repeat(slot.left)}${text.padEnd(slot.size)}${' '.repeat(slot.right)}`
    })
    .join('')

  return [(free > 0 && justify === 'flex-end' ? ' '.repeat(free) + line : line).trimEnd()]
}

/**
 * `cap` sıfırsa kod satırları genişliğe kırpılır (terminal); verilmişse o
 * kadar karakterde sarılır (masaüstü kod kartı).
 */
export function paint(node: Node, width: number, cap = 0): string[] {
  if (typeof node === 'string') {
    return [node]
  }

  const props = node.props ?? {}

  if (node.type === 'Code') {
    const first = typeof props.startLine === 'number' ? props.startLine : undefined
    const lines = String(props.source)
      .split('\n')
      .map((line, at) => (first === undefined ? line : `${String(first + at).padStart(4)} ${line}`))

    return cap > 0
      ? lines.flatMap(line => line.match(new RegExp(`.{1,${cap}}`, 'g')) ?? [''])
      : lines.map(line => cut(line, width))
  }

  if (node.type === 'Svg') {
    return ['┄'.repeat(Math.max(0, width))]
  }

  if (node.type === 'Text' || node.type === 'Link') {
    const text = textOf(node)

    return props.wrap === undefined || props.wrap === 'wrap' ? wrap(text, width) : [cut(text, width)]
  }

  if (node.type !== 'Box') {
    return kids(node).flatMap(child => paint(child, width, cap))
  }

  const isFramed = typeof props.borderStyle === 'string'
  const outer = Math.max(0, typeof props.width === 'number' ? props.width : width)
  const gutter = num(props.paddingX)
  const inner = isFramed ? outer - 2 - 2 * gutter : outer
  let lines =
    props.flexDirection === 'column'
      ? kids(node).flatMap(child => paint(child, inner, cap))
      : row(kids(node), inner, props.justifyContent, cap)

  if (typeof props.height === 'number' && props.overflow === 'hidden') {
    lines = props.justifyContent === 'flex-end' ? lines.slice(-props.height) : lines.slice(0, props.height)
  }

  if (isFramed) {
    const side = ' '.repeat(gutter)

    lines = [
      `╭${'─'.repeat(outer - 2)}╮`,
      ...lines.map(line => `│${side}${line.padEnd(inner)}${side}│`),
      `╰${'─'.repeat(outer - 2)}╯`,
    ]
  }

  return lines
}
