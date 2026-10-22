import { FileText, MessageSquarePlus } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useEffect, useMemo, useState } from 'react'
import { buildUnified, collapse, type DiffLine, type DiffStats } from '@/lib/pr/diff'
import type { Thread } from '@/lib/pr/types'
import { usePrStore } from '@/store/usePrStore'
import { ThreadCard } from './ThreadCard'

export function FilesTab() {
  const s = usePrStore(useShallow((st) => ({ activeFile: st.activeFile, changes: st.changes, changesLoading: st.changesLoading, detail: st.detail, openFile: st.openFile })))
  const d = s.detail!
  const [reviewed, setReviewed] = useState<Set<string>>(new Set())
  const key = `pr.reviewed.${d.pr.repository.id}.${d.pr.pullRequestId}`
  useEffect(() => { try { setReviewed(new Set(JSON.parse(localStorage.getItem(key) ?? '[]'))) } catch { /* ignore */ } }, [key])
  const toggleReviewed = (p: string) => setReviewed((r) => { const n = new Set(r); if (n.has(p)) n.delete(p); else n.add(p); try { localStorage.setItem(key, JSON.stringify([...n])) } catch { /* ignore */ } return n })

  const threadsByFile = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of d.threads) {
      if (t.isDeleted || !t.threadContext?.filePath || t.status !== 'active') continue
      m.set(t.threadContext.filePath, (m.get(t.threadContext.filePath) ?? 0) + 1)
    }
    return m
  }, [d.threads])

  // Keyboard: j / k or ] [ to move between files.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable="true"]')) return
      if (!['j', 'k', ']', '['].includes(e.key)) return
      const paths = s.changes.map((c) => c.item.path!)
      const i = paths.indexOf(s.activeFile ?? '')
      const next = e.key === 'j' || e.key === ']' ? Math.min(paths.length - 1, i + 1) : Math.max(0, i - 1)
      if (paths[next]) void s.openFile(paths[next])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [s])

  if (s.changesLoading && s.changes.length === 0) return <div className="empty-state"><span className="spinner" /></div>
  if (s.changes.length === 0) return <div className="empty-state"><h3>No file changes</h3></div>

  return (
    <div className="pr-files">
      <aside className="pr-file-list">
        <div className="pr-file-list-head"><span>{s.changes.length} files</span><span className="grow" /><span className="faint">{reviewed.size} reviewed</span></div>
        {s.changes.map((c) => {
          const p = c.item.path!
          const type = c.changeType.toLowerCase()
          const letter = type.includes('add') ? 'A' : type.includes('delete') ? 'D' : type.includes('rename') ? 'R' : 'M'
          const dir = p.slice(0, p.lastIndexOf('/') + 1)
          const name = p.slice(p.lastIndexOf('/') + 1)
          return (
            <button key={p} type="button" className={`pr-file ${s.activeFile === p ? 'on' : ''} ${reviewed.has(p) ? 'done' : ''}`} onClick={() => void s.openFile(p)} title={p}>
              <input type="checkbox" checked={reviewed.has(p)} onClick={(e) => e.stopPropagation()} onChange={() => toggleReviewed(p)} title="Mark reviewed" />
              <span className={`ct ${letter}`}>{letter}</span>
              <span className="nm"><span className="faint">{dir}</span>{name}</span>
              {threadsByFile.get(p) ? <span className="pr-chip warn">{threadsByFile.get(p)}</span> : null}
            </button>
          )
        })}
      </aside>
      <div className="pr-diff-wrap">
        {s.activeFile ? <DiffView path={s.activeFile} /> : <div className="empty-state"><FileText size={32} className="faint" /><p>Choose a file.</p></div>}
      </div>
    </div>
  )
}

const GENERATED = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|composer\.lock|Gemfile\.lock|poetry\.lock|uv\.lock|go\.sum|.*\.min\.(js|css)|.*\.map|.*\.snap)$/i
const MAX_LINES = 6000
const PAGE = 600

