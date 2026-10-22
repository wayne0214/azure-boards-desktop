import { describe, expect, it } from 'vitest'
import { findSiteRow } from '@/store/useTimesheetStore'
import { opScript, saveRowBody } from './agent'

const LONG_A = 'PRJ-2026-014 Contoso Mobile App – Phase 2 Development and Integration'
const LONG_B = 'PRJ-2026-014 Contoso Mobile App – Phase 2 Maintenance and Support'

describe('findSiteRow', () => {
  it('tells apart long names that share their first 40 characters', () => {
    const rows = [{ project: LONG_A }, { project: LONG_B }]
    expect(findSiteRow(rows, LONG_B)).toBe(rows[1])
    expect(findSiteRow(rows, LONG_A)).toBe(rows[0])
  })

  it('finds a name the grid cut short, only when it fits one row', () => {
    const cut = { project: 'PRJ-2026-014 Contoso Mobile App – Phase 2 Main…' }
    expect(findSiteRow([{ project: 'Internal' }, cut], LONG_B)).toBe(cut)
    expect(findSiteRow([{ project: 'PRJ-2026-014 Contoso Mobile App…' }, { project: 'PRJ-2026-014 Contoso Mobile App –…' }], LONG_B)).toBeNull()
  })

  it('ignores case and spacing', () => {
    expect(findSiteRow([{ project: 'internal  tools' }], 'Internal Tools')).toEqual({ project: 'internal  tools' })
  })
})

describe('saveRowBody', () => {
  it('produces a script the page can parse, quotes and all', () => {
    const script = opScript('op1', saveRowBody(`${LONG_A} "quoted" 'x' \\ \``, [0, 8, 8, 8, 8, 8, 0], 'Line 1\nLine 2'))
    expect(() => new Function(script)).not.toThrow()
  })
})
