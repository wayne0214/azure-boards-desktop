import { Check, Copy, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { isTauri } from '@/lib/api'
import { confirmAsync } from '@/lib/confirm'
import { claudeCommand, codexConfig, mcpConfigure, mcpNewToken, mcpQuickSetup, mcpRemoveClient, mcpSetupClient, mcpStatus, type McpClient, type McpStatus } from '@/lib/mcp'
import { useUiStore } from '@/store/useUiStore'

const STATE_TEXT: Record<McpClient['state'], string> = {
  ready: 'Set up',
  outdated: 'Set up with an old token',
  missing: 'Not set up',
  notInstalled: 'Not found on this computer',
}

/** Settings → AI tools (MCP): one click turns the local server on and sets up Claude Code and Codex. */
export function McpSettings() {
  const toast = useUiStore((s) => s.toast)
  const [status, setStatus] = useState<McpStatus | null>(null)
  /** What is running: "quick", "off", or a tool id. */
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (isTauri) void mcpStatus().then(setStatus).catch(() => undefined)
  }, [])

  if (!isTauri) return null

  const run = async (key: string, work: () => Promise<McpStatus>, done?: (s: McpStatus) => void) => {
    setBusy(key)
    try {
      const next = await work()
      setStatus(next)
      done?.(next)
    } catch (e) {
      toast({ kind: 'error', title: 'Could not change the AI tools setup', detail: String((e as { message?: string }).message ?? e) })
    } finally {
      setBusy(null)
    }
  }
  const failures = (s: McpStatus) => s.clients.filter((c) => c.detail)
  const reportSetup = (s: McpStatus) => {
    const failed = failures(s)
    const ready = s.clients.filter((c) => c.state === 'ready').map((c) => c.name)
    if (failed.length) toast({ kind: 'error', title: `Could not set up ${failed.map((c) => c.name).join(' and ')}`, detail: failed[0].detail ?? undefined })
    else if (ready.length) toast({ kind: 'success', title: `Ready in ${ready.join(' and ')}`, detail: 'Start a new chat there to use it.' })
    else toast({ kind: 'info', title: 'Server is on', detail: 'Claude Code and Codex were not found; copy the setup below.' })
  }
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast({ kind: 'success', title: 'Copied' })
    } catch {
      toast({ kind: 'error', title: 'Could not copy' })
    }
  }
  const newToken = async () => {
    if (!(await confirmAsync('Tools set up here get the new token automatically. Anything you set up by hand stops working until you copy the setup again.', { title: 'Make a new token?', okLabel: 'New token', danger: true }))) return
    await run('token', mcpNewToken, (s) => { if (!failures(s).length) toast({ kind: 'success', title: 'New token in use' }) })
  }

  const s = status
  if (!s) {
    return (
      <>
        <div className="section-h">AI tools (MCP)</div>
        <div className="settings-row"><div className="lbl faint">Loading…</div></div>
      </>
    )
  }

  if (!s.enabled) {
    return (
      <>
        <div className="section-h">AI tools (MCP)</div>
        <div className="settings-row">
          <div className="lbl">
            Use Boards from Claude Code and Codex
            <div className="sub">Ask in your coding chat to find, check or update work items. Only programs on this computer can connect.</div>
          </div>
          <button type="button" className="btn sm primary" disabled={!!busy} onClick={() => void run('quick', mcpQuickSetup, reportSetup)}>
            {busy === 'quick' ? <span className="spinner" /> : null} Turn on &amp; set up
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="section-h">AI tools (MCP)</div>
      <div className="settings-row">
        <div className="lbl">
          Use Boards from Claude Code and Codex
          <div className="sub">{s.running ? 'On. Boards must be open for the tools to answer.' : s.error ?? 'Starting…'}</div>
        </div>
        <button type="button" className="btn sm" disabled={!!busy} onClick={() => void run('off', () => mcpConfigure(false, s.readOnly))}>Turn off</button>
      </div>
      <div className="settings-row">
        <div className="lbl">Access<div className="sub">Read-only lets tools look things up but not create, edit or comment.</div></div>
        <div className="segmented">
          <button type="button" className={!s.readOnly ? 'on' : ''} disabled={!!busy} onClick={() => void run('access', () => mcpConfigure(true, false))}>Read &amp; write</button>
          <button type="button" className={s.readOnly ? 'on' : ''} disabled={!!busy} onClick={() => void run('access', () => mcpConfigure(true, true))}>Read-only</button>
        </div>
      </div>
      {s.clients.map((c) => (
        <div key={c.id} className="settings-row">
          <div className="lbl">
            {c.name}
            <div className={`sub mcp-state ${c.state}`}>
              {c.state === 'ready' && <Check size={12} />} {STATE_TEXT[c.state]}
              {c.detail && <span className="mcp-err"> · {c.detail}</span>}
            </div>
          </div>
          <button type="button" className="icon-btn sm" title={c.id === 'claude' ? 'Copy the terminal command' : 'Copy the lines for ~/.codex/config.toml'} onClick={() => void copy(c.id === 'claude' ? claudeCommand(s) : codexConfig(s))}><Copy size={14} /></button>
          {c.state === 'ready' ? (
            <button type="button" className="btn sm" disabled={!!busy} onClick={() => void run(c.id, () => mcpRemoveClient(c.id))}>{busy === c.id ? <span className="spinner" /> : null} Remove</button>
          ) : c.state !== 'notInstalled' ? (
            <button type="button" className="btn sm primary" disabled={!!busy} onClick={() => void run(c.id, () => mcpSetupClient(c.id), reportSetup)}>{busy === c.id ? <span className="spinner" /> : null} {c.state === 'outdated' ? 'Update' : 'Set up'}</button>
          ) : null}
        </div>
      ))}
      <div className="settings-row">
        <div className="lbl">Access token<div className="sub">Make a new one if the old one was shared by mistake. Tools set up here are updated too.</div></div>
        <button type="button" className="btn sm" disabled={!!busy} onClick={() => void newToken()}>{busy === 'token' ? <span className="spinner" /> : <RefreshCw size={13} />} New token</button>
      </div>
    </>
  )
}
