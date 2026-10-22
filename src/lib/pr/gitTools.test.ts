import { describe, expect, it } from 'vitest'
import { cleanToolLine, parsePrText } from './gitTools'

const sample = `## Title: feat(workflow): refactor assessment and imaging flow into shared libs

## Change Overview
### Overview
This PR reorganizes the appointment workflow.

### Scope
- Appointment detail workflow moved.

## Technical Details
### Design Decisions
- Shared libraries were chosen over cross-app re-exports.

Labels: feature
Priority: P1
Size: XL
Estimate: 10
`

describe('parsePrText', () => {
  it('reads a "## Title:" line as the title and the rest as the description', () => {
    const g = parsePrText(sample)
    expect(g.title).toBe('feat(workflow): refactor assessment and imaging flow into shared libs')
    expect(g.description.startsWith('## Change Overview\n### Overview')).toBe(true)
    expect(g.description.endsWith('- Shared libraries were chosen over cross-app re-exports.')).toBe(true)
  })

  it('leaves out the trailing Labels / Priority / Size / Estimate lines', () => {
    const g = parsePrText(sample)
    expect(g.description).not.toMatch(/Labels:|Priority:|Size:|Estimate:/)
  })

  it('keeps a description line that only looks like metadata when it is not at the end', () => {
    const g = parsePrText('Title: x\n\nPriority: data loss first, then speed.\n\nMore text.')
    expect(g.description).toBe('Priority: data loss first, then speed.\n\nMore text.')
  })

  it('accepts the title line in other common spellings', () => {
    expect(parsePrText('Title: Fix upload\nBody').title).toBe('Fix upload')
    expect(parsePrText('**Title:** `Fix upload`\nBody').title).toBe('Fix upload')
    expect(parsePrText('# title: Fix upload\r\nBody\r\n').description).toBe('Body')
  })

  it('does not take the next line as the title when "Title:" stands alone', () => {
    expect(parsePrText('Title:\nFix upload resume\n\nDescription:\nUploads now resume.')).toMatchObject({ title: 'Fix upload resume', description: 'Uploads now resume.' })
  })

  it('still reads the Title / Description section format', () => {
    const g = parsePrText('## Title\nFix upload resume\n\n## Description\nUploads now resume.')
    expect(g).toMatchObject({ title: 'Fix upload resume', description: 'Uploads now resume.' })
  })

  it('falls back to the first line as the title', () => {
    expect(parsePrText('Fix upload resume\nUploads now resume.')).toMatchObject({ title: 'Fix upload resume', description: 'Uploads now resume.' })
  })

  it('keeps the raw text', () => {
    expect(parsePrText(sample).raw).toBe(sample)
  })
})

describe('cleanToolLine', () => {
  it('removes terminal colour codes', () => {
    expect(cleanToolLine('\x1b[1m\x1b[32mDone\x1b[0m')).toBe('Done')
  })
  it('keeps what a spinner finally drew over itself', () => {
    expect(cleanToolLine('⠋ Asking\r⠙ Asking\r✔ Asked')).toBe('✔ Asked')
    expect(cleanToolLine('Reading diff\r')).toBe('Reading diff')
  })
  it('drops cursor movement and line clearing', () => {
    expect(cleanToolLine('\x1b[2K\x1b[1GWorking')).toBe('Working')
  })
})
