import { describe, expect, it } from 'vitest'
import { calendarKey, clock, hhmm } from './useRoomStore'

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

describe('clock', () => {
  it('shows times in 12-hour format with am/pm', () => {
    expect(clock(9 * 60)).toBe('9:00am')
    expect(clock(10 * 60 + 30)).toBe('10:30am')
    expect(clock(12 * 60)).toBe('12:00pm')
    expect(clock(13 * 60 + 15)).toBe('1:15pm')
    expect(clock(0)).toBe('12:00am')
    expect(clock(23 * 60 + 45)).toBe('11:45pm')
  })

  it('leaves the API time in 24-hour format', () => {
    expect(hhmm(13 * 60 + 15)).toBe('13:15')
  })
})
