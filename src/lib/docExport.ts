/** Styles for documents saved from the Requirements and Test Cases views, so they read well outside the app. */
export const DOC_EXPORT_CSS = `body{font:14px/1.5 -apple-system,Segoe UI,sans-serif;max-width:960px;margin:32px auto;padding:0 24px;color:#1c1c1e}
h1{font-size:24px}h2{font-size:19px;margin-top:28px}h3{font-size:16px;margin-top:20px}
table{border-collapse:collapse;width:100%;margin:8px 0 16px}th,td{border:1px solid #c5c5cb;padding:6px 8px;vertical-align:top;text-align:left}
th{background:#f0f0f2}td.c-id,td.c-di{white-space:nowrap;font-weight:600}img{max-width:100%}.doc-gap{color:#9a6a12;font-style:italic}.doc-change{color:#9a6a12;font-style:italic;font-size:12px;margin:6px 0 0}`

const WORD_FONT = "font-family:'Times New Roman',Times,serif;font-size:12pt;color:#000"
const WORD_BORDER = 'border:1px solid #000;mso-border-alt:solid windowtext .5pt'

/**
 * Restyle the tables in a detached copy for Word: Times New Roman 12pt, a solid border on every
 * edge, and the heading row as an ordinary first row so Word does not repeat it on each page.
 */
export function wordTables(root: HTMLElement): void {
  for (const table of Array.from(root.querySelectorAll('table'))) {
    // Word turns <thead> (and <th>) into "Repeat Header Rows".
    const head = table.tHead
    if (head) {
      const body = table.tBodies[0] ?? table.appendChild(document.createElement('tbody'))
      body.prepend(...Array.from(head.rows))
      head.remove()
    }
    for (const th of Array.from(table.querySelectorAll('th'))) {
      const td = document.createElement('td')
      for (const a of Array.from(th.attributes)) td.setAttribute(a.name, a.value)
      td.append(...Array.from(th.childNodes))
      td.style.fontWeight = 'bold'
      th.replaceWith(td)
    }
    table.removeAttribute('class')
    table.setAttribute('border', '1')
    table.setAttribute('cellpadding', '5')
    table.style.cssText = `border-collapse:collapse;width:100%;${WORD_BORDER};${WORD_FONT}`
    for (const cell of Array.from(table.querySelectorAll('td'))) {
      const bold = cell.style.fontWeight === 'bold' || cell.classList.contains('c-id') || cell.classList.contains('c-di')
      cell.removeAttribute('class')
      cell.style.cssText = `${WORD_BORDER};padding:4pt 5pt;vertical-align:top;text-align:left;${WORD_FONT}${bold ? ';font-weight:bold' : ''}`
      // Rich text from Azure DevOps carries its own fonts; on screen the app overrides them, in Word nothing would.
      for (const el of Array.from(cell.querySelectorAll<HTMLElement>('[style], font'))) {
        el.style.removeProperty('font-family'); el.style.removeProperty('font-size'); el.style.removeProperty('color'); el.style.removeProperty('background-color')
        el.removeAttribute('face'); el.removeAttribute('size'); el.removeAttribute('color')
      }
    }
  }
}

/** Copy what an element shows (headings, tables, images) as formatted text, with the tables made ready for Word. */
export function copyRichText(el: HTMLElement): boolean {
  const copy = el.cloneNode(true) as HTMLElement
  wordTables(copy)
  // Off screen but laid out, so the selection copies it; the app shell is otherwise not selectable.
  const holder = document.createElement('div')
  holder.style.cssText = `position:fixed;left:-10000px;top:0;width:${el.clientWidth || 900}px;user-select:text;-webkit-user-select:text;background:#fff;color:#000`
  holder.append(...Array.from(copy.childNodes))
  document.body.appendChild(holder)
  const sel = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(holder)
  sel?.removeAllRanges()
  sel?.addRange(range)
  const ok = document.execCommand('copy')
  sel?.removeAllRanges()
  holder.remove()
  return ok
}

/** An HTML page Word opens as a document (saved with a .doc extension). */
export const wordDocument = (title: string, body: string): string =>
  `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${title}</title><style>${DOC_EXPORT_CSS}</style></head><body><h1>${title}</h1>${body}</body></html>`
