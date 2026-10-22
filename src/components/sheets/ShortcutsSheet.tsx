import { Keys } from '@/components/ui/Keys'
import { Sheet } from '@/components/ui/Sheet'
import { useUiStore } from '@/store/useUiStore'

const groups: { title: string; items: [string, string][] }[] = [
  { title: 'General', items: [['Go to anything', 'Mod+K'], ['New work item', 'Mod+N'], ['Refresh', 'Mod+R'], ['Find on board', 'Mod+F'], ['Settings', 'Mod+,'], ['This list', 'Mod+/']] },
  { title: 'View', items: [['Board', 'Mod+1'], ['List', 'Mod+2'], ['My Work', 'Mod+3'], ['Toggle sidebar', 'Mod+Shift+S'], ['Toggle details', 'Mod+I'], ['Bigger text', 'Mod+='], ['Smaller text', 'Mod+-']] },
  { title: 'Items', items: [['Move selection', '← ↑ → ↓'], ['Open details', 'Enter'], ['Select several', 'Mod+Click'], ['Select a range (list)', 'Shift+Click'], ['Assign to me', 'Mod+Shift+M'], ['Copy link', 'Mod+Shift+C'], ['Recycle bin', 'Mod+⌫'], ['Deselect / close', 'Esc']] },
  { title: 'Editing', items: [['Save comment', 'Mod+Enter'], ['Finish description', 'Mod+Enter'], ['Cancel edit', 'Esc'], ['Import CSV', 'Mod+Shift+I'], ['Export CSV', 'Mod+Shift+E']] },
]

export function ShortcutsSheet() {
  const closeSheet = useUiStore((s) => s.closeSheet)
  return (
    <Sheet title="Keyboard shortcuts" onClose={closeSheet}>
      <div className="shortcut-grid">
        {groups.map((g) => (
          <div key={g.title}>
            <div className="section-h" style={{ marginTop: 6 }}>{g.title}</div>
            {g.items.map(([label, keys]) => (
              <div key={label} className="sc"><span>{label}</span><Keys keys={keys} /></div>
            ))}
          </div>
        ))}
      </div>
    </Sheet>
  )
}
