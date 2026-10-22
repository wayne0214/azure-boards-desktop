import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { api, loadApi } from './lib/api'
import { isMac } from './lib/format'
import { useUiStore } from './store/useUiStore'
import './styles/app.css'

if (isMac) document.documentElement.classList.add('is-mac')

// Desktop apps do not navigate or show the browser context menu.
document.addEventListener('contextmenu', (e) => {
  const t = e.target as HTMLElement
  if (t.closest('input, textarea, [contenteditable="true"], .selectable')) return
  e.preventDefault()
})
// Links in work items, comments and pull requests open in the browser, never inside the app window.
const openLink = (e: MouseEvent) => {
  // auxclick also fires for the right button; only a middle click opens a link.
  if (e.type === 'auxclick' && e.button !== 1) return
  const a = (e.target as Element | null)?.closest?.('a[href]')
  if (!a) return
  const href = a.getAttribute('href') ?? ''
  if (href.startsWith('#')) return
  e.preventDefault()
  // In an editor a plain click places the caret; Cmd/Ctrl-click follows the link.
  if (a.closest('[contenteditable="true"]') && !(e.metaKey || e.ctrlKey)) return
  let url: URL
  try { url = new URL(href, window.location.href) } catch { return }
  if (['http:', 'https:', 'mailto:'].includes(url.protocol)) void api().openUrl(url.href)
}
document.addEventListener('click', openLink, true)
document.addEventListener('auxclick', openLink, true)
// A failed background call nobody handled shows once as a toast instead of disappearing.
let lastRejection = ''
window.addEventListener('unhandledrejection', (e) => {
  const message = String((e.reason as { message?: string })?.message ?? e.reason ?? 'Unknown error')
  if (message === lastRejection) return
  lastRejection = message
  setTimeout(() => { if (lastRejection === message) lastRejection = '' }, 5000)
  useUiStore.getState().toast({ kind: 'error', title: 'Something went wrong', detail: message })
})
document.addEventListener('dragover', (e) => e.preventDefault())
document.addEventListener('drop', (e) => e.preventDefault())

const root = ReactDOM.createRoot(document.getElementById('root')!)
loadApi().then(
  () => root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  ),
  (e) => root.render(<div className="empty-state" style={{ height: '100%' }}><h3>Boards could not start</h3><p className="faint">{String((e as Error)?.message ?? e)}</p><button type="button" className="btn" onClick={() => window.location.reload()}>Try again</button></div>),
)
