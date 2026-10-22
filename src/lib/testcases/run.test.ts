import { describe, expect, it } from 'vitest'
import { canPass, commentToRun, expectedChecklist, runToComment, type RunRecord } from './run'

const run: RunRecord = {
  outcome: 'fail', release: 'v2.1.0 RC1', date: '2026-10-21', by: 'Mei Ling',
  criteria: [{ text: 'Retake button shown on failure', met: true }, { text: 'Previous photo is discarded <old>', met: false }],
  steps: [{ index: 1, outcome: 'pass' }, { index: 3, outcome: 'fail' }],
  note: 'Old photo stayed in the gallery.\nSeen twice.',
  images: [{ url: 'https://dev.azure.com/o/_apis/wit/attachments/a1?fileName=one.png', caption: 'one.png' }, { url: 'https://dev.azure.com/o/_apis/wit/attachments/a2?fileName=two.png', caption: 'two.png' }],
}

describe('run comments', () => {
  it('start with the outcome line', () => {
    expect(runToComment(run)).toMatch(/^<p><b>Test run<\/b> · FAIL · Release v2\.1\.0 RC1 · 2026-10-21 · Mei Ling<\/p>/)
  })
  it('read back into the same record', () => {
    expect(commentToRun(runToComment(run))).toEqual(run)
  })
  it('read back a passing run with no extras', () => {
    const r: RunRecord = { ...run, outcome: 'pass', criteria: [{ text: 'Shown', met: true }], steps: [], note: '', images: [] }
    expect(commentToRun(runToComment(r))).toEqual(r)
  })
  it('survive Azure DevOps upper-casing tags and adding attributes', () => {
    const html = runToComment(run).replace(/<(\/?)(p|b|ul|li|img|br)\b/gi, (_m, s, t) => `<${s}${t.toUpperCase()}`).replace(/<P>/g, '<P style="margin:0">')
    expect(commentToRun(html)).toEqual(run)
  })
  it('survive being wrapped in another paragraph', () => {
    expect(commentToRun(`<p>${runToComment(run)}</p>`)).toEqual(run)
  })
  it('ignore ordinary comments', () => {
    expect(commentToRun('<p>Looks good to me</p>')).toBeNull()
  })
})

describe('canPass', () => {
  it('needs at least one criterion, all met', () => {
    expect(canPass([])).toBe(false)
    expect(canPass([{ met: true }, { met: false }])).toBe(false)
    expect(canPass([{ met: true }])).toBe(true)
  })
})

describe('expectedChecklist', () => {
  it('lists each expected result with its step number', () => {
    expect(expectedChecklist([{ expected: '<P>Form shown</P>' }, { expected: '' }, { expected: '<P>Saved &amp; closed</P>' }])).toEqual([{ n: 1, text: 'Form shown' }, { n: 3, text: 'Saved & closed' }])
  })
})
