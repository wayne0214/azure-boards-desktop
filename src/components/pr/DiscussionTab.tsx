import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { usePrStore } from '@/store/usePrStore'
import { ThreadCard } from './ThreadCard'
import { useAppStore } from '@/store/useAppStore'
import { MentionTextarea } from '@/components/ui/MentionTextarea'
import { toPrMentions } from '@/lib/mentions'
import type { Identity } from '@/lib/types'

const NO_PEOPLE: Identity[] = []

export function DiscussionTab() {
  const s = usePrStore(useShallow((st) => ({ comment: st.comment, detail: st.detail, members: st.members, openFile: st.openFile, selected: st.selected, setDetailTab: st.setDetailTab })))
  const org = useAppStore((st) => st.activeOrg)
  const [text, setText] = useState('')
  const [showResolved, setShowResolved] = useState(false)
  const d = s.detail!
  const people = s.members[s.selected?.projectId ?? ''] ?? NO_PEOPLE
  const threads = d.threads.filter((t) => !t.isDeleted).filter((t) => t.comments.some((c) => !c.isDeleted))
  const visible = threads.filter((t) => showResolved || !t.status || t.status === 'active' || t.status === 'pending' || t.status === 'unknown' || t.comments.every((c) => c.commentType === 'system'))
  const post = async () => { const t = text.trim(); if (!t) return; await s.comment(toPrMentions(t, people)); setText('') }
  return (
    <div className="pr-discussion">
      <div className="comment-box" style={{ marginBottom: 16 }}>
        <MentionTextarea people={people} org={org} value={text} placeholder="Add a comment… (Markdown · @ person · # work item · ! pull request)" onChange={setText} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void post() }} />
        <div className="row">
          <label className="hint" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Show resolved</label>
          <button type="button" className="btn sm primary" disabled={!text.trim()} onClick={() => void post()}>Post</button>
        </div>
      </div>
      {visible.length === 0 && <div className="faint">No comments yet.</div>}
      {visible.slice().reverse().map((t) => (
        <div key={t.id}>
          {t.threadContext?.filePath && <button type="button" className="pr-thread-file" onClick={() => { s.setDetailTab('files'); void s.openFile(t.threadContext!.filePath) }}>{t.threadContext.filePath}{t.threadContext.rightFileStart ? ` : ${t.threadContext.rightFileStart.line}` : t.threadContext.leftFileStart ? ` : ${t.threadContext.leftFileStart.line} (old)` : ''}</button>}
          <ThreadCard thread={t} />
        </div>
      ))}
    </div>
  )
}
