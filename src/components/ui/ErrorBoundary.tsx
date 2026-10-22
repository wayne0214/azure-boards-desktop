import { AlertTriangle } from 'lucide-react'
import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Shown above the message, e.g. which view failed. */
  where?: string
  /** A smaller panel for one view instead of a whole-window screen. */
  inline?: boolean
}

interface State { error: Error | null }

/** Catches an error while drawing so one bad work item shows a message instead of a blank window. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  private copy = () => {
    const e = this.state.error
    const text = [`Where: ${this.props.where ?? 'app'}`, `When: ${new Date().toISOString()}`, `Agent: ${navigator.userAgent}`, '', String(e?.stack ?? e)].join('\n')
    void navigator.clipboard.writeText(text).catch(() => undefined)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="empty-state" style={this.props.inline ? { padding: 32 } : { height: '100%' }}>
        <AlertTriangle size={36} strokeWidth={1.4} style={{ color: 'var(--danger)' }} />
        <h3>{this.props.where ? `${this.props.where} ran into a problem` : 'Something went wrong'}</h3>
        <p className="faint" style={{ maxWidth: 460, textAlign: 'center' }}>{error.message || String(error)}</p>
        <div className="form-inline" style={{ gap: 8, marginTop: 8 }}>
          <button type="button" className="btn primary" onClick={() => this.setState({ error: null })}>Try again</button>
          <button type="button" className="btn" onClick={() => window.location.reload()}>Reload app</button>
          <button type="button" className="btn ghost" onClick={this.copy}>Copy details</button>
        </div>
      </div>
    )
  }
}
