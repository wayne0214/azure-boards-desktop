import { describe, expect, it } from 'vitest'
import { buildFileTree, fileOrder, foldersOf, type FileNode } from './fileTree'

const paths = [
  '/src-tauri/src/ado/api.rs',
  '/src-tauri/src/commands.rs',
  '/src-tauri/src/lib.rs',
  '/src/components/mine/MyWorkView.tsx',
  '/src/lib/api.ts',
  '/src/lib/api.mock.ts',
  '/README.md',
]
const tree = buildFileTree(paths.map((path) => ({ path, value: null })))

const outline = (nodes: FileNode<null>[], depth = 0): string[] =>
  nodes.flatMap((n) => [`${'  '.repeat(depth)}${n.kind === 'dir' ? `${n.name}/` : n.name}`, ...(n.kind === 'dir' ? outline(n.children, depth + 1) : [])])

describe('buildFileTree', () => {
  it('lists folders before files and joins single-folder chains into one row', () => {
    expect(outline(tree)).toEqual([
      'src/',
      '  components/mine/',
      '    MyWorkView.tsx',
      '  lib/',
      '    api.mock.ts',
      '    api.ts',
      'src-tauri/src/',
      '  ado/',
      '    api.rs',
      '  commands.rs',
      '  lib.rs',
      'README.md',
    ])
  })

  it('keeps each file\'s full path', () => {
    expect(fileOrder(tree)).toEqual([
      '/src/components/mine/MyWorkView.tsx', '/src/lib/api.mock.ts', '/src/lib/api.ts',
      '/src-tauri/src/ado/api.rs', '/src-tauri/src/commands.rs', '/src-tauri/src/lib.rs', '/README.md',
    ])
  })
})

describe('foldersOf', () => {
  it('names every folder a file sits in, outermost first', () => {
    expect(foldersOf(tree, '/src-tauri/src/ado/api.rs')).toEqual(['/src-tauri/src', '/src-tauri/src/ado'])
    expect(foldersOf(tree, '/src/lib/api.ts')).toEqual(['/src', '/src/lib'])
  })

  it('names none for a file at the top level or not in the tree', () => {
    expect(foldersOf(tree, '/README.md')).toEqual([])
    expect(foldersOf(tree, '/nope.txt')).toEqual([])
  })
})
