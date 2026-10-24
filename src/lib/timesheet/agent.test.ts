import { describe, expect, it } from 'vitest'
import { findSiteRow } from '@/store/useTimesheetStore'
import { opScript, saveRowBody, submitWeekBody } from './agent'

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

describe('submitWeekBody', () => {
  const run = (body: string) => new Promise<{ ok: boolean; data: unknown; error: string | null }>((resolve) => {
    ;(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = { invoke: (_cmd: string, { payload }: { payload: { ok: boolean; data: unknown; error: string | null } }) => resolve(payload) }
    new Function(opScript('op1', body))()
  })
  // Laid out like the site's week page: [status] [project] [sun..sat] [total] [note] [actions].
  const row = (actions: string) => `<div role="row"><div role="gridcell"></div><div role="gridcell">Internal</div>${'<div role="gridcell">8</div>'.repeat(7)}<div role="gridcell">56</div><div role="gridcell">View</div><div role="gridcell">${actions}</div></div>`
  const submitted = row('lock_outline Submitted')

  it('waits for the rows to load, then presses Submit saved and confirms', async () => {
    document.body.innerHTML = '<main><div role="grid"></div></main>'
    const grid = document.querySelector('[role=grid]')!
    setTimeout(() => {
      grid.innerHTML = `<div role="row">Saved <button type="button" class="ts-action ts-action--submit">send Submit saved</button></div>${row('<button>edit</button><button>send</button>')}`
      grid.querySelector('button')!.addEventListener('click', () => {
        const dialog = document.createElement('div')
        dialog.className = 'rz-dialog'
        dialog.setAttribute('role', 'alertdialog')
        dialog.innerHTML = '<button>Ok</button><button>Cancel</button>'
        dialog.querySelector('button')!.addEventListener('click', () => { dialog.remove(); setTimeout(() => { grid.innerHTML = `<div role="row">Submitted</div>${submitted}` }, 500) })
        document.body.appendChild(dialog)
      })
    }, 1500)
    const r = await run(submitWeekBody)
    expect(r.error).toBeNull()
    expect(r.data).toEqual({ submitted: true })
    expect(grid.textContent).toContain('Submitted')
  }, 20000)

  it('reports nothing submitted when every row is already submitted', async () => {
    document.body.innerHTML = `<main><div role="grid">${submitted}</div></main>`
    const r = await run(submitWeekBody)
    expect(r.data).toEqual({ submitted: 0 })
  }, 20000)
})
