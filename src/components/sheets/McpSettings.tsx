import { Copy, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { isTauri } from '@/lib/api'
import { confirmAsync } from '@/lib/confirm'
import { claudeCommand, codexConfig, mcpConfigure, mcpNewToken, mcpStatus, type McpStatus } from '@/lib/mcp'
import { useUiStore } from '@/store/useUiStore'

/** Settings → AI tools (MCP): turn the local server on, and copy the setup for Claude Code or Codex. */
export function McpSettings() {
  const toast = useUiStore((s) => s.toast)
  const [status, setStatus] = useState<McpStatus | null>(null)

  useEffect(() => {
    if (isTauri) void mcpStatus().then(setStatus).catch(() => undefined)
  }, [])

  if (!isTauri) return null

  const apply = async (work: Promise<McpStatus>) => {
    try {
      setStatus(await work)
    } catch (e) {
      toast({ kind: 'error', title: 'Could not change the AI tools server', detail: String((e as { message?: string }).message ?? e) })
    }
  }
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast({ kind: 'success', title: `${what} copied` })
    } catch {
      toast({ kind: 'error', title: 'Could not copy' })
    }
  }
  const newToken = async () => {
    if (!(await confirmAsync('Tools set up with the current token stop working until you copy the setup again.', { title: 'Make a new token?', okLabel: 'New token', danger: true }))) return
    await apply(mcpNewToken())
  }

  const s = status
  return (
    <>
      <div className="section-h">AI tools (MCP)</div>
      <div className="settings-row">
        <div className="lbl">
          Let Claude Code, Codex and other AI tools use Boards
          <div className="sub">
            {!s ? 'Loading…' : !s.enabled ? 'Off. When on, tools on this computer can read and update work items as you.' : s.running ? `On at ${s.url}` : s.error ?? 'Starting…'}
          </div>
        </div>
        <label className="form-inline">
          <input type="checkbox" checked={!!s?.enabled} disabled={!s} onChange={(e) => s && void apply(mcpConfigure(e.target.checked, s.readOnly))} /> On
        </label>
      </div>
      {s?.enabled && (
        <>
          <div className="settings-row">
            <div className="lbl">Read-only<div className="sub">Tools can look things up but not create, edit or comment.</div></div>
            <label className="form-inline">
              <input type="checkbox" checked={s.readOnly} onChange={(e) => void apply(mcpConfigure(true, e.target.checked))} /> Read-only
            </label>
          </div>
          <div className="settings-row">
            <div className="lbl">Claude Code<div className="sub">Run once in a terminal. Works in every project.</div></div>
            <button type="button" className="btn sm" onClick={() => void copy(claudeCommand(s), 'Command')}><Copy size={13} /> Copy command</button>
          </div>
          <div className="settings-row">
            <div className="lbl">Codex<div className="sub">Paste into ~/.codex/config.toml.</div></div>
            <button type="button" className="btn sm" onClick={() => void copy(codexConfig(s), 'Config')}><Copy size={13} /> Copy config</button>
          </div>
          <div className="settings-row">
            <div className="lbl">Access token<div className="sub">In the copied setup. Make a new one if it was shared by mistake.</div></div>
            <button type="button" className="btn sm" onClick={() => void newToken()}><RefreshCw size={13} /> New token</button>
          </div>
        </>
      )}
    </>
  )
}
