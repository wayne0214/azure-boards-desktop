import { Check, MoreHorizontal, RotateCcw } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useRef, useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Dropdown } from '@/components/ui/Dropdown'
import { relativeTime } from '@/lib/format'
import { renderMarkdown } from '@/lib/pr/markdown'
import type { Thread } from '@/lib/pr/types'
import { useAppStore } from '@/store/useAppStore'
import { usePrStore } from '@/store/usePrStore'
import { confirmAsync } from '@/lib/confirm'
import { MentionTextarea } from '@/components/ui/MentionTextarea'
import { fromPrMentions, renderPrMentions, toPrMentions } from '@/lib/mentions'
import type { Identity } from '@/lib/types'

const NO_PEOPLE: Identity[] = []

const STATUS_LABEL: Record<string, string> = { active: 'Active', fixed: 'Resolved', wontFix: "Won't fix", closed: 'Closed', byDesign: 'By design', pending: 'Pending' }

export function ThreadCard({ thread, compact }: { thread: Thread; compact?: boolean }) {
  const s = usePrStore(useShallow((st) => ({ deleteComment: st.deleteComment, editComment: st.editComment, members: st.members, reply: st.reply, selected: st.selected, setThreadStatus: st.setThreadStatus })))
  const me = useAppStore((st) => st.account())
  const org = useAppStore((st) => st.activeOrg)
  const people = s.members[s.selected?.projectId ?? ''] ?? NO_PEOPLE
  const [reply, setReply] = useState('')
  const [replying, setReplying] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [menuFor, setMenuFor] = useState<number | null>(null)
  const menuBtn = useRef<HTMLButtonElement>(null)
  const [statusOpen, setStatusOpen] = useState(false)
  const statusBtn = useRef<HTMLButtonElement>(null)
  const comments = thread.comments.filter((c) => c.commentType !== 'system' || !compact)
  const resolved = thread.status && thread.status !== 'active' && thread.status !== 'pending' && thread.status !== 'unknown'
  const isSystem = thread.comments.every((c) => c.commentType === 'system')

  const send = async () => {
    const t = reply.trim()
    if (!t) return
    await s.reply(thread.id, thread.comments[0]?.id ?? 0, toPrMentions(t, people))
    setReply(''); setReplying(false)
  }

  if (isSystem) {
    return <div className="pr-system">{thread.comments.map((c) => <div key={c.id}><span className="faint">{c.content}</span> <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{relativeTime(c.publishedDate)}</span></div>)}</div>
  }

  return (
    <div className={`pr-thread ${resolved ? 'resolved' : ''}`}>
      {comments.map((c) => (
        <div key={c.id} className="pr-comment">
          <Avatar name={c.author.displayName} keyName={c.author.uniqueName} size="sm" />
          <div className="body">
            <div className="who">
              <span className="nm">{c.author.displayName}</span>
              <span className="faint">{relativeTime(c.publishedDate)}{c.lastUpdatedDate && c.lastUpdatedDate !== c.publishedDate ? ' · edited' : ''}</span>
              <span className="grow" />
              {c.author.id === me?.userId && !c.isDeleted && (
                <button ref={menuFor === c.id ? menuBtn : undefined} type="button" className="icon-btn sm" onClick={(e) => { (menuBtn as React.MutableRefObject<HTMLButtonElement | null>).current = e.currentTarget; setMenuFor(c.id) }}><MoreHorizontal size={14} /></button>
              )}
            </div>
            {editingId === c.id ? (
              <div>
                <MentionTextarea people={people} org={org} className="textarea" rows={3} value={editText} onChange={setEditText} autoFocus />
                <div className="form-inline" style={{ marginTop: 6 }}>
                  <button type="button" className="btn sm primary" onClick={() => { void s.editComment(thread.id, c.id, toPrMentions(editText, people)); setEditingId(null) }}>Save</button>
                  <button type="button" className="btn sm" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              </div>
            ) : c.isDeleted ? (
              <div className="faint"><i>Comment deleted</i></div>
            ) : (
              <div className="md selectable" dangerouslySetInnerHTML={{ __html: renderMarkdown(renderPrMentions(c.content, people)) }} />
            )}
          </div>
        </div>
      ))}
      <Dropdown anchor={menuBtn.current} open={menuFor !== null} onClose={() => setMenuFor(null)} width={160} align="right"
        options={[{ value: 'edit', label: 'Edit' }, { value: 'delete', label: 'Delete', danger: true }]}
        onSelect={(v) => { const c = thread.comments.find((x) => x.id === menuFor); if (!c) return; if (v === 'edit') { setEditText(fromPrMentions(c.content ?? '', people)); setEditingId(c.id) } if (v === 'delete') void confirmAsync('Delete this comment?', { okLabel: 'Delete', danger: true }).then((ok) => { if (ok) void s.deleteComment(thread.id, c.id) }) }} />
      <div className="pr-thread-foot">
        {!replying ? (
          <button type="button" className="btn sm ghost" onClick={() => setReplying(true)}>Reply</button>
        ) : (
          <div style={{ flex: 1 }}>
            <MentionTextarea people={people} org={org} className="textarea" rows={2} value={reply} autoFocus placeholder="Reply… (@ to mention)" onChange={setReply} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void send(); if (e.key === 'Escape') setReplying(false) }} />
            <div className="form-inline" style={{ marginTop: 6 }}>
              <button type="button" className="btn sm primary" disabled={!reply.trim()} onClick={() => void send()}>Reply</button>
              <button type="button" className="btn sm" onClick={() => setReplying(false)}>Cancel</button>
            </div>
          </div>
        )}
        <span className="grow" />
        {resolved ? (
          <button type="button" className="btn sm ghost" onClick={() => void s.setThreadStatus(thread.id, 'active')}><RotateCcw size={13} /> Reactivate</button>
        ) : (
          <>
            <button type="button" className="btn sm" onClick={() => void s.setThreadStatus(thread.id, 'fixed')}><Check size={13} /> Resolve</button>
            <button ref={statusBtn} type="button" className="icon-btn sm" onClick={() => setStatusOpen(true)} title="Other status"><MoreHorizontal size={14} /></button>
            <Dropdown anchor={statusBtn.current} open={statusOpen} onClose={() => setStatusOpen(false)} width={180} align="right"
              options={[{ value: 'wontFix', label: "Won't fix" }, { value: 'byDesign', label: 'By design' }, { value: 'closed', label: 'Closed' }, { value: 'pending', label: 'Pending' }]}
              onSelect={(v) => void s.setThreadStatus(thread.id, v as Thread['status'])} />
          </>
        )}
        {thread.status && <span className={`pr-chip ${resolved ? 'ok' : ''}`}>{STATUS_LABEL[thread.status] ?? thread.status}</span>}
      </div>
    </div>
  )
}
