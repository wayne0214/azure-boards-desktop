import { avatarHue, initials } from '@/lib/format'

interface Props {
  name?: string | null
  keyName?: string | null
  size?: 'sm' | 'md' | 'lg'
  title?: string
}

export function Avatar({ name, keyName, size = 'md', title }: Props) {
  const cls = `avatar ${size === 'md' ? '' : size}`.trim()
  if (!name) {
    return (
      <span className={`${cls} empty`} title={title ?? 'Unassigned'} aria-label="Unassigned">
        ·
      </span>
    )
  }
  return (
    <span className={cls} style={{ ['--hue' as string]: avatarHue(keyName ?? name) }} title={title ?? name} aria-label={name}>
      {initials(name)}
    </span>
  )
}
