import { describe, expect, it } from 'vitest'
import {
  duplicateStep, insertStep, replaceWithShared, moveStep, parseSteps, pasteSteps, plain, removeStep, serializeSteps, stepsFromPaste, stepsToText, textToSteps,
  type StepItem,
} from './steps'

const SAMPLE =
  '<steps id="0" last="4"><step id="2" type="ValidateStep"><parameterizedString isformatted="true">&lt;P&gt;Open &lt;B&gt;settings&lt;/B&gt;&lt;/P&gt;</parameterizedString><parameterizedString isformatted="true">&lt;P&gt;Settings page opens&lt;/P&gt;</parameterizedString><description/></step><step id="3" type="ActionStep"><parameterizedString isformatted="true">&lt;P&gt;Enter @rate&lt;/P&gt;</parameterizedString><parameterizedString isformatted="true"></parameterizedString><description/></step><compref id="4" ref="4711"/></steps>'

describe('parseSteps', () => {
  it('reads steps and shared references', () => {
    const items = parseSteps(SAMPLE)
    expect(items).toEqual([
      { kind: 'step', id: 2, action: '<P>Open <B>settings</B></P>', expected: '<P>Settings page opens</P>' },
      { kind: 'step', id: 3, action: '<P>Enter @rate</P>', expected: '' },
      { kind: 'shared', id: 4, ref: 4711 },
    ])
  })

  it('returns an empty list for missing or empty xml', () => {
    expect(parseSteps(undefined)).toEqual([])
    expect(parseSteps('')).toEqual([])
  })

  it('keeps unknown elements as raw', () => {
    const items = parseSteps('<steps id="0" last="5"><foo id="5" x="1"/></steps>')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'raw', id: 5 })
    expect((items[0] as { xml: string }).xml).toContain('<foo')
  })
})

describe('serializeSteps', () => {
  it('round trips', () => {
    const items = parseSteps(SAMPLE)
    expect(parseSteps(serializeSteps(items, SAMPLE))).toEqual(items)
  })

  it('keeps ids, description and the shared ref when editing one step', () => {
    const items = parseSteps(SAMPLE)
    const edited = items.map((it, i) => (i === 1 && it.kind === 'step' ? { ...it, action: '<P>Enter rate</P>' } : it))
    const xml = serializeSteps(edited, SAMPLE)
    const back = parseSteps(xml)
    expect(back.map(i => i.id)).toEqual([2, 3, 4])
    expect(back[1]).toMatchObject({ action: '<P>Enter rate</P>' })
    expect(back[2]).toMatchObject({ kind: 'shared', ref: 4711 })
    expect(xml).toContain('<description/>')
  })

  it('keeps a populated description and extra attributes of an edited step', () => {
    const src = '<steps id="0" last="2"><step id="2" type="ValidateStep" foo="bar"><parameterizedString isformatted="true">&lt;P&gt;A&lt;/P&gt;</parameterizedString><parameterizedString isformatted="true">&lt;P&gt;B&lt;/P&gt;</parameterizedString><description>keep me</description></step></steps>'
    const items = parseSteps(src).map(i => (i.kind === 'step' ? { ...i, action: '<P>A2</P>' } : i))
    const xml = serializeSteps(items, src)
    expect(xml).toContain('foo="bar"')
    expect(xml).toContain('<description>keep me</description>')
    expect(parseSteps(xml)[0]).toMatchObject({ action: '<P>A2</P>' })
  })

  it('keeps an unchanged step element verbatim', () => {
    const xml = serializeSteps(parseSteps(SAMPLE), SAMPLE)
    expect(xml).toContain('<step id="2" type="ValidateStep">')
    expect(xml).toContain('&lt;P&gt;Open &lt;B&gt;settings&lt;/B&gt;&lt;/P&gt;')
  })

  it('numbers new items above last and updates last', () => {
    const items: StepItem[] = [
      ...parseSteps(SAMPLE),
      { kind: 'step', id: null, action: '<P>New</P>', expected: '<P>Ok</P>' },
      { kind: 'step', id: null, action: '<P>Other</P>', expected: '' },
    ]
    const xml = serializeSteps(items, SAMPLE)
    const doc = new DOMParser().parseFromString(xml, 'text/xml')
    expect(doc.documentElement.getAttribute('last')).toBe('6')
    const back = parseSteps(xml)
    expect(back.map(i => i.id)).toEqual([2, 3, 4, 5, 6])
    const steps = Array.from(doc.getElementsByTagName('step'))
    expect(steps[2].getAttribute('type')).toBe('ValidateStep')
    expect(steps[3].getAttribute('type')).toBe('ActionStep')
  })

  it('builds from scratch without previous xml', () => {
    const xml = serializeSteps([{ kind: 'step', id: null, action: '<P>A</P>', expected: '' }])
    expect(parseSteps(xml)).toEqual([{ kind: 'step', id: 1, action: '<P>A</P>', expected: '' }])
  })

  it('keeps raw elements verbatim', () => {
    const src = '<steps id="0" last="5"><foo id="5" x="1"/></steps>'
    const xml = serializeSteps(parseSteps(src), src)
    expect(xml).toContain('<foo id="5" x="1"/>')
  })
})

