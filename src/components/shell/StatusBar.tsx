import { useEffect, useState } from 'react'
import { relativeTime } from '@/lib/format'
import { useBoardStore } from '@/store/useBoardStore'
import { isTauri } from '@/lib/api'

export function StatusBar() {
  const lastUpdated = useBoardStore((s) => s.lastUpdated)
  const refreshing = useBoardStore((s) => s.refreshing)
  const fromCache = useBoardStore((s) => s.fromCache)
  const items = useBoardStore((s) => s.items)
  const error = useBoardStore((s) => s.error)
  const selected = useBoardStore((s) => s.selectedIds)
  const [, tick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30000)
    return () => clearInterval(id)
  }, [])

  const dot = error ? 'offline' : fromCache ? 'stale' : ''
  return (
    <div className="statusbar">
      <span>
        <span className={`dot ${dot}`} />
        {refreshing ? 'Syncing…' : error ? 'Could not reach Azure DevOps' : fromCache ? `Showing saved copy from ${relativeTime(lastUpdated ? new Date(lastUpdated).toISOString() : null)}` : lastUpdated ? `Updated ${relativeTime(new Date(lastUpdated).toISOString())}` : 'Ready'}
      </span>
      {items.length > 0 && <span>{items.length} items</span>}
      {selected.size > 1 && <span>{selected.size} selected</span>}
      <span className="spacer" />
      {!isTauri && <span>Demo data</span>}
    </div>
  )
}
