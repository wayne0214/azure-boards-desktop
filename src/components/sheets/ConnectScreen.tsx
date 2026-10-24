import { Check, ExternalLink, Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { api } from '@/lib/api'
import { TOKEN_ACCESS, TOKEN_NOT_NEEDED } from '@/lib/tokenAccess'
import { errorMessage, type ConnectionInfo } from '@/lib/types'
import { Sheet } from '@/components/ui/Sheet'
import { useAppStore } from '@/store/useAppStore'
import { useUiStore } from '@/store/useUiStore'

/** Normalise what was typed ("contoso", "https://dev.azure.com/contoso/…") to the organization name. */
const orgName = (v: string) => v.trim().replace(/^https?:\/\/dev\.azure\.com\//i, '').replace(/^https?:\/\/([^.]+)\.visualstudio\.com.*/i, '$1').split('/')[0]

function TokenSteps({ org }: { org: string }) {
  const name = orgName(org)
  return (
    <ol className="token-steps">
      <li>
        {name
          ? <button type="button" className="link-btn" onClick={() => void api().openUrl(`https://dev.azure.com/${encodeURIComponent(name)}/_usersSettings/tokens`)}>Open your tokens page in {name} <ExternalLink size={12} /></button>
          : <>In Azure DevOps, click your avatar, then <strong>Personal access tokens</strong></>}
        , then choose <strong>New Token</strong>.
      </li>
      <li>Set <strong>Organization</strong> to {name ? <code>{name}</code> : 'your organization'} and pick an expiry.</li>
      <li>
        Under Scopes choose <strong>Custom defined</strong>, then tick the access for what you will use:
        <div className="token-access">
          {TOKEN_ACCESS.map((a) => (
            <div key={a.feature} className="token-access-group">
              <div className="token-access-head"><b>{a.feature}</b><span className={a.required ? 'token-tag required' : 'token-tag'}>{a.required ? 'Needed' : 'Optional'}</span></div>
              <div className="token-access-detail faint">{a.detail}</div>
              <ul className="token-scopes">{a.scopes.map((s) => <li key={s}><code>{s}</code></li>)}</ul>
            </div>
          ))}
          <div className="token-access-detail faint">{TOKEN_NOT_NEEDED}</div>
        </div>
      </li>
      <li>Create it, copy the token and paste it here. Azure DevOps shows it only once.</li>
    </ol>
  )
}

/** First-run sign-in, also reused as the "Add organization" sheet. */
export function ConnectScreen({ asSheet }: { asSheet?: boolean }) {
  const [org, setOrg] = useState('')
  const [pat, setPat] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checked, setChecked] = useState<ConnectionInfo | null>(null)
  const applySettings = useAppStore((s) => s.applySettings)
  const switchOrg = useAppStore((s) => s.switchOrg)
  const loadProjects = useAppStore((s) => s.loadProjects)
  const closeSheet = useUiStore((s) => s.closeSheet)
  const toast = useUiStore((s) => s.toast)

  const test = async () => {
    setBusy(true); setError(null); setChecked(null)
    try {
      setChecked(await api().testConnection(org, pat))
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  const save = async () => {
    setBusy(true); setError(null)
    try {
      const settings = await api().addAccount(org, pat)
      applySettings(settings)
      const cleanOrg = settings.activeOrg ?? org
      if (asSheet) {
        closeSheet()
        await switchOrg(cleanOrg)
      } else {
        await loadProjects()
      }
      toast({ kind: 'success', title: `Connected to ${cleanOrg}` })
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  const form = (
    <form onSubmit={(e) => { e.preventDefault(); void (checked ? save() : test()) }}>
      <div className="form-row stack">
        <label htmlFor="org">Organization</label>
        <input id="org" className="input lg" value={org} onChange={(e) => { setOrg(e.target.value); setChecked(null) }} placeholder="contoso  or  https://dev.azure.com/contoso" autoFocus autoComplete="off" spellCheck={false} />
        <div className="help">The part after dev.azure.com/ in your browser’s address bar.</div>
      </div>
      <div className="form-row stack">
        <label htmlFor="pat">Personal Access Token</label>
        <div style={{ position: 'relative' }}>
          <input id="pat" className="input lg mono" type={show ? 'text' : 'password'} value={pat} onChange={(e) => { setPat(e.target.value); setChecked(null) }} placeholder="Paste your token" autoComplete="off" spellCheck={false} style={{ paddingRight: 40 }} />
          <button type="button" className="icon-btn" style={{ position: 'absolute', right: 5, top: 5 }} onClick={() => setShow((v) => !v)} title={show ? 'Hide' : 'Show'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
        </div>
        <div className="help">Stored in your {navigator.platform.includes('Win') ? 'Windows Credential Manager' : 'macOS Keychain'}. One token covers every project in the organization.</div>
      </div>
      {asSheet && (
        <details className="token-help">
          <summary>How to create a token</summary>
          <TokenSteps org={org} />
        </details>
      )}
      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}
      {checked && <div className="ok" style={{ marginBottom: 12 }}><Check size={16} /> Signed in as {checked.userName}</div>}
      <div className="form-inline">
        {!checked ? (
          <button type="submit" className="btn lg primary" disabled={busy || !org.trim() || !pat.trim()}>{busy ? 'Checking…' : 'Check connection'}</button>
        ) : (
          <button type="submit" className="btn lg primary" disabled={busy}>{busy ? 'Saving…' : 'Continue'}</button>
        )}
        {asSheet && <button type="button" className="btn lg" onClick={closeSheet}>Cancel</button>}
      </div>
    </form>
  )

  if (asSheet) {
    return <Sheet title="Add organization" onClose={closeSheet} size="narrow">{form}</Sheet>
  }

  return (
    <div className="connect">
      <div className="left drag-region">
        <div className="logo"><i style={{ height: 26 }} /><i style={{ height: 18 }} /><i style={{ height: 12 }} /></div>
        <h1>Boards, on your desk.</h1>
        <p className="lead">A fast desktop client for Azure DevOps. Boards, pull requests, requirements and test cases, all from one window.</p>
        <TokenSteps org={org} />
      </div>
      <div className="right">
        <h2 style={{ fontSize: 'var(--fs-xl)', marginBottom: 18 }}>Connect an organization</h2>
        {form}
      </div>
    </div>
  )
}
