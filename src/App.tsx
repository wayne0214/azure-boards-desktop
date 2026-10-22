import { useEffect } from 'react'
import { AppShell } from './components/shell/AppShell'
import { ConnectScreen } from './components/sheets/ConnectScreen'
import { Toasts } from './components/ui/Toasts'
import { useAppStore } from './store/useAppStore'
import { useUiStore, type View } from './store/useUiStore'
import { isTauri } from './lib/api'

function useTheme() {
  const theme = useUiStore((s) => s.theme)
  const scale = useUiStore((s) => s.textScale)
  useEffect(() => {
    const root = document.documentElement
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches)
      root.setAttribute('data-theme', dark ? 'dark' : 'light')
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
  useEffect(() => {
    document.documentElement.style.setProperty('--scale', String(scale))
  }, [scale])
}

export function App() {
  useTheme()
  const booted = useAppStore((s) => s.booted)
  const accounts = useAppStore((s) => s.settings.accounts)
  const boot = useAppStore((s) => s.boot)
  const bootError = useAppStore((s) => s.bootError)

  useEffect(() => {
    void boot()
    if (isTauri) {
      import('@tauri-apps/api/core').then(({ invoke }) =>
        invoke<{ startView?: string | null }>('get_launch_options').then((o) => {
          if (o.startView) useUiStore.getState().setView(o.startView as View)
        }).catch(() => undefined),
      )
    }
  }, [boot])

  if (bootError) {
    return (
      <div className="empty-state" style={{ height: '100%' }}>
        <h3>Your settings could not be read</h3>
        <p className="faint" style={{ maxWidth: 460, textAlign: 'center' }}>{bootError}</p>
        <button type="button" className="btn primary" onClick={() => { useAppStore.setState({ bootError: null }); void boot() }}>Try again</button>
      </div>
    )
  }
  if (!booted) {
    return (
      <div className="empty-state" style={{ height: '100%' }}>
        <span className="spinner lg" />
      </div>
    )
  }
  return (
    <>
      {accounts.length === 0 ? <ConnectScreen /> : <AppShell />}
      <Toasts />
    </>
  )
}
