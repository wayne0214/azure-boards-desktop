// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { wordTables } from './docExport'

const doc = (html: string) => {
  const el = document.createElement('div')
  el.innerHTML = html
  wordTables(el)
  return el
}

describe('wordTables', () => {
  it('moves the heading row into the body so Word does not repeat it', () => {
    const el = doc('<table class="srs-table"><thead><tr><th>SDV ID</th><th>Steps</th></tr></thead><tbody><tr><td class="c-id">SDV-1</td><td>Open</td></tr></tbody></table>')
    expect(el.querySelector('thead')).toBeNull()
    expect(el.querySelector('th')).toBeNull()
    const rows = el.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toBe('SDV IDSteps')
    expect((rows[0].firstElementChild as HTMLElement).style.fontWeight).toBe('bold')
  })

  it('gives every cell Times New Roman 12pt and a solid border', () => {
    const el = doc('<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>')
    const table = el.querySelector('table')!
    expect(table.style.fontFamily).toContain('Times New Roman')
    expect(table.style.borderCollapse).toBe('collapse')
    for (const td of Array.from(el.querySelectorAll('td'))) {
      expect(td.style.fontSize).toBe('12pt')
      expect(td.style.fontFamily).toContain('Times New Roman')
      expect(td.style.borderStyle).toBe('solid')
      expect(td.style.borderWidth).toBe('1px')
    }
  })

  it('drops fonts the rich text brought along', () => {
    const el = doc('<table><tbody><tr><td><span style="font-family: Segoe UI; font-size: 10pt; font-weight: bold">x</span></td></tr></tbody></table>')
    const span = el.querySelector('span')!
    expect(span.style.fontFamily).toBe('')
    expect(span.style.fontSize).toBe('')
    expect(span.style.fontWeight).toBe('bold')
  })
})
