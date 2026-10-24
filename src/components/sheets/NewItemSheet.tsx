import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { restoreImageSources, uploadImageHtml } from '@/lib/attachments'
import { identityKey, typeColor } from '@/lib/format'
import { miniBugProject, rememberMiniBugProject } from '@/lib/pasteBug'
import { REPRO_STEPS, customFieldsFor, descriptionField, fieldKind, isIdLike, symptomField, usesReproSteps } from '@/lib/customFields'
import type { Project, TeamContext } from '@/lib/types'
import { CustomFieldInput } from '@/components/ui/CustomFieldInput'
import { HtmlEditor } from '@/components/inspector/RichText'
import { ModulePicker } from '@/components/ui/ModulePicker'
import { Sheet } from '@/components/ui/Sheet'
import { Dropdown } from '@/components/ui/Dropdown'
import { ChevronDown, FolderKanban } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { useBoardStore } from '@/store/useBoardStore'
import { useUiStore } from '@/store/useUiStore'

export function NewItemSheet() {
  const closeSheet = useUiStore((s) => s.closeSheet)
  const payload = useUiStore((s) => s.sheetPayload) as { parentId?: number; type?: string; images?: File[] } | null
  const toast = useUiStore((s) => s.toast)
  const boardCtx = useBoardStore((s) => s.ctx)
  const board = useBoardStore((s) => s.board)
  const org = useAppStore((s) => s.activeOrg)
  const projects = useAppStore((s) => s.projects)
  const selectedProject = useAppStore((s) => s.selectedProject)
  const filters = useBoardStore((s) => s.filters)
  const create = useBoardStore((s) => s.create)
  const select = useBoardStore((s) => s.select)
  const items = useBoardStore((s) => s.items)
  const me = useAppStore((s) => s.account())

  // The project is always visible and can be changed; another project's types and people load here.
  // From mini mode no project is in view, so a screenshot bug starts where the last one went.
  const [fromMini] = useState(() => useUiStore.getState().mini && !!payload?.images?.length)
  const [proj, setProj] = useState<Project | null>(() => (fromMini ? miniBugProject(projects, selectedProject) : selectedProject ?? projects[0] ?? null))
  const sameProject = !!proj && proj.id === selectedProject?.id
  const [otherCtx, setOtherCtx] = useState<{ projectId: string; ctx: TeamContext } | null>(null)
  const [ctxError, setCtxError] = useState<string | null>(null)
  const ctx = sameProject ? boardCtx : otherCtx && otherCtx.projectId === proj?.id ? otherCtx.ctx : null
  const projBtn = useRef<HTMLButtonElement>(null)
  const [projMenu, setProjMenu] = useState(false)

  useEffect(() => {
    if (!org || !proj || sameProject || otherCtx?.projectId === proj.id) return
    let live = true
    setCtxError(null)
    void (async () => {
      try {
        const team = (await api().defaultTeam(org, proj.id).catch(() => null)) ?? (await api().listTeams(org, proj.id))[0]
        if (!team) throw new Error('This project has no team.')
        const c = await api().getTeamContext(org, proj.id, proj.name, team.name)
        if (live) setOtherCtx({ projectId: proj.id, ctx: c })
      } catch (e) {
        if (live) setCtxError(String((e as { message?: string }).message ?? e))
      }
    })()
    return () => { live = false }
  }, [org, proj, sameProject, otherCtx?.projectId])

  const boardTypes = useMemo(() => {
    if (!sameProject) return []
    const set = new Set<string>()
    for (const c of board?.columns ?? []) for (const t of Object.keys(c.stateMappings ?? {})) set.add(t)
    return [...set]
  }, [board, sameProject])
  const allTypes = useMemo(() => (ctx?.workItemTypes ?? []).filter((t) => !t.isDisabled && !/test (case|plan|suite)|shared (steps|parameter)|code review|feedback/i.test(t.name)), [ctx])
  const ordered = useMemo(() => [...allTypes].sort((a, b) => Number(boardTypes.includes(b.name)) - Number(boardTypes.includes(a.name))), [allTypes, boardTypes])

  const [type, setType] = useState(payload?.type ?? boardTypes[0] ?? ordered[0]?.name ?? '')
  const [title, setTitle] = useState('')
  const [who, setWho] = useState('')
  const [iteration, setIteration] = useState(sameProject ? (filters.iterationPath ?? ctx?.settings?.defaultIteration?.path ?? '') : '')
  const [priority, setPriority] = useState('')
  const [points, setPoints] = useState('')
  const [tags, setTags] = useState('')
  const [area, setArea] = useState('')
  const [description, setDescription] = useState('')
  const [symptom, setSymptom] = useState('')
  const [parentId, setParentId] = useState(payload?.parentId ? String(payload.parentId) : '')
  const [custom, setCustom] = useState<Record<string, unknown>>({})
  // Only the type's identifier, its own description, and required fields belong on the create form.
  const wit = allTypes.find((t) => t.name === type)
  const reproType = type === 'Bug' || usesReproSteps(wit)
  const symptomDef = ((d) => (d && (d.referenceName.startsWith('Microsoft.') || fieldKind(ctx, d) === 'html') ? d : undefined))(symptomField(wit))
  const customDefs = useMemo(() => {
    const idDef = customFieldsFor(wit).find(isIdLike)
    const descDef = descriptionField(ctx, wit)
    return [idDef, descDef].filter((d): d is NonNullable<typeof d> => Boolean(d) && d?.referenceName !== symptomDef?.referenceName)
  }, [wit, ctx, symptomDef?.referenceName])
  const hasOwnDescription = customDefs.some((d) => fieldKind(ctx, d) === 'html')
  // Bugs: Azure DevOps shows Repro Steps on the form, not Description.
  const longField = hasOwnDescription ? null : reproType ? REPRO_STEPS : 'System.Description'
  const missingRequired = customDefs.filter((d) => d.alwaysRequired && (custom[d.referenceName] === undefined || custom[d.referenceName] === null || custom[d.referenceName] === ''))
  const [busy, setBusy] = useState(false)
  // A second Enter or click before the first create answers would make a duplicate.
  const submitting = useRef(false)
  const [another, setAnother] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const typeBtn = useRef<HTMLButtonElement>(null)
  const [typeMenu, setTypeMenu] = useState(false)

  useEffect(() => { titleRef.current?.focus() }, [])

  // Images dropped on the app go into the Symptom (or Repro Steps when the type has no Symptom) once the type is known.
  const dropped = useRef<File[]>(payload?.images ?? [])
  const [dropUploading, setDropUploading] = useState(0)
  useEffect(() => {
    if (dropped.current.length === 0 || !org || !proj || !wit) return
    const files = dropped.current
    dropped.current = []
    const put = symptomDef ? setSymptom : setDescription
    setDropUploading(files.length)
    void (async () => {
      for (const file of files) {
        try {
          const html = await uploadImageHtml(org, proj.name, file)
          put((v) => v + html)
        } catch (e) {
          toast({ kind: 'error', title: 'Could not add the image', detail: String((e as { message?: string }).message ?? e) })
        } finally {
          setDropUploading((n) => n - 1)
        }
      }
    })()
  }, [org, proj, wit, symptomDef, toast])
  useEffect(() => { if (!type && ordered[0]) setType(ordered[0].name) }, [ordered, type])
  // A type the chosen project does not have falls back to its first one.
  useEffect(() => { if (type && ordered.length && !ordered.some((t) => t.name === type)) setType(ordered[0].name) }, [ordered, type])

  const pickProject = (id: string) => {
    const p = projects.find((x) => x.id === id)
    if (!p || p.id === proj?.id) return
    setProj(p)
    setCustom({}); setWho(''); setParentId(''); setArea('')
    setIteration(p.id === selectedProject?.id ? (filters.iterationPath ?? boardCtx?.settings?.defaultIteration?.path ?? '') : '')
  }

  const parent = parentId ? items.find((i) => i.id === Number(parentId)) : null
  const pointsField = type === 'User Story' ? 'Microsoft.VSTS.Scheduling.StoryPoints' : ['Product Backlog Item', 'Feature', 'Epic'].includes(type) ? 'Microsoft.VSTS.Scheduling.Effort' : type === 'Task' ? 'Microsoft.VSTS.Scheduling.RemainingWork' : null

  const submit = async (keepOpen: boolean) => {
    const t = title.trim()
    if (!t || !type || submitting.current) return
    submitting.current = true
    setBusy(true)
    const fields: Record<string, unknown> = { 'System.Title': t }
    for (const [k, v] of Object.entries(custom)) if (v !== null && v !== undefined && v !== '') fields[k] = v
    if (who) fields['System.AssignedTo'] = who
    if (area) fields['System.AreaPath'] = area
    if (iteration) fields['System.IterationPath'] = iteration
    if (priority) fields['Microsoft.VSTS.Common.Priority'] = Number(priority)
    if (points && pointsField) fields[pointsField] = Number(points)
    if (tags.trim()) fields['System.Tags'] = tags.split(/[;,]/).map((x) => x.trim()).filter(Boolean).join('; ')
    if (longField && hasContent(description)) fields[longField] = restoreImageSources(description)
    if (symptomDef && hasContent(symptom)) fields[symptomDef.referenceName] = restoreImageSources(symptom)
    let created: Awaited<ReturnType<typeof create>> = null
    if (sameProject) {
      created = await create(type, fields, parentId ? Number(parentId) : null)
    } else if (org && proj) {
      try {
        created = await api().createWorkItem(org, proj.name, type, fields, parentId ? Number(parentId) : null)
      } catch (e) {
        toast({ kind: 'error', title: 'Could not create item', detail: String((e as { message?: string }).message ?? e) })
      }
    }
    setBusy(false)
    submitting.current = false
    if (!created) return
    if (fromMini && proj) rememberMiniBugProject(proj.id)
    toast({ kind: 'success', title: `Created #${created.id}`, detail: !sameProject ? `In ${proj?.name}.` : boardTypes.includes(type) ? undefined : `${type} items are on a different board.` })
    if (keepOpen) {
      setTitle(''); setDescription(''); setSymptom(''); setPoints('')
      titleRef.current?.focus()
    } else {
      closeSheet()
      if (sameProject && boardTypes.includes(type)) select(created.id)
    }
  }

  return (
    <Sheet
      title={parent ? `New child of #${parent.id}` : 'New work item'}
      size="wide"
      onClose={closeSheet}
      footer={
        <>
          <label className="form-inline" style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-2)' }}>
            <input type="checkbox" checked={another} onChange={(e) => setAnother(e.target.checked)} /> Create another
          </label>
          <span className="grow" />
          <button type="button" className="btn" onClick={closeSheet}>Cancel</button>
          <button type="button" className="btn primary" disabled={busy || !title.trim() || !type || !ctx || missingRequired.length > 0} title={missingRequired.length ? `Fill in: ${missingRequired.map((d) => d.name).join(', ')}` : undefined} onClick={() => void submit(another)}>{busy ? 'Creating…' : 'Create'}</button>
        </>
      }
    >
      <div onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit(another) }}>
        <div className="form-row">
          <label>Project</label>
          <div>
            <button ref={projBtn} type="button" className="btn" style={{ minWidth: 220, justifyContent: 'flex-start' }} onClick={() => setProjMenu(true)} disabled={!!payload?.parentId}>
              <FolderKanban size={14} className="faint" />
              <span style={{ flex: 1, textAlign: 'left', fontWeight: 600 }}>{proj?.name ?? 'Choose a project'}</span>
              <ChevronDown size={14} className="faint" />
            </button>
            <Dropdown anchor={projBtn.current} open={projMenu} onClose={() => setProjMenu(false)} width={300} searchable={projects.length > 6}
              options={projects.map((p) => ({ value: p.id, label: p.name, sub: p.id === selectedProject?.id ? 'current board' : undefined }))}
              value={proj?.id} onSelect={pickProject} />
            {!ctx && !ctxError && <div className="help">Loading the project's work item types…</div>}
            {ctxError && <div className="help" style={{ color: 'var(--danger)' }}>{ctxError}</div>}
          </div>
        </div>
        <div className="form-row">
          <label>Type</label>
          <div>
            <button ref={typeBtn} type="button" className="btn" style={{ minWidth: 220, justifyContent: 'flex-start' }} onClick={() => setTypeMenu(true)}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: typeColor(allTypes, type), flexShrink: 0 }} />
              <span style={{ flex: 1, textAlign: 'left' }}>{type || 'Choose a type'}</span>
              <ChevronDown size={14} className="faint" />
            </button>
            <Dropdown anchor={typeBtn.current} open={typeMenu} onClose={() => setTypeMenu(false)} width={260}
              options={ordered.map((t) => ({ value: t.name, label: t.name, sub: boardTypes.includes(t.name) ? 'on this board' : undefined }))}
              value={type} onSelect={(v) => { setType(v); setCustom({}) }} />
          </div>
        </div>
        <div className="form-row">
          <label htmlFor="ni-title">Title</label>
          <input id="ni-title" ref={titleRef} className="input lg" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to be done?" />
        </div>
        {customDefs.map((d) => (
          <div className="form-row" key={d.referenceName}>
            <label htmlFor={`ni-${d.referenceName}`}>{d.name}{d.alwaysRequired && <span style={{ color: 'var(--danger)' }}> *</span>}</label>
            <div style={{ maxWidth: fieldKind(ctx, d) === 'html' ? undefined : 320 }}>
              <CustomFieldInput def={d} ctx={ctx} value={custom[d.referenceName]} onChange={(v) => setCustom((c) => ({ ...c, [d.referenceName]: v }))} forceKind={isIdLike(d) ? 'text' : undefined} />
              {d.helpText && <div className="help">{d.helpText}</div>}
            </div>
          </div>
        ))}
        <div className="form-row">
          <label htmlFor="ni-who">Assigned to</label>
          <div className="form-inline">
            <select id="ni-who" className="input" style={{ width: 260 }} value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">Unassigned</option>
              {(ctx?.members ?? []).map((m) => (<option key={m.id} value={identityKey(m)}>{m.displayName}</option>))}
            </select>
            {me && <button type="button" className="btn sm" onClick={() => setWho(ctx?.members.find((m) => m.id === me.userId || m.displayName === me.userName) ? identityKey(ctx.members.find((m) => m.id === me.userId || m.displayName === me.userName)!) : me.userName)}>Me</button>}
          </div>
        </div>
        <div className="form-row">
          <label htmlFor="ni-iter">Iteration</label>
          <select id="ni-iter" className="input" style={{ width: 260 }} value={iteration} onChange={(e) => setIteration(e.target.value)}>
            <option value="">Default (backlog)</option>
            {(ctx?.iterations ?? []).filter((i) => i.attributes?.timeFrame !== 'past').map((i) => (<option key={i.id} value={i.path}>{i.name}{i.attributes?.timeFrame === 'current' ? ' (current)' : ''}</option>))}
          </select>
        </div>
        <div className="form-row">
          <label>Priority</label>
          <div className="form-inline">
            <div className="choice-row">
              {['1', '2', '3', '4'].map((p) => (<button key={p} type="button" className={`choice ${priority === p ? 'on' : ''}`} onClick={() => setPriority(priority === p ? '' : p)}>P{p}</button>))}
            </div>
            {pointsField && (
              <>
                <label htmlFor="ni-pts" style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-2)', marginLeft: 8 }}>{pointsField.endsWith('RemainingWork') ? 'Remaining (h)' : pointsField.endsWith('StoryPoints') ? 'Points' : 'Effort'}</label>
                <input id="ni-pts" className="input" style={{ width: 80 }} inputMode="decimal" value={points} onChange={(e) => setPoints(e.target.value)} />
              </>
            )}
          </div>
        </div>
        {proj && (
          <div className="form-row">
            <label>Module</label>
            <div><ModulePicker project={proj.name} value={area} onChange={setArea} /><div className="help">Which part of the product. Type a name to add a new module.</div></div>
          </div>
        )}
        <div className="form-row">
          <label htmlFor="ni-tags">Tags</label>
          <input id="ni-tags" className="input" list="ni-taglist" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Separate with semicolons" />
          <datalist id="ni-taglist">{(ctx?.tags ?? []).map((t) => <option key={t} value={t} />)}</datalist>
        </div>
        <div className="form-row">
          <label htmlFor="ni-parent">Parent ID</label>
          <div>
            <input id="ni-parent" className="input" style={{ width: 140 }} inputMode="numeric" value={parentId} onChange={(e) => setParentId(e.target.value.replace(/\D/g, ''))} placeholder="Optional" />
            {parent && <div className="help">{String(parent.fields['System.Title'])}</div>}
          </div>
        </div>
        {longField && (
          <div className="form-row">
            <label>{longField === REPRO_STEPS ? 'Repro Steps' : 'Description'}{dropUploading > 0 && !symptomDef && <div className="help">Uploading image…</div>}</label>
            <HtmlEditor key={`${proj?.id}-${longField}`} value={description} onChange={setDescription} project={proj?.name}
              placeholder={longField === REPRO_STEPS ? 'Steps to reproduce. You can paste screenshots.' : 'Optional. You can paste screenshots.'} />
          </div>
        )}
        {symptomDef && (
          <div className="form-row">
            <label>{symptomDef.name}{symptomDef.alwaysRequired && <span style={{ color: 'var(--danger)' }}> *</span>}{dropUploading > 0 && <div className="help">Uploading image…</div>}</label>
            <HtmlEditor key={`${proj?.id}-symptom`} value={symptom} onChange={setSymptom} project={proj?.name} placeholder="What does the user see? You can paste screenshots." />
          </div>
        )}
      </div>
    </Sheet>
  )
}

/** True when rich text has words or an image, not just empty tags. */
function hasContent(html: string) {
  return /<img\b/i.test(html) || html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() !== ''
}
