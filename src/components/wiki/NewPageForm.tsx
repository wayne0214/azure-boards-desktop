import { X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { errorMessage, type Iteration } from '@/lib/types'
import { draftReleaseNotes, draftSprintReview, sprintsOf } from '@/lib/wiki/drafting'
import { flattenPages, pageTitle } from '@/lib/wiki/pages'
import { datedName, decisionPage, feedbackPage, isoDay, meetingNotes, nextDecisionNumber, TEMPLATES, type TemplateId } from '@/lib/wiki/templates'
import { useAppStore } from '@/store/useAppStore'
import { useUiStore } from '@/store/useUiStore'
import { useWikiStore } from '@/store/useWikiStore'

const DATED = /^\d{4}-\d{2}-\d{2}\s+/

/**
 * A new page: blank or from a template. Templates go in their own part of the wiki unless the page
 * is added under another one. Nothing is written until the page is saved.
 */
export function NewPageForm({ parent, onDone }: { parent: string | null; onDone: () => void }) {
  const org = useAppStore((s) => s.activeOrg) ?? ''
  const team = useAppStore((s) => s.selectedTeam?.name ?? null)
  const me = useAppStore((s) => s.account()?.userName ?? null)
  const project = useWikiStore((s) => s.project)
  const tree = useWikiStore((s) => s.tree)
  const toast = useUiStore((s) => s.toast)
  const paths = useMemo(() => flattenPages(tree), [tree])
  const [tpl, setTpl] = useState<TemplateId>('blank')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [sprints, setSprints] = useState<Iteration[] | null>(null)
  const [sprintId, setSprintId] = useState('')
  const [since, setSince] = useState(() => isoDay(new Date(Date.now() - 14 * 86400000)))
  const t = TEMPLATES.find((x) => x.id === tpl)!
  const where = parent ?? t.parent ?? '/'
  const sprint = sprints?.find((s) => s.id === sprintId) ?? null

  useEffect(() => {
    if (tpl !== 'sprint' || sprints || !project) return
    if (!team) { setSprints([]); return }
    sprintsOf(org, project, team).then(({ sprints: list, current }) => { setSprints(list); setSprintId(current?.id ?? list[0]?.id ?? '') }).catch(() => setSprints([]))
  }, [tpl, sprints, project, team, org])
  useEffect(() => { if (tpl === 'sprint' && sprint) setName(`${sprint.name}`) }, [tpl, sprint])

  const pick = (id: TemplateId) => {
    setTpl(id)
    setName(id === 'meeting' || id === 'feedback' ? `${isoDay()} ` : id === 'decision' ? `${nextDecisionNumber(paths)} ` : '')
  }

  const submit = async () => {
    const n = name.trim()
    if (!n || busy || !project) return
    const s = useWikiStore.getState()
    const topic = n.replace(DATED, '') || n
    setBusy(true)
    try {
      let ok = false
      switch (tpl) {
        case 'blank': ok = await s.createPage(where, n); break
        case 'meeting':
          ok = parent === null ? await s.startMeeting(topic, { date: DATED.test(n) ? n.slice(0, 10) : isoDay() }) : await s.createPage(where, n, meetingNotes({ title: topic, date: isoDay() }))
          break
        case 'decision': ok = await s.createPage(where, n, decisionPage(n, isoDay(), me)); break
        case 'feedback': ok = await s.createPage(where, DATED.test(n) ? n : datedName(n), feedbackPage(topic, isoDay())); break
        case 'sprint':
          if (!sprint) { toast({ kind: 'error', title: 'Pick a sprint', detail: team ? undefined : 'Sprints belong to a team: pick one in the sidebar.' }); return }
          ok = await s.createPage(where, n, await draftSprintReview(org, project, team, sprint))
          break
        case 'release': ok = await s.createPage(where, n, await draftReleaseNotes(org, project, n, since)); break
      }
      if (ok) onDone()
    } catch (e) {
      toast({ kind: 'error', title: 'Could not draft the page', detail: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wiki-new" onKeyDown={(e) => { if (e.key === 'Escape') onDone() }}>
      <div className="wiki-new-h">
        <span className="faint">New page {where === '/' ? 'at the top' : <>under <b>{pageTitle(where)}</b></>}</span>
        <span className="grow" />
        <button type="button" className="icon-btn sm" title="Cancel" onClick={onDone}><X size={14} /></button>
      </div>
      <select className="input" value={tpl} onChange={(e) => pick(e.target.value as TemplateId)} aria-label="Template">
        {TEMPLATES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
      </select>
      {t.hint && <div className="faint wiki-new-hint">{t.hint}</div>}
      {tpl === 'sprint' && (
        sprints === null ? <div className="faint"><span className="spinner" /> Loading sprints…</div>
          : sprints.length === 0 ? <div className="faint">No sprints found{team ? '' : ': pick a team in the sidebar'}.</div>
            : <select className="input" value={sprintId} onChange={(e) => setSprintId(e.target.value)} aria-label="Sprint">{sprints.map((x) => <option key={x.id} value={x.id}>{x.name}{x.attributes?.timeFrame === 'current' ? ' (current)' : ''}</option>)}</select>
      )}
      {tpl === 'release' && (
        <label className="wiki-new-row"><span className="faint">Merged since</span><input className="input" type="date" value={since} onChange={(e) => setSince(e.target.value)} /></label>
      )}
      <div className="form-inline">
        <input
          className="input" autoFocus value={name}
          placeholder={tpl === 'release' ? 'Version, e.g. 1.4.0' : tpl === 'meeting' ? 'Date and topic' : 'Page name'}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
        />
        <button type="button" className="btn sm primary" disabled={!name.trim() || busy} onClick={() => void submit()}>{busy ? <span className="spinner" /> : tpl === 'sprint' || tpl === 'release' ? 'Draft' : 'Add'}</button>
      </div>
    </div>
  )
}
