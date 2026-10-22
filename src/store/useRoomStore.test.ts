import { describe, expect, it } from 'vitest'
import { calendarKey } from './useRoomStore'

describe('calendarKey', () => {
  it('takes the key from a Teamup link', () => {
    expect(calendarKey('https://teamup.com/ks1a2b3c4d5e6f7g8h')).toBe('ks1a2b3c4d5e6f7g8h')
    expect(calendarKey('  https://teamup.com/ks1a2b3c4d5e6f7g8h/events?view=d ')).toBe('ks1a2b3c4d5e6f7g8h')
    expect(calendarKey('teamup.com/KS1A2B')).toBe('KS1A2B')
  })

  it('keeps a bare key as it is, trimmed', () => {
    expect(calendarKey(' ks1a2b3c4d5e6f7g8h ')).toBe('ks1a2b3c4d5e6f7g8h')
    expect(calendarKey('')).toBe('')
  })
})
