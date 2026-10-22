import { GitPullRequest } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type TextareaHTMLAttributes } from 'react'
import { Avatar } from './Avatar'
import { Popover } from './Popover'
import { api } from '@/lib/api'
import { rememberPr } from '@/lib/mentions'
import type { PullRequest } from '@/lib/pr/types'
import type { Identity, WorkItem } from '@/lib/types'

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string
  onChange: (v: string) => void
  /** People offered when "@" is typed. */
  people: Identity[]
  /** With an organization, "#" offers work items and "!" offers pull requests. */
  org?: string | null
  /** Work items from this project come first; others are still found by number. */
  project?: string | null
}

// "@" takes a name with spaces; "#" and "!" take a number or a single word.
const TRIGGER = /(?:^|\s)(?:(@)([^@\n]{0,30})|([#!])([^\s#!]{0,30}))$/

type Hit =
  | { kind: '@'; key: string; person: Identity }
  | { kind: '#'; key: string; item: WorkItem }
  | { kind: '!'; key: string; pr: PullRequest }

// Pull requests change slowly; one list per organization serves every comment box for a while.
const prCache = new Map<string, { at: number; list: Promise<PullRequest[]> }>()
function recentPrs(org: string): Promise<PullRequest[]> {
  const hit = prCache.get(org)
  if (hit && Date.now() - hit.at < 5 * 60000) return hit.list
  const list = api().prList(org, '', 'all', { top: 300 }).catch((e) => { prCache.delete(org); throw e })
  prCache.set(org, { at: Date.now(), list })
  return list
}

/** A textarea where "@" offers people, "#" work items and "!" pull requests; picking one inserts it. */
export function MentionTextarea({ value, onChange, people, org, project, onKeyDown, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [q, setQ] = useState<{ start: number; kind: '@' | '#' | '!'; text: string } | null>(null)
  const [hl, setHl] = useState(0)
  const [remote, setRemote] = useState<{ for: string; hits: Hit[] } | null>(null)
  const [searching, setSearching] = useState(false)

  const needle = q?.text.toLowerCase() ?? ''
  const qKey = q ? `${q.kind}${q.text}` : ''

  // Work items and pull requests are looked up as you type, a moment after you stop.
  useEffect(() => {
    if (!q || q.kind === '@' || !org) return
    const kind = q.kind
    const text = q.text.trim()
    let live = true
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        let hits: Hit[] = []
        if (kind === '#') {
          if (text) {
            const items = await api().searchWorkItems(org, /^\d+$/.test(text) ? null : project ?? null, text)
            hits = items.slice(0, 8).map((item) => ({ kind: '#', key: `#${item.id}`, item }))
          }
        } else {
          const prs = await recentPrs(org)
          const t2 = text.toLowerCase()
          hits = prs
            .filter((p) => !t2 || String(p.pullRequestId).startsWith(t2) || p.title.toLowerCase().includes(t2))
            .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active'))
            .slice(0, 8)
            .map((pr) => ({ kind: '!', key: `!${pr.pullRequestId}`, pr }))
        }
        if (live) { setRemote({ for: `${kind}${q.text}`, hits }); setHl(0) }
      } catch {
        if (live) setRemote({ for: `${kind}${q.text}`, hits: [] })
      } finally {
        if (live) setSearching(false)
      }
    }, 220)
    return () => { live = false; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qKey, org, project])

  const matches: Hit[] = !q
    ? []
    : q.kind === '@'
      ? people.filter((p) => p.displayName.toLowerCase().includes(needle) || (p.uniqueName ?? '').toLowerCase().includes(needle)).slice(0, 8).map((person) => ({ kind: '@', key: person.id, person }))
      : remote?.for === qKey ? remote.hits : []
  const hint = q && q.kind !== '@' && org && matches.length === 0
    ? searching ? 'Searching…' : q.kind === '#' && !q.text.trim() ? 'Type a work item number or words from its title' : 'Nothing found'
    : null
  const open = q !== null && (matches.length > 0 || !!hint)

  const detect = (el: HTMLTextAreaElement) => {
    const caret = el.selectionStart ?? el.value.length
    const m = TRIGGER.exec(el.value.slice(0, caret))
    if (!m) { setQ(null); return }
    const kind = (m[1] ?? m[3]) as '@' | '#' | '!'
    const text = m[2] ?? m[4] ?? ''
    if (kind !== '@' && !org) { setQ(null); return }
    setQ({ start: caret - text.length - 1, kind, text })
    setHl(0)
  }

  const pick = (h: Hit) => {
    const el = ref.current
    if (!el || !q) return
    const caret = el.selectionStart ?? value.length
    let inserted: string
    if (h.kind === '@') inserted = `@${h.person.displayName} `
    else if (h.kind === '#') inserted = `#${h.item.id} `
    else {
      rememberPr(h.pr)
      inserted = `!${h.pr.pullRequestId} `
    }
    onChange(value.slice(0, q.start) + inserted + value.slice(caret))
    setQ(null)
    const pos = q.start + inserted.length
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos, pos) })
  }

  const keyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && !e.metaKey && !e.ctrlKey) {
      if (matches.length && e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => (h + 1) % matches.length); return }
      if (matches.length && e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => (h - 1 + matches.length) % matches.length); return }
      if (matches.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); pick(matches[hl]); return }
      if (e.key === 'Escape') { e.preventDefault(); setQ(null); return }
    }
    onKeyDown?.(e)
  }

  return (
    <>
      <textarea
        ref={ref}
        {...rest}
        value={value}
        onChange={(e) => { onChange(e.target.value); detect(e.target) }}
        onKeyDown={keyDown}
        onClick={(e) => detect(e.currentTarget)}
      />
      <Popover anchor={ref.current} open={open} onClose={() => setQ(null)} width={q?.kind === '@' ? 280 : 380} className="mention-pop">
        {matches.map((h, i) => (
          <button
            key={h.key}
            type="button"
            className={`pop-item ${i === hl ? 'hl' : ''}`}
            onMouseEnter={() => setHl(i)}
            onMouseDown={(e) => { e.preventDefault(); pick(h) }}
          >
            {h.kind === '@' && (
              <>
                <Avatar name={h.person.displayName} keyName={h.person.uniqueName ?? undefined} size="sm" />
                <span className="label">{h.person.displayName}</span>
                {h.person.uniqueName && <span className="sub">{h.person.uniqueName}</span>}
              </>
            )}
            {h.kind === '#' && (
              <>
                <span className="mention-id">#{h.item.id}</span>
                <span className="label">{String(h.item.fields['System.Title'] ?? '')}</span>
                <span className="sub">{String(h.item.fields['System.WorkItemType'] ?? '')} · {String(h.item.fields['System.State'] ?? '')}</span>
              </>
            )}
            {h.kind === '!' && (
              <>
                <GitPullRequest size={14} className="faint" />
                <span className="mention-id">!{h.pr.pullRequestId}</span>
                <span className="label">{h.pr.title}</span>
                <span className="sub">{h.pr.repository?.name}{h.pr.status !== 'active' ? ` · ${h.pr.status}` : ''}</span>
              </>
            )}
          </button>
        ))}
        {hint && <div className="pop-hint">{hint}</div>}
      </Popover>
    </>
  )
}
