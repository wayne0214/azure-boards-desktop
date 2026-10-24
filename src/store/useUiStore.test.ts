import { beforeEach, describe, expect, it } from 'vitest'
import { opensInMini, useUiStore } from './useUiStore'

const image = new File(['x'], 'shot.png', { type: 'image/png' })

describe('opensInMini', () => {
  it('keeps mini mode only for a bug from a screenshot', () => {
    expect(opensInMini('new-item', { type: 'Bug', images: [image] })).toBe(true)
    expect(opensInMini('new-item', { type: 'Bug' })).toBe(false)
    expect(opensInMini('new-item')).toBe(false)
    expect(opensInMini('settings', { images: [image] })).toBe(false)
  })
})

describe('openSheet in mini mode', () => {
  beforeEach(() => useUiStore.setState({ mini: true, sheet: null, sheetPayload: null }))

  it('opens a screenshot bug over the small window', () => {
    useUiStore.getState().openSheet('new-item', { type: 'Bug', images: [image] })
    expect(useUiStore.getState().mini).toBe(true)
    expect(useUiStore.getState().sheet).toBe('new-item')
  })

  it('goes back to the full window for any other form', () => {
    useUiStore.getState().openSheet('settings')
    expect(useUiStore.getState().mini).toBe(false)
    expect(useUiStore.getState().sheet).toBe('settings')
  })
})
