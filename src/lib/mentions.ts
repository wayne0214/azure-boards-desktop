import type { PullRequest } from '@/lib/pr/types'
import type { Identity } from '@/lib/types'

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Replace every "@Display Name" that names a known person. A single pass with the
 * longest names first, so "@Wayne Lai Jia Hao" is never cut short as "@Wayne Lai".
 */
export function replaceMentions(text: string, people: Identity[], fmt: (p: Identity) => string): string {
  const byName = new Map<string, Identity>()
  for (const p of people) if (p.displayName && !byName.has(p.displayName)) byName.set(p.displayName, p)
  if (byName.size === 0) return text
  const names = [...byName.keys()].sort((a, b) => b.length - a.length).map(escRe).join('|')
  const re = new RegExp(`(^|[^\\w])@(${names})(?![\\w])`, 'g')
  return text.replace(re, (_m, pre: string, name: string) => pre + fmt(byName.get(name)!))
}

/** Pull requests picked with "!" in a comment box, so the comment can link to the right repository. */
const knownPrs = new Map<number, { project: string; repo: string }>()
export function rememberPr(pr: Pick<PullRequest, 'pullRequestId' | 'repository'>): void {
  const project = pr.repository?.project?.name
  if (project && pr.repository?.name) knownPrs.set(pr.pullRequestId, { project, repo: pr.repository.name })
}

/**
 * Work item comments are HTML. "@Name" becomes the anchor Azure DevOps recognises as a mention and notifies;
 * "#123" links the work item and "!45" the pull request, the way the Azure DevOps editor writes them.
 */
export function toWorkItemMentionHtml(text: string, people: Identity[], org?: string | null): string {
  let out = replaceMentions(text, people, (p) => `<a href="#" data-vss-mention="version:2.0,${p.id}">@${escHtml(p.displayName)}</a>`)
  if (!org) return out
  const base = `https://dev.azure.com/${encodeURIComponent(org)}`
  out = out.replace(/(^|[^\w&/"])#(\d+)\b/g, (_m, pre: string, id: string) => `${pre}<a href="${base}/_workitems/edit/${id}" data-vss-mention="version:1.0">#${id}</a>`)
  out = out.replace(/(^|[^\w&/"])!(\d+)\b/g, (m, pre: string, id: string) => {
    const pr = knownPrs.get(Number(id))
    if (!pr) return m
    return `${pre}<a href="${base}/${encodeURIComponent(pr.project)}/_git/${encodeURIComponent(pr.repo)}/pullrequest/${id}" data-vss-mention="version:1.0">!${id}</a>`
  })
  return out
}

/** Pull request comments are Markdown; "@<identity id>" is the mention syntax there. */
export const toPrMentions = (text: string, people: Identity[]) => replaceMentions(text, people, (p) => `@<${p.id}>`)

const PR_MENTION = /@<([0-9a-fA-F-]{36})>/g

/** Turn "@<id>" back into "@Display Name" for editing; unknown ids are left alone. */
export function fromPrMentions(text: string, people: Identity[]): string {
  return text.replace(PR_MENTION, (m, id: string) => {
    const p = people.find((x) => x.id.toLowerCase() === id.toLowerCase())
    return p ? `@${p.displayName}` : m
  })
}

/** Same as fromPrMentions but bold, for rendering. */
export function renderPrMentions(text: string | null | undefined, people: Identity[]): string {
  if (!text) return ''
  return text.replace(PR_MENTION, (m, id: string) => {
    const p = people.find((x) => x.id.toLowerCase() === id.toLowerCase())
    return p ? `**@${p.displayName}**` : m
  })
}
