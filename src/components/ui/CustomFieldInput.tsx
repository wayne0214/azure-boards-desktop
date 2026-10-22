import { fieldKind, type FieldKind } from '@/lib/customFields'
import type { FieldDef, TeamContext } from '@/lib/types'
import { parseHtml } from '@/lib/format'

interface Props {
  def: FieldDef
  ctx: TeamContext | null
  value: unknown
  onChange: (v: unknown) => void
  className?: string
  compact?: boolean
  /** Render as this kind regardless of the field's declared type (e.g. an ID stored in a text-area field). */
  forceKind?: FieldKind
}

/** Renders the right input for a process-defined field: text, number, picklist, checkbox or date. */
export function CustomFieldInput({ def, ctx, value, onChange, className = 'input', compact, forceKind }: Props) {
  const kind = forceKind ?? fieldKind(ctx, def)
  const style = compact ? { height: 30 } : undefined
  switch (kind) {
    case 'picklist':
      return (
        <select className={className} style={style} value={value === undefined || value === null ? '' : String(value)} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">{def.alwaysRequired ? 'Choose…' : 'Not set'}</option>
          {def.allowedValues?.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      )
    case 'number':
      return <input className={className} style={style} inputMode="decimal" value={value === undefined || value === null ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
    case 'bool':
      return <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
    case 'date':
      return <input className={className} style={style} type="date" value={typeof value === 'string' ? value.slice(0, 10) : ''} onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)} />
    case 'identity':
      return (
        <select className={className} style={style} value={typeof value === 'object' && value ? ((value as { uniqueName?: string }).uniqueName ?? '') : String(value ?? '')} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">Nobody</option>
          {(ctx?.members ?? []).map((m) => <option key={m.id} value={m.uniqueName ?? m.id}>{m.displayName}</option>)}
        </select>
      )
    case 'html': {
      // Plain text while creating; paragraphs become <p> when saved.
      const text = typeof value === 'string' ? htmlToPlain(value) : ''
      return <textarea className="textarea" value={text} onChange={(e) => onChange(e.target.value ? plainToHtml(e.target.value) : null)} placeholder={def.helpText ?? ''} />
    }
    default:
      return <input className={className} style={style} value={value === undefined || value === null ? '' : htmlToPlain(String(value))} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)} placeholder={def.helpText ?? ''} />
  }
}

export function plainToHtml(text: string): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return text.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')
}

export function htmlToPlain(html: string): string {
  const doc = parseHtml(html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>|<\/div>/gi, '\n\n'))
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}
