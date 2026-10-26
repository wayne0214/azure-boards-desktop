import { replaceMentions } from '@/lib/mentions'
import type { Identity } from '@/lib/types'

/** Wiki pages mention people as "@<identity id>", like pull requests. */
const MENTION = /@<([0-9a-zA-Z-]{2,36})>/g

const who = (people: Identity[], id: string) => people.find((p) => p.id.toLowerCase() === id.toLowerCase())

/** People whose display name nobody else has: a shared name cannot say which of them a mention means. */
const named = (people: Identity[]) => people.filter((p) => people.filter((q) => q.displayName === p.displayName).length === 1)

/** "@Display Name" of known people as the wiki's "@<id>", for saving. */
export const toWikiMentions = (text: string, people: Identity[]) => replaceMentions(text, named(people), (p) => `@<${p.id}>`)

/** "@<id>" as "@Display Name", for editing; unknown ids stay as they are. */
export const fromWikiMentions = (text: string, people: Identity[]) => text.replace(MENTION, (m, id: string) => { const p = who(named(people), id); return p ? `@${p.displayName}` : m })

/** Mentions shown as names; the reader's own name stands out. */
export const renderWikiMentions = (text: string, people: Identity[], myId: string | null) =>
  text.replace(MENTION, (_m, id: string) => {
    const p = who(people, id)
    if (!p) return '@someone'
    return myId && p.id.toLowerCase() === myId.toLowerCase() ? `<mark class="wiki-me">@${p.displayName}</mark>` : `**@${p.displayName}**`
  })

export const mentionsOf = (text: string, id: string) => [...text.matchAll(MENTION)].some((m) => m[1].toLowerCase() === id.toLowerCase())