describe('text mode', () => {
  const shared = new Map([['Login as Clinician', 4711]])

  it('renders items as lines', () => {
    const items = parseSteps(SAMPLE)
    expect(stepsToText(items)).toBe('1. Open settings => Settings page opens\n2. Enter @rate\n3. /#4711')
  })

  it('parses lines into steps and shared references', () => {
    const out = textToSteps('1. Open => Shown\n2. /Login as Clinician\n3. Press OK', [], shared)
    expect(out).toEqual([
      { kind: 'step', id: null, action: '<P>Open</P>', expected: '<P>Shown</P>' },
      { kind: 'shared', id: null, ref: 4711 },
      { kind: 'step', id: null, action: '<P>Press OK</P>', expected: '' },
    ])
  })

  it('keeps unchanged lines, and the id of an edited one', () => {
    const prev = parseSteps(SAMPLE)
    const text = stepsToText(prev).replace('Enter @rate', 'Enter rate')
    const out = textToSteps(text, prev, shared)
    expect(out[0]).toBe(prev[0])
    expect(out[1]).toMatchObject({ id: prev[1].id, action: '<P>Enter rate</P>' })
    expect(out[2]).toBe(prev[2])
  })
})

describe('text round trip', () => {
  const shared = new Map([['Login', 9]])
  const items: StepItem[] = [
    { kind: 'step', id: 2, action: '<P>Open <B>x</B></P>', expected: '<P>Shown</P>' },
    { kind: 'raw', id: 3, xml: '<foo id="3"/>' },
    { kind: 'step', id: 4, action: '<P>one<BR/>two</P>', expected: '' },
    { kind: 'shared', id: 5, ref: 9, title: 'Login' },
    { kind: 'shared', id: 6, ref: 77 },
    { kind: 'step', id: 7, action: '', expected: '' },
    { kind: 'step', id: 8, action: '', expected: '<P>only expected</P>' },
    { kind: 'step', id: 9, action: '<P>2.5 mg dose</P>', expected: '' },
  ]

  it('returns the very same items for unchanged text', () => {
    const out = textToSteps(stepsToText(items), items, shared)
    expect(out).toEqual(items)
    out.forEach((o, i) => expect(o).toBe(items[i]))
  })

  it('keeps later ids when a line is inserted in the middle', () => {
    const lines = stepsToText(items).split('\n')
    lines.splice(1, 0, '9. Brand new')
    const out = textToSteps(lines.join('\n'), items, shared)
    expect(out).toHaveLength(items.length + 1)
    expect(out[1]).toMatchObject({ kind: 'step', id: null })
    expect(out[0]).toBe(items[0])
    items.slice(1).forEach((it, i) => expect(out[i + 2]).toBe(it))
  })

  it('does not turn a deleted raw line into a literal step', () => {
    const lines = stepsToText(items).split('\n').filter(l => !l.includes('(other step)'))
    const out = textToSteps(lines.join('\n'), items, shared)
    expect(out.some(o => o.kind === 'raw')).toBe(false)
    expect(out).toHaveLength(items.length - 1)
  })
})

describe('stepsFromPaste', () => {
  it('keeps decimal and version prefixes', () => {
    expect(stepsFromPaste('2.5 mg dose\tOK')).toEqual([{ action: '2.5 mg dose', expected: 'OK' }])
  })

  it('parses tab separated rows and strips numbering', () => {
    expect(stepsFromPaste('1. Open\tShown\n2) Press\tSaved\n')).toEqual([
      { action: 'Open', expected: 'Shown' },
      { action: 'Press', expected: 'Saved' },
    ])
  })

  it('handles quoted multiline cells', () => {
    const rows = stepsFromPaste('"Line one\nLine two"\tOK\nNext\t')
    expect(rows).toHaveLength(2)
    expect(rows?.[0]).toEqual({ action: 'Line one\nLine two', expected: 'OK' })
    expect(rows?.[1]).toEqual({ action: 'Next', expected: '' })
  })

  it('unescapes doubled quotes', () => {
    expect(stepsFromPaste('"Say ""hi"""\tOK')).toEqual([{ action: 'Say "hi"', expected: 'OK' }])
  })

  it('returns null for a single plain line', () => {
    expect(stepsFromPaste('single line no tab')).toBeNull()
  })
})

