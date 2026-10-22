import { api, type ToolLine } from '../api'
import { branchName } from './types'

const key = (repoId: string) => `gt.repo.${repoId}`

export function getRepoPath(repoId: string): string | null {
  try { return localStorage.getItem(key(repoId)) } catch { return null }
}
export function setRepoPath(repoId: string, path: string) {
  try { localStorage.setItem(key(repoId), path) } catch { /* ignore */ }
}
export function getGitToolsBin(): string {
  try { return localStorage.getItem('gt.bin') || 'git-tools' } catch { return 'git-tools' }
}
export function setGitToolsBin(bin: string) {
  try { localStorage.setItem('gt.bin', bin) } catch { /* ignore */ }
}

export interface Generated {
  title: string
  description: string
  raw: string
}

// Work item details git-tools appends after the description ("Labels: feature", "Size: XL"…); they are not PR text.
const TRAILER = /^(labels?|priority|size|estimate|effort|story points|type)\s*:/i

/** Drop the trailing block of known `Key: value` lines. */
function withoutTrailer(text: string): string {
  const lines = text.split('\n')
  let end = lines.length
  while (end > 0 && (TRAILER.test(lines[end - 1].trim()) || (lines[end - 1].trim() === '' && end < lines.length))) end--
  return lines.slice(0, end).join('\n').trim()
}

/** A line as a terminal would finally show it: no colour or cursor codes, and only the last frame a spinner drew over itself. */
export function cleanToolLine(text: string): string {
  // eslint-disable-next-line no-control-regex
  const plain = text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
  const frames = plain.split('\r').filter((f) => f.trim() !== '')
  return (frames[frames.length - 1] ?? '').trimEnd()
}

const cleanTitle = (t: string) => t.trim().replace(/^[`"']|[`"']$/g, '').trim()

/** Split git-tools' PR text into a title and a description. */
export function parsePrText(raw: string): Generated {
  const text = withoutTrailer(raw.replace(/\r\n/g, '\n').trim())
  // "## Title: feat: …" on one line, everything after it is the description.
  const line = text.match(/^[ \t]*(?:#+[ \t]*)?\**title\**[ \t]*:[ \t]*\**[ \t]*(\S.*)$/im)
  if (line && text.slice(0, line.index).trim() === '') {
    return { title: cleanTitle(line[1]), description: text.slice((line.index ?? 0) + line[0].length).trim(), raw }
  }
  const m = text.match(/^\s*(?:#+\s*)?title\s*:?\s*\n?(.+?)\n+(?:#+\s*)?description\s*:?\s*\n([\s\S]*)$/i)
  if (m) return { title: cleanTitle(m[1]), description: m[2].trim(), raw }
  const lines = text.split('\n')
  const first = (lines[0] ?? '').replace(/^#+\s*/, '').trim()
  if (first && first.length <= 140 && lines.length > 1) {
    return { title: first, description: lines.slice(1).join('\n').trim(), raw }
  }
  return { title: '', description: text, raw }
}

export interface GenerateOptions {
  repoId: string
  sourceRef: string
  targetRef: string
  context?: string
  /** Called when the local checkout is on a different branch; return true to continue anyway. */
  confirmBranch?: (current: string, wanted: string) => boolean | Promise<boolean>
  /** Each line git-tools prints, as it prints it. */
  onOutput?: (line: ToolLine) => void
  /** Cancelled before git-tools starts: it is not started at all. */
  signal?: AbortSignal
}

/** Run git-tools pr in the repository's local checkout and return the parsed text. */
export async function generatePrText(opts: GenerateOptions): Promise<Generated> {
  // Each step before git-tools itself says what it is waiting on, so a slow start is never a silent one.
  const note = (text: string) => opts.onOutput?.({ stream: 'stdout', text })
  let path = getRepoPath(opts.repoId)
  if (!path) {
    note('Choose the local folder of this repository…')
    path = await api().pickFolder()
    if (!path) throw new Error('cancelled')
    setRepoPath(opts.repoId, path)
  }
  note(`Checking the branch checked out in ${path}…`)
  const current = await api().gitCurrentBranch(path)
  const wanted = branchName(opts.sourceRef)
  if (current !== wanted && opts.confirmBranch) {
    note(`The checkout is on ${current}, not ${wanted}; waiting for your answer…`)
    if (!(await opts.confirmBranch(current, wanted))) throw new Error('cancelled')
  }
  const args = ['pr', '--base', branchName(opts.targetRef), '--source', 'b']
  if (opts.context) args.push('--context', opts.context)
  if (opts.signal?.aborted) throw new Error('cancelled')
  note(`$ ${getGitToolsBin()} ${args.join(' ')}`)
  const run = await api().runGitTools(path, getGitToolsBin(), args, opts.onOutput)
  if (run.code !== 0 && !run.clipboard) {
    const msg = (run.stderr || run.stdout).trim().split('\n').slice(-3).join('\n')
    throw new Error(msg || `git-tools exited with code ${run.code}`)
  }
  const raw = run.clipboard ?? run.stdout
  if (!raw.trim()) throw new Error('git-tools produced no text. Is a provider API key configured (git-tools settings)?')
  return parsePrText(raw)
}
