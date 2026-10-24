import type { ReactNode } from 'react'

/** A titled card of settings rows, separated by hairlines. */
export function SettingsGroup({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="set-group">
      {title && <h3 className="set-group-h">{title}</h3>}
      <div className="set-card">{children}</div>
      {footer && <p className="set-foot">{footer}</p>}
    </section>
  )
}

/** One setting: name and hint on the left, its control on the right (or below, with `stack`). */
export function SettingsRow({ label, hint, children, stack }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; stack?: boolean }) {
  return (
    <div className={`set-row ${stack ? 'stack' : ''}`}>
      <div className="set-lbl">
        <div className="set-name">{label}</div>
        {hint && <div className="set-hint">{hint}</div>}
      </div>
      {children && <div className="set-ctl">{children}</div>}
    </div>
  )
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="knob" />
    </button>
  )
}
