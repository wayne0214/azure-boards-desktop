import { useBoardStore } from '@/store/useBoardStore'
import { useMyWorkStore } from '@/store/useMyWorkStore'
import { usePrStore } from '@/store/usePrStore'
import { useRoomStore } from '@/store/useRoomStore'
import { useReqStore } from '@/store/useReqStore'
import { useTcStore } from '@/store/useTcStore'
import { useTimesheetStore } from '@/store/useTimesheetStore'
import { useUiStore } from '@/store/useUiStore'

const onBoard = () => {
  const v = useUiStore.getState().view
  return v === 'board' || v === 'list'
}

/** Reload what the current section shows (⌘R and the toolbar button). */
export function refreshCurrentView() {
  switch (useUiStore.getState().view) {
    case 'mine': void useMyWorkStore.getState().load(); break
    case 'prs': {
      const pr = usePrStore.getState()
      void pr.loadList()
      void pr.loadInvolved()
      if (pr.selected) void pr.reload()
      break
    }
    case 'timesheet': {
      const ts = useTimesheetStore.getState()
      if (ts.phase === 'ready') void ts.loadWeek()
      break
    }
    case 'rooms': void useRoomStore.getState().load(); break
    case 'reqs': case 'team': void useReqStore.getState().load(); break
    case 'tests': void useReqStore.getState().load(); void useTcStore.getState().load(); break
    default: void useBoardStore.getState().refresh()
  }
}

/** Quiet background refresh: the sidebar counts always, the board only while it is on screen. */
export function refreshInBackground() {
  void useMyWorkStore.getState().load({ silent: true })
  void usePrStore.getState().loadInvolved()
  if (onBoard()) void useBoardStore.getState().refresh({ silent: true })
  if (useUiStore.getState().view === 'prs') void usePrStore.getState().loadList({ silent: true })
  if (useUiStore.getState().view === 'rooms') void useRoomStore.getState().load({ silent: true })
  if (['reqs', 'team', 'tests'].includes(useUiStore.getState().view)) void useReqStore.getState().load({ silent: true })
  if (useUiStore.getState().view === 'tests') void useTcStore.getState().load({ silent: true })
}

/** On window focus, catch up whatever is older than a minute. */
export function refreshOnFocus() {
  const stale = (t: number | null) => t !== null && Date.now() - t > 60000
  if (onBoard() && stale(useBoardStore.getState().lastUpdated)) void useBoardStore.getState().refresh({ silent: true })
  if (stale(useMyWorkStore.getState().lastLoaded)) void useMyWorkStore.getState().load({ silent: true })
  if (stale(usePrStore.getState().involvedAt)) void usePrStore.getState().loadInvolved()
}
