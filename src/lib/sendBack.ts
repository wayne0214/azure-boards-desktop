import type { SendBackPlan, WorkItemTypeState } from '@/lib/types'

/** Testing found the problem again: an item waiting to be tested, or one already closed, can go back to whoever fixed it. */
export function canSendBack(state: string, category: WorkItemTypeState['category'] | undefined): boolean {
  return /^ready to test$/i.test(state.trim()) || category === 'Completed'
}

/** Why the sheet suggests this person, in a few words. */
export function fixerReason(fixer: NonNullable<SendBackPlan['fixer']>): string {
  if (fixer.detail) return fixer.detail
  return fixer.reason === 'pullRequest' ? 'wrote the linked pull request' : fixer.reason === 'activated' ? 'moved it to Active' : 'held it before you'
}

/** True when rich text has words or an image, not just empty tags. */
export function hasRichContent(html: string): boolean {
  return /<img\b/i.test(html) || html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() !== ''
}
