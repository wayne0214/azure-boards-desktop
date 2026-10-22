import { X } from 'lucide-react'
import { useUiStore } from '@/store/useUiStore'

export function Toasts() {
  const toasts = useUiStore((s) => s.toasts)
  const dismiss = useUiStore((s) => s.dismissToast)
  if (toasts.length === 0) return null
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role="status">
          <div className="body">
            <div className="t">{t.title}</div>
            {t.detail && <div className="d">{t.detail}</div>}
            {t.action && (
              <button type="button" className="act" onClick={() => { t.action?.onClick(); dismiss(t.id) }}>
                {t.action.label}
              </button>
            )}
          </div>
          <button type="button" className="icon-btn sm" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