describe('plain', () => {
  it('turns block boundaries into newlines and decodes entities', () => {
    expect(plain('<P>a &amp; b</P><P>c&nbsp;&lt;d&gt;</P>')).toBe('a & b\nc <d>')
    expect(plain('x<BR/>y<div>z</div>')).toBe('x\ny\nz')
  })
})

describe('step list edits', () => {
  const a: StepItem = { kind: 'step', id: 2, action: 'A', expected: 'a' }
  const b: StepItem = { kind: 'shared', id: 3, ref: 4711 }
  const c: StepItem = { kind: 'step', id: 4, action: 'C', expected: '' }
  const blank: StepItem = { kind: 'step', id: null, action: '', expected: '' }

  it('inserts a blank step after a position', () => {
    expect(insertStep([a, c], 0)).toEqual([a, blank, c])
    expect(insertStep([], -1)).toEqual([blank])
  })
  it('moves a step up or down and ignores moves past the ends', () => {
    expect(moveStep([a, b, c], 2, -1)).toEqual([a, c, b])
    expect(moveStep([a, b, c], 0, 1)).toEqual([b, a, c])
    expect(moveStep([a, b, c], 0, -1)).toEqual([a, b, c])
  })
  it('duplicates a step as a new one', () => {
    expect(duplicateStep([a, c], 0)).toEqual([a, { ...a, id: null }, c])
  })
  it('removes a step', () => {
    expect(removeStep([a, b, c], 1)).toEqual([a, c])
  })
  it('pastes rows into an empty step or after a filled one', () => {
    const rows = [{ action: 'X', expected: 'x' }, { action: 'Y', expected: '' }]
    const x: StepItem = { kind: 'step', id: null, action: '<P>X</P>', expected: '<P>x</P>' }
    const y: StepItem = { kind: 'step', id: null, action: '<P>Y</P>', expected: '' }
    expect(pasteSteps([a, blank], 1, rows)).toEqual([a, x, y])
    expect(pasteSteps([a, c], 0, rows)).toEqual([a, x, y, c])
  })
})

describe('replaceWithShared', () => {
  const a: StepItem = { kind: 'step', id: 2, action: 'A', expected: '' }
  const b: StepItem = { kind: 'step', id: 3, action: 'B', expected: '' }
  const c: StepItem = { kind: 'step', id: 4, action: 'C', expected: '' }
  it('puts one shared reference where the first chosen step was', () => {
    expect(replaceWithShared([a, b, c], [2, 0], 900, 'Login')).toEqual([{ kind: 'shared', id: null, ref: 900, title: 'Login' }, b])
  })
})

describe('editing a step in text mode', () => {
  const prev: StepItem[] = [
    { kind: 'step', id: 2, action: '<P>Open</P>', expected: '' },
    { kind: 'step', id: 3, action: '<P>Press save</P>', expected: '<P>Saved</P>' },
    { kind: 'step', id: 4, action: '<P>Close</P>', expected: '' },
  ]
  it('keeps the edited step\'s id so its history stays attached', () => {
    const out = textToSteps('1. Open\n2. Press save twice => Saved\n3. Close', prev, new Map())
    expect(out.map((s) => s.id)).toEqual([2, 3, 4])
    expect(out[1]).toMatchObject({ action: '<P>Press save twice</P>' })
  })
  it('gives a genuinely new line a new id', () => {
    const out = textToSteps('1. Open\n2. Press save => Saved\n3. Wait\n4. Close', prev, new Map())
    expect(out.map((s) => s.id)).toEqual([2, 3, null, 4])
  })
})

describe('serializing edits', () => {
  const old = '<steps id="0" last="5"><step id="2" type="ActionStep"><parameterizedString isformatted="false">Open</parameterizedString><parameterizedString/><description/></step><step id="5" type="ActionStep"><parameterizedString isformatted="true">&lt;P&gt;Close&lt;/P&gt;</parameterizedString><parameterizedString/><description/></step></steps>'
  it('marks edited text as formatted, since it is written as HTML', () => {
    const items = parseSteps(old)
    const xml = serializeSteps([{ ...items[0], action: '<P>Open <B>now</B></P>' } as StepItem, items[1]], old)
    expect(xml).toMatch(/<step id="2"[^>]*><parameterizedString isformatted="true">/)
  })
  it('never lowers "last", so the id of a removed step is not reused', () => {
    const items = parseSteps(old)
    expect(serializeSteps([items[0]], old)).toContain('last="5"')
  })
})
