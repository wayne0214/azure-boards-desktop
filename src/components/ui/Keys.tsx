import { modKey } from '@/lib/format'

export function Keys({ keys }: { keys: string }) {
  const parts = keys.split('+').map((k) => (k === 'Mod' ? modKey : k))
  return (
    <span className="keys">
      {parts.map((p, i) => (
        <kbd key={i}>{p}</kbd>
      ))}
    </span>
  )
}
