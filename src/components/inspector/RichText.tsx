import DOMPurify from 'dompurify'
import { Bold, ImagePlus, Italic, List, ListOrdered } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { hydrateImages, imageFiles, insertHtmlAt, restoreImageSources, uploadImageHtml } from '@/lib/attachments'
import { useAppStore } from '@/store/useAppStore'
import { useUiStore } from '@/store/useUiStore'

interface Props {
  html: string | undefined
  placeholder: string
  onSave: (html: string) => void
  /** Project that pasted or picked images are attached to; without it images cannot be added. */
  project?: string
}

const sanitize = (html: string) => DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, ADD_ATTR: ['data-original-src'] })

/** Uploads images into a contentEditable element: paste, drop, or the image button. */
export function useImageInsert(project: string | undefined, onInserted?: () => void) {
  const org = useAppStore((s) => s.activeOrg)
  const [uploading, setUploading] = useState(0)
  const insert = async (el: HTMLElement | null, files: File[]) => {
    if (!el || !org || !project || files.length === 0) return
    setUploading((n) => n + files.length)
    for (const file of files) {
      try {
        insertHtmlAt(el, await uploadImageHtml(org, project, file))
        onInserted?.()
      } catch (e) {
        useUiStore.getState().toast({ kind: 'error', title: 'Could not add the image', detail: String((e as { message?: string }).message ?? e) })
      } finally {
        setUploading((n) => n - 1)
      }
    }
  }
  return { insert, uploading, enabled: !!org && !!project }
}

/** Minimal rich text editor that preserves the HTML Azure DevOps already stores. */
export function RichText({ html, placeholder, onSave, project }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState(false)
  const initial = useRef('')
  const org = useAppStore((s) => s.activeOrg)
  const images = useImageInsert(project)

  useEffect(() => {
    if (!editing && ref.current) {
      ref.current.innerHTML = sanitize(html ?? '')
      if (org) hydrateImages(ref.current, org)
    }
  }, [html, editing, org])

  const commit = () => {
    setEditing(false)
    const next = ref.current?.innerHTML ?? ''
    if (next.trim() === initial.current.trim()) return
    const cleaned = restoreImageSources(next).replace(/<br\s*\/?>\s*$/g, '').trim()
    onSave(cleaned)
  }

  const exec = (cmd: string) => {
    ref.current?.focus()
    document.execCommand(cmd)
  }

  return (
    <div>
      <div
        ref={ref}
        className={`rich ${images.uploading ? 'uploading' : ''}`}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onFocus={() => { if (!editing) initial.current = ref.current?.innerHTML ?? ''; setEditing(true) }}
        // A blur because the whole window lost focus (file picker, another app) keeps editing open.
        onBlur={() => { if (document.hasFocus() && !images.uploading) commit() }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { if (ref.current) ref.current.innerHTML = initial.current; ref.current?.blur() }
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') ref.current?.blur()
        }}
        onPaste={(e) => {
          const files = imageFiles(e.clipboardData)
          if (files.length && images.enabled) { e.preventDefault(); void images.insert(ref.current, files); return }
          // Paste as plain text to avoid dragging in foreign styles.
          const text = e.clipboardData.getData('text/plain')
          if (text) { e.preventDefault(); document.execCommand('insertText', false, text) }
        }}
        onDrop={(e) => {
          const files = imageFiles(e.dataTransfer)
          if (files.length && images.enabled) { e.preventDefault(); void images.insert(ref.current, files) }
        }}
      />
      {editing && (
        <div className="rich-toolbar">
          <button type="button" className="icon-btn" onMouseDown={(e) => { e.preventDefault(); exec('bold') }} title="Bold"><Bold size={14} /></button>
          <button type="button" className="icon-btn" onMouseDown={(e) => { e.preventDefault(); exec('italic') }} title="Italic"><Italic size={14} /></button>
          <button type="button" className="icon-btn" onMouseDown={(e) => { e.preventDefault(); exec('insertUnorderedList') }} title="Bulleted list"><List size={14} /></button>
          <button type="button" className="icon-btn" onMouseDown={(e) => { e.preventDefault(); exec('insertOrderedList') }} title="Numbered list"><ListOrdered size={14} /></button>
          {images.enabled && (
            <>
              <button type="button" className="icon-btn" onMouseDown={(e) => { e.preventDefault(); fileRef.current?.click() }} title="Add image (or paste a screenshot)"><ImagePlus size={14} /></button>
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void images.insert(ref.current, Array.from(e.target.files ?? [])); e.target.value = '' }} />
            </>
          )}
          <span className="faint" style={{ fontSize: 'var(--fs-xs)', alignSelf: 'center', marginLeft: 6 }}>
            {images.uploading ? 'Uploading image…' : 'Saves when you click away · Esc to cancel'}
          </span>
        </div>
      )}
    </div>
  )
}

/** The same editor for a form: reports every change instead of saving on blur. */
export function HtmlEditor({ value, onChange, placeholder, project, minHeight = 96 }: { value: string; onChange: (html: string) => void; placeholder: string; project?: string; minHeight?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const emit = () => onChange(ref.current?.innerHTML ?? '')
  const images = useImageInsert(project, emit)

  // Only push the value in when it changed from outside (e.g. the form was cleared).
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = sanitize(value)
  }, [value])

  const exec = (cmd: string) => { ref.current?.focus(); document.execCommand(cmd); emit() }

  return (
    <div className="html-editor">
      <div className="rich-toolbar top">
        <button type="button" className="icon-btn" onMouseDown={(e) => { e.preventDefault(); exec('bold') }} title="Bold"><Bold size={14} /></button>
        <button type="button" className="icon-btn" onMouseDown={(e) => { e.preventDefault(); exec('italic') }} title="Italic"><Italic size={14} /></button>
        <button type="button" className="icon-btn" onMouseDown={(e) => { e.preventDefault(); exec('insertUnorderedList') }} title="Bulleted list"><List size={14} /></button>
        <button type="button" className="icon-btn" onMouseDown={(e) => { e.preventDefault(); exec('insertOrderedList') }} title="Numbered list"><ListOrdered size={14} /></button>
        {images.enabled && (
          <>
            <button type="button" className="icon-btn" onMouseDown={(e) => { e.preventDefault(); fileRef.current?.click() }} title="Add image (or paste a screenshot)"><ImagePlus size={14} /></button>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void images.insert(ref.current, Array.from(e.target.files ?? [])); e.target.value = '' }} />
          </>
        )}
        {images.uploading > 0 && <span className="faint" style={{ fontSize: 'var(--fs-xs)', alignSelf: 'center', marginLeft: 6 }}>Uploading image…</span>}
      </div>
      <div
        ref={ref}
        className="rich editing"
        style={{ minHeight }}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={emit}
        onPaste={(e) => {
          const files = imageFiles(e.clipboardData)
          if (files.length && images.enabled) { e.preventDefault(); void images.insert(ref.current, files); return }
          const text = e.clipboardData.getData('text/plain')
          if (text) { e.preventDefault(); document.execCommand('insertText', false, text); emit() }
        }}
        onDrop={(e) => {
          const files = imageFiles(e.dataTransfer)
          if (files.length && images.enabled) { e.preventDefault(); void images.insert(ref.current, files) }
        }}
      />
    </div>
  )
}
