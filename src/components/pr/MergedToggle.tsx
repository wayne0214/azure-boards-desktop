/** Under a branch picker: show or hide the branches already merged into the default branch. */
export function MergedToggle({ count, shown, onToggle }: { count: number; shown: boolean; onToggle: () => void }) {
  if (count === 0) return null
  return (
    <button type="button" className="btn sm ghost merged-toggle" onClick={onToggle}>
      {shown ? `Hide ${count} merged branch${count === 1 ? '' : 'es'}` : `Show ${count} merged branch${count === 1 ? '' : 'es'}`}
    </button>
  )
}
