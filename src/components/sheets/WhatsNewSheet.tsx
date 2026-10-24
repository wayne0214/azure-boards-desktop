import { Sheet } from '@/components/ui/Sheet'
import { APP_VERSION, notesFor, RELEASE_NOTES } from '@/lib/releaseNotes'
import { useUiStore } from '@/store/useUiStore'

/** The release notes for one version: after an update, or from Help → What's New. */
export function WhatsNewSheet() {
  const closeSheet = useUiStore((s) => s.closeSheet)
  const asked = useUiStore((s) => s.sheetPayload?.version)
  const note = notesFor(typeof asked === 'string' ? asked : APP_VERSION) ?? RELEASE_NOTES[0]
  if (!note) return null
  return (
    <Sheet
      title={`What's new in Boards ${note.version}`}
      onClose={closeSheet}
      footer={<><span className="grow" /><button type="button" className="btn primary" onClick={closeSheet} autoFocus>Got it</button></>}
    >
      <ul className="wn-list">
        {note.highlights.map((h) => (
          <li key={h.title}>
            <div className="wn-title">{h.title}</div>
            <div className="wn-detail">{h.detail}</div>
          </li>
        ))}
      </ul>
      {note.more.length > 0 && (
        <>
          <div className="section-h">Also in this release</div>
          <ul className="wn-more">
            {note.more.map((m) => <li key={m}>{m}</li>)}
          </ul>
        </>
      )}
    </Sheet>
  )
}
