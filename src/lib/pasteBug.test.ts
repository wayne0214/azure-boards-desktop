import { afterEach, describe, expect, it, vi } from 'vitest'
import { listenForPastedImages } from './pasteBug'

const paste = (target: Element, files: File[]) => {
  const e = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'clipboardData', { value: { files } })
  target.dispatchEvent(e)
  return e
}
const shot = () => new File(['x'], 'image.png', { type: 'image/png' })

describe('listenForPastedImages', () => {
  let stop = () => {}
  afterEach(() => { stop(); document.body.innerHTML = '' })

  it('opens a bug with a screenshot pasted outside any field', () => {
    const open = vi.fn()
    stop = listenForPastedImages(open, () => true)
    const e = paste(document.body, [shot()])
    expect(open).toHaveBeenCalledWith([expect.objectContaining({ type: 'image/png' })])
    expect(e.defaultPrevented).toBe(true)
  })

  it('leaves pastes into fields, text-only pastes and pastes over an open sheet alone', () => {
    const open = vi.fn()
    let free = true
    stop = listenForPastedImages(open, () => free)
    document.body.innerHTML = '<input><div contenteditable="true"><p>x</p></div>'
    paste(document.querySelector('input')!, [shot()])
    paste(document.querySelector('p')!, [shot()])
    paste(document.body, [new File(['x'], 'a.txt', { type: 'text/plain' })])
    free = false
    paste(document.body, [shot()])
    expect(open).not.toHaveBeenCalled()
  })

  it('asks WebKit to enable Paste outside fields', () => {
    stop = listenForPastedImages(vi.fn(), () => true)
    const e = new Event('beforepaste', { bubbles: true, cancelable: true })
    document.body.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
  })
})