function DiffView({ path }: { path: string }) {
  const s = usePrStore(useShallow((st) => ({ comment: st.comment, detail: st.detail, files: st.files })))
  const file = s.files[path]
  const threads = useMemo(() => s.detail!.threads.filter((t) => !t.isDeleted && t.threadContext?.filePath === path && t.comments.some((c) => !c.isDeleted && c.commentType !== 'system')), [s.detail, path])
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [composer, setComposer] = useState<{ line: number; side: 'left' | 'right' } | null>(null)
  const [text, setText] = useState('')
  const [forced, setForced] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [diff, setDiff] = useState<{ all: DiffLine[]; stats: DiffStats } | null>(null)
  const [computing, setComputing] = useState(false)
  useEffect(() => { setExpanded(new Set()); setComposer(null); setForced(false); setLimit(PAGE); setDiff(null) }, [path])

  const ready = !!file && !file.loading && !file.binary && file.oldText !== null && file.newText !== null
  const lineCount = ready ? (file!.oldText!.split('\n').length + file!.newText!.split('\n').length) : 0
  const heavy = ready && (GENERATED.test(path) || lineCount > MAX_LINES)

  // Compute the diff off the click handler so the spinner can paint first; skip heavy files until asked.
  useEffect(() => {
    if (!ready || (heavy && !forced)) return
    setComputing(true)
    const id = setTimeout(() => {
      setDiff(buildUnified(file!.oldText!, file!.newText!))
      setComputing(false)
    }, 20)
    return () => clearTimeout(id)
  }, [ready, heavy, forced, file])

  const commentedRight = useMemo(() => new Set(threads.map((t) => t.threadContext?.rightFileStart?.line).filter((n): n is number => typeof n === 'number')), [threads])
  const rows = useMemo(() => (diff ? collapse(diff.all, 3, expanded, commentedRight) : []), [diff, expanded, commentedRight])
  const shown = rows.slice(0, limit)

  if (!file || file.loading) return <div className="empty-state"><span className="spinner" /></div>
  if (file.error) return <div className="empty-state"><h3>Could not load file</h3><p>{file.error}</p></div>
  if (file.binary) return <div className="empty-state"><h3>Binary file</h3><p>{path}</p></div>
  if (heavy && !forced) {
    return (
      <div className="empty-state">
        <h3>{GENERATED.test(path) ? 'Generated file' : 'Very large file'}</h3>
        <p>{path.split('/').pop()} has about {lineCount.toLocaleString()} lines{GENERATED.test(path) ? ' and is usually machine-written' : ''}. Showing its diff can take a while.</p>
        <button type="button" className="btn" onClick={() => setForced(true)}>Show diff anyway</button>
      </div>
    )
  }
  if (computing || !diff) return <div className="empty-state"><span className="spinner" /><p className="faint">Comparing…</p></div>

  const byLine = (line: number, side: 'left' | 'right') =>
    threads.filter((t) => (side === 'right' ? t.threadContext?.rightFileStart?.line === line && !t.threadContext?.leftFileStart : t.threadContext?.leftFileStart?.line === line && !t.threadContext?.rightFileStart))

  const submit = async () => {
    if (!composer || !text.trim()) return
    await s.comment(text.trim(), { filePath: path, line: composer.line, side: composer.side })
    setText(''); setComposer(null)
  }

  return (
    <div className="pr-diff">
      <div className="pr-diff-head">
        <span className="mono">{file.originalPath && file.originalPath !== path ? `${file.originalPath} → ${path}` : path}</span>
        <span className="grow" />
        <span className="pr-diff-stats"><span className="add">+{diff.stats.added}</span> <span className="del">−{diff.stats.removed}</span></span>
      </div>
      {diff.all.length === 0 && <div className="faint" style={{ padding: 16 }}>Empty file.</div>}
      {diff.stats.added === 0 && diff.stats.removed === 0 && diff.all.length > 0 && <div className="faint" style={{ padding: 16 }}>No text changes (mode or whitespace only).</div>}
      <table className="diff">
        <tbody>
          {shown.map((r, i) => (
            <DiffRow key={i} row={r} onExpand={() => setExpanded((e) => new Set(e).add(r.hidden!.index))} onComment={(line, side) => { setComposer({ line, side }); setText('') }}
              threads={r.kind === 'gap' ? [] : r.right !== undefined ? byLine(r.right, 'right') : r.left !== undefined ? byLine(r.left, 'left') : []}
              composer={composer && ((composer.side === 'right' && r.right === composer.line && r.kind !== 'del') || (composer.side === 'left' && r.left === composer.line && r.kind === 'del')) ? (
                <div className="pr-inline-composer">
                  <textarea className="textarea" rows={3} autoFocus value={text} placeholder="Comment on this line… (Markdown)" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit(); if (e.key === 'Escape') setComposer(null) }} />
                  <div className="form-inline" style={{ marginTop: 6 }}>
                    <button type="button" className="btn sm primary" disabled={!text.trim()} onClick={() => void submit()}>Comment</button>
                    <button type="button" className="btn sm" onClick={() => setComposer(null)}>Cancel</button>
                  </div>
                </div>
              ) : null} />
          ))}
        </tbody>
      </table>
      {rows.length > limit && (
        <div style={{ padding: 10, textAlign: 'center' }}>
          <button type="button" className="btn sm" onClick={() => setLimit((l) => l + PAGE)}>Show next {Math.min(PAGE, rows.length - limit).toLocaleString()} of {(rows.length - limit).toLocaleString()} remaining lines</button>
        </div>
      )}
    </div>
  )
}

function DiffRow({ row, onExpand, onComment, threads, composer }: { row: DiffLine; onExpand: () => void; onComment: (line: number, side: 'left' | 'right') => void; threads: Thread[]; composer: React.ReactNode }) {
  if (row.kind === 'gap') {
    return (
      <tr className="gap"><td colSpan={3}><button type="button" onClick={onExpand}>Show {row.hidden!.count} unchanged lines</button></td></tr>
    )
  }
  const side: 'left' | 'right' = row.kind === 'del' ? 'left' : 'right'
  const line = side === 'left' ? row.left! : row.right!
  return (
    <>
      <tr className={`line ${row.kind}`}>
        <td className="ln">{row.left ?? ''}</td>
        <td className="ln">{row.right ?? ''}<button type="button" className="add-comment" title="Comment on this line" onClick={() => onComment(line, side)}><MessageSquarePlus size={13} /></button></td>
        <td className="code"><span className="sign">{row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '}</span>{row.text || ' '}</td>
      </tr>
      {(threads.length > 0 || composer) && (
        <tr className="inline"><td colSpan={3}>
          {threads.map((t) => <ThreadCard key={t.id} thread={t} />)}
          {composer}
        </td></tr>
      )}
    </>
  )
}
