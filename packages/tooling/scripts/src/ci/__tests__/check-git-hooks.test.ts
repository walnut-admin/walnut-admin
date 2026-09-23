/**
 * `checkGitHooks` —— 在**临时目录**里造出各种钩子形态，验证它真的能分辨
 * 「没装」「不是 lefthook 托管」这两类静默失效（都用 `ok: false` 响亮报出来）。
 *
 * 永不碰真实仓库：repoRoot 由用例给，临时目录在 afterEach 里删掉。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkGitHooks } from '../check-git-hooks.ts'

const HOOKS = ['pre-commit', 'commit-msg', 'pre-push'] as const

let tempDir: string | null = null

/** 造一个临时「仓库根」（只建空目录；`.git` 由各用例自己决定要不要有） */
function makeRepoRoot(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'walnut-git-hooks-'))
  return tempDir
}

function writeHook(repoRoot: string, hook: string, content: string): void {
  const hooksDir = join(repoRoot, '.git', 'hooks')
  mkdirSync(hooksDir, { recursive: true })
  writeFileSync(join(hooksDir, hook), content, 'utf8')
}

const LEFTHOOK_HOOK = '#!/bin/sh\n# LEFTHOOK\nlefthook run pre-commit "$@"\n'
const SIMPLE_GIT_HOOKS_HOOK = '#!/bin/sh\n# SIMPLE_GIT_HOOKS\nexit 0\n'

afterEach(() => {
  if (tempDir)
    rmSync(tempDir, { recursive: true, force: true })
  tempDir = null
})

describe('checkGitHooks', () => {
  it('(a) 完全没有 .git ⇒ ok: true 且给出「跳过检查」的提示（不是失败）', () => {
    const result = checkGitHooks(makeRepoRoot())
    expect(result.ok).toBe(true)
    expect(result.lines.join('\n')).toContain('跳过钩子检查')
  })

  it('(b) 三个钩子都在且都含 LEFTHOOK 标记 ⇒ ok: true', () => {
    const repoRoot = makeRepoRoot()
    for (const hook of HOOKS)
      writeHook(repoRoot, hook, LEFTHOOK_HOOK)

    const result = checkGitHooks(repoRoot)
    expect(result.ok).toBe(true)
    expect(result.lines.join('\n')).toContain('git 钩子已就位（lefthook 托管）')
    for (const hook of HOOKS)
      expect(result.lines.join('\n')).toContain(hook)
  })

  it('(c) 缺一个钩子 ⇒ ok: false，失败文案点名它', () => {
    const repoRoot = makeRepoRoot()
    writeHook(repoRoot, 'pre-commit', LEFTHOOK_HOOK)
    writeHook(repoRoot, 'commit-msg', LEFTHOOK_HOOK)

    const result = checkGitHooks(repoRoot)
    expect(result.ok).toBe(false)
    const text = result.lines.join('\n')
    expect(text).toContain('缺失的钩子文件：pre-push')
    expect(text).toContain('为什么这会静默丢掉门禁')
    expect(text).toContain('lefthook: true')
    expect(text).not.toContain('不是 lefthook 托管的钩子')
  })

  it('(c) 三个都缺 ⇒ 三个都被点名', () => {
    const repoRoot = makeRepoRoot()
    mkdirSync(join(repoRoot, '.git', 'hooks'), { recursive: true })

    const text = checkGitHooks(repoRoot).lines.join('\n')
    for (const hook of HOOKS)
      expect(text).toContain(hook)
    expect(text).toContain('缺失的钩子文件：pre-commit / commit-msg / pre-push')
  })

  it('(d) 钩子是 simple-git-hooks 写的 ⇒ ok: false 且说明「不是 lefthook 托管」', () => {
    const repoRoot = makeRepoRoot()
    writeHook(repoRoot, 'pre-commit', LEFTHOOK_HOOK)
    writeHook(repoRoot, 'commit-msg', LEFTHOOK_HOOK)
    writeHook(repoRoot, 'pre-push', SIMPLE_GIT_HOOKS_HOOK)

    const result = checkGitHooks(repoRoot)
    expect(result.ok).toBe(false)
    const text = result.lines.join('\n')
    expect(text).toContain('不是 lefthook 托管的钩子（内容里没有 LEFTHOOK 标记）：pre-push')
    expect(text).toContain('修法：')
    expect(text).not.toContain('缺失的钩子文件')
  })

  it('(d) 大小写不敏感：内容里出现 lefthook（小写）也算托管', () => {
    const repoRoot = makeRepoRoot()
    for (const hook of HOOKS)
      writeHook(repoRoot, hook, '#!/bin/sh\n# lefthook\nlefthook run pre-commit "$@"\n')
    expect(checkGitHooks(repoRoot).ok).toBe(true)
  })
})
