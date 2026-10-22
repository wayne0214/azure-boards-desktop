import { describe, expect, it } from 'vitest'
import { duplicateSdv, nextSdvId, sdvAfterCreate, sdvClash } from './sdv'

describe('sdv', () => {
  it('starts at SDV-0001', () => expect(nextSdvId([])).toBe('SDV-0001'))
  it('uses highest + 1 and ignores junk', () => expect(nextSdvId(['SDV-0009', 'SDV-0012', 'junk'])).toBe('SDV-0013'))
  it('grows past four digits', () => expect(nextSdvId(['SDV-9999'])).toBe('SDV-10000'))
  it('detects duplicates case-insensitively', () => {
    expect(duplicateSdv(['SDV-0013'], 'sdv-0013')).toBe(true)
    expect(duplicateSdv(['SDV-0013'], 'SDV-0014')).toBe(false)
  })
})

describe('sdvClash', () => {
  const others = [{ id: 4821, sdv: 'SDV-0013' }, { id: 4822, sdv: 'SDV-0002' }]
  it('names the test case that already uses the id and the next free one', () => {
    expect(sdvClash(others, 'sdv-0013')).toEqual({ id: 4821, next: 'SDV-0014' })
  })
  it('is null for a free id or an empty value', () => {
    expect(sdvClash(others, 'SDV-0099')).toBeNull()
    expect(sdvClash(others, '  ')).toBeNull()
  })
})

describe('sdvAfterCreate', () => {
  it('moves a new test case on when someone else took the same SDV ID first', () => {
    const all = [{ id: 10, sdv: 'SDV-0013' }, { id: 12, sdv: 'SDV-0013' }, { id: 11, sdv: 'SDV-0014' }]
    expect(sdvAfterCreate(all, 12)).toBe('SDV-0015')
  })
  it('leaves it alone when it was first or alone', () => {
    expect(sdvAfterCreate([{ id: 10, sdv: 'SDV-0013' }, { id: 12, sdv: 'SDV-0013' }], 10)).toBeNull()
    expect(sdvAfterCreate([{ id: 12, sdv: 'SDV-0013' }], 12)).toBeNull()
  })
})
