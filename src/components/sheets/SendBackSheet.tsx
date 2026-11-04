import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { restoreImageSources } from '@/lib/attachments'
import { identityKey } from '@/lib/format'
import { fixerReason, hasRichContent } from '@/lib/sendBack'
import type { SendBackPlan } from '@/lib/types'
import { HtmlEditor } from '@/components/inspector/RichText'
import { Sheet } from '@/components/ui/Sheet'
import { useAppStore } from '@/store/useAppStore'
import { projectOf, useBoardStore } from '@/store/useBoardStore'
import { peopleFor, useMyWorkStore } from '@/store/useMyWorkStore'
import { useUiStore } from '@/store/useUiStore'

const message = (e: unknown) => String((e as { message?: string })?.message ?? e)

/**
 * Testing found the problem again: send the item back to whoever fixed it, in its first state (Proposed),
 * with a comment saying what is still wrong.
 */
export function SendBackSheet() {
  const closeSheet = useUiStore((s) => s.closeSheet)
  const toast = useUiStore((s) => s.toast)
  const payload = useUiStore((s) => s.sheetPayload) as { id: number } | null
  const item = useBoardStore((s) => (payload ? s.getItem(payload.id) : null))
  const org = useAppStore((s) => s.activeOrg) ?? ''
  const selectedProject = useAppStore((s) => s.selectedProject?.name)
  const boardMembers = useBoardStore((s) => s.ctx?.members)
  const members = useMyWorkStore((s) => s.members)
  const loadMembers = useMyWorkStore((s) => s.loadMembers)
  const project = item ? projectOf(item) : ''
  const people = peopleFor(project, selectedProject, boardMembers, members)

  const [plan, setPlan] = useState<SendBackPlan | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const [assignTo, setAssignTo] = useState('')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const id = item?.id

  useEffect(() => {
    if (project && project !== selectedProject) void loadMembers(project)
  }, [project, selectedProject, loadMembers])

  useEffect(() => {
    if (!id || !org || !project) return
    let live = true
    setPlan(null)
    setPlanError(null)
    api().sendBackPlan(org, project, id).then((p) => {
      if (!live) return
      setPlan(p)
      if (p.fixer) setAssignTo((cur) => cur || p.fixer!.uniqueName || p.fixer!.displayName)
    }).catch((e) => live && setPlanError(message(e)))
    return () => { live = false }
  }, [id, org, project])

  if (!item) return null

  const fixer = plan?.fixer ?? null
  const fixerKey = fixer ? fixer.uniqueName || fixer.displayName : ''
  // The found person first, then the project's people; keep the found one even if they are not in the list.
  const options = [
    ...(fixer ? [{ value: fixerKey, label: `${fixer.displayName} (${fixerReason(fixer)})` }] : []),
    ...people.filter((p) => identityKey(p) !== fixerKey && p.displayName !== fixer?.displayName).map((p) => ({ value: identityKey(p), label: p.displayName })),
  ]
  const state = plan?.state ?? ''
  const ready = !!plan && !!assignTo && !!state && hasRichContent(comment)

  const submit = async () => {
    if (busy || !ready) return
    setBusy(true)
    try {
      const updated = await api().sendBack(org, project, item.id, item.rev, assignTo, state, restoreImageSources(comment))
      useBoardStore.getState().upsert(updated)
      // My Work lists it under Assigned to others now, not Ready to test.
      void useMyWorkStore.getState().load({ silent: true })
      window.dispatchEvent(new CustomEvent('app:item-updated', { detail: updated }))
      const who = (updated.fields['System.AssignedTo'] as { displayName?: string } | undefined)?.displayName ?? assignTo
      closeSheet()
      toast({ kind: 'success', title: `Sent #${item.id} back to ${who}`, detail: `State is ${state}.` })
    } catch (e) {
      toast({ kind: 'error', title: `Could not send #${item.id} back`, detail: message(e) })
      setBusy(false)
    }
  }

  return (
    <Sheet title={`Send back #${item.id}`} onClose={closeSheet}
      footer={<><span className="grow" /><button type="button" className="btn" onClick={closeSheet}>Cancel</button><button type="button" className="btn primary" disabled={busy || !ready} onClick={() => void submit()}>{busy ? 'Sending…' : 'Send back'}</button></>}>
      <div className="form-row"><label>Item</label><div className="send-back-title">{String(item.fields['System.Title'] ?? '')}</div></div>
      <div className="form-row"><label htmlFor="sb-who">Assign to</label>
        <div>
          <select id="sb-who" className="input" style={{ width: 360 }} value={assignTo} disabled={!plan} onChange={(e) => setAssignTo(e.target.value)}>
            {!plan && <option value="">{planError ? 'Could not find who fixed it' : 'Finding who fixed it…'}</option>}
            {plan && !fixer && <option value="">Choose who fixed it</option>}
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {planError && <div className="start-work-error">{planError}</div>}
          {plan && !fixer && <div className="faint send-back-hint">No pull request, activation or earlier assignee points to anyone; choose who should look again.</div>}
        </div></div>
      <div className="form-row"><label>State</label><div>{state || '—'}</div></div>
      <div className="form-row"><label>What's wrong<span className="send-back-req" title="Required">*</span></label>
        <HtmlEditor value={comment} onChange={setComment} project={project} minHeight={140}
          placeholder="What did you see when you tested it? You can paste screenshots." />
      </div>
    </Sheet>
  )
}
