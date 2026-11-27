/**
 * `scripts/clean.ts` 的计划与删除面：**保留名单**与「只删直接子项」的路径闸。
 *
 * 为什么值得钉：`rmSync(recursive)` 的破坏面太大 —— 保留名单少一条就会把封板三件套删掉
 * （下一轮退回全量 prepare），路径闸松一格就会删到 `.e2e` 之外。这里用临时目录验证，
 * 不碰真实的 `apps/e2e/.e2e`。
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyCleanPlan, buildCleanPlan, KEPT_ARTIFACTS, PROFILE_ARTIFACT_DIRS } from './clean.ts'

const temps: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'walnut-e2e-clean-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of temps) {
    rmSync(dir, { recursive: true, force: true })
  }
  temps.length = 0
})

describe('buildCleanPlan', () => {
  it('保留基线三件套与 stack.json，其余文件 / 目录按体积与文件数统计', () => {
    const dir = tempDir()
    for (const name of KEPT_ARTIFACTS) {
      writeFileSync(path.join(dir, name), 'x')
    }
    writeFileSync(path.join(dir, 'debug.log'), 'abc')
    mkdirSync(path.join(dir, 'trace-u8'))
    writeFileSync(path.join(dir, 'trace-u8', 'a.json'), '{}')
    writeFileSync(path.join(dir, 'trace-u8', 'b.json'), '{}')

    const plan = buildCleanPlan(dir)

    expect(plan.kept).toEqual([...KEPT_ARTIFACTS].sort())
    expect(plan.removable.map((entry) => entry.name)).toEqual(['debug.log', 'trace-u8'])
    expect(plan.removable.find((entry) => entry.name === 'trace-u8')?.kind).toBe('dir')
    expect(plan.removable.find((entry) => entry.name === 'trace-u8')?.files).toBe(2)
    expect(plan.removableFiles).toBe(3)
    expect(plan.removableBytes).toBe(3 + 2 + 2)
  })

  it('目录不存在 → 空计划（首次运行 / 清过目录）', () => {
    const dir = path.join(tempDir(), 'missing')
    expect(buildCleanPlan(dir)).toEqual({
      dir,
      removable: [],
      kept: [],
      removableBytes: 0,
      removableFiles: 0,
    })
  })

  it('空目录 → 既没有可删项也没有保留项', () => {
    const plan = buildCleanPlan(tempDir())
    expect(plan.removable).toEqual([])
    expect(plan.kept).toEqual([])
  })

  it('命名 profile 子目录递归：保留各自的基线三件套与 stack.json，其余照删', () => {
    const dir = tempDir()
    for (const profile of PROFILE_ARTIFACT_DIRS) {
      const profileDir = path.join(dir, profile)
      mkdirSync(profileDir)
      for (const name of KEPT_ARTIFACTS) {
        writeFileSync(path.join(profileDir, name), 'x')
      }
      writeFileSync(path.join(profileDir, 'debug.log'), 'abc')
    }

    const plan = buildCleanPlan(dir)

    expect(plan.kept).toEqual(
      PROFILE_ARTIFACT_DIRS.flatMap((profile) =>
        KEPT_ARTIFACTS.map((name) => `${profile}/${name}`),
      ).sort(),
    )
    expect(plan.removable.map((entry) => entry.name)).toEqual(
      PROFILE_ARTIFACT_DIRS.map((profile) => `${profile}/debug.log`).sort(),
    )
    expect(plan.removableBytes).toBe(PROFILE_ARTIFACT_DIRS.length * 3)
  })
})

describe('applyCleanPlan', () => {
  it('只删计划里的条目；保留项与目录外的文件不动', () => {
    const dir = tempDir()
    const outside = tempDir()
    writeFileSync(path.join(outside, 'keep.txt'), 'x')
    writeFileSync(path.join(dir, 'baseline.dump'), 'x')
    writeFileSync(path.join(dir, 'debug.log'), 'x')

    applyCleanPlan(buildCleanPlan(dir))

    expect(existsSync(path.join(dir, 'debug.log'))).toBe(false)
    expect(existsSync(path.join(dir, 'baseline.dump'))).toBe(true)
    expect(existsSync(path.join(outside, 'keep.txt'))).toBe(true)
  })

  it('拒绝删除保留项（即使计划被手工构造）', () => {
    const dir = tempDir()
    writeFileSync(path.join(dir, 'baseline.dump'), 'x')
    const plan = buildCleanPlan(dir)
    plan.removable = [
      {
        path: path.join(dir, 'baseline.dump'),
        name: 'baseline.dump',
        kind: 'file',
        bytes: 1,
        files: 1,
      },
    ]

    expect(() => applyCleanPlan(plan)).toThrow(/拒绝清理/)
    expect(existsSync(path.join(dir, 'baseline.dump'))).toBe(true)
  })

  it('拒绝删除不在目录直接子项里的路径', () => {
    const dir = tempDir()
    const outside = tempDir()
    writeFileSync(path.join(outside, 'keep.txt'), 'x')
    const plan = buildCleanPlan(dir)
    plan.removable = [
      { path: path.join(outside, 'keep.txt'), name: 'keep.txt', kind: 'file', bytes: 1, files: 1 },
    ]

    expect(() => applyCleanPlan(plan)).toThrow(/拒绝清理/)
    expect(existsSync(path.join(outside, 'keep.txt'))).toBe(true)
  })

  it('允许删 profile 子目录的直接子项（plan 由 buildCleanPlan 生成）', () => {
    const dir = tempDir()
    const profileDir = path.join(dir, PROFILE_ARTIFACT_DIRS[0]!)
    mkdirSync(profileDir)
    writeFileSync(path.join(profileDir, 'baseline.dump'), 'x')
    writeFileSync(path.join(profileDir, 'debug.log'), 'x')

    applyCleanPlan(buildCleanPlan(dir))

    expect(existsSync(path.join(profileDir, 'debug.log'))).toBe(false)
    expect(existsSync(path.join(profileDir, 'baseline.dump'))).toBe(true)
  })

  it('拒绝删 profile 子目录里的保留文件（即使计划被手工构造）', () => {
    const dir = tempDir()
    const profileDir = path.join(dir, PROFILE_ARTIFACT_DIRS[0]!)
    mkdirSync(profileDir)
    writeFileSync(path.join(profileDir, 'baseline.dump'), 'x')
    const plan = buildCleanPlan(dir)
    plan.removable = [
      {
        path: path.join(profileDir, 'baseline.dump'),
        name: `${PROFILE_ARTIFACT_DIRS[0]}/baseline.dump`,
        kind: 'file',
        bytes: 1,
        files: 1,
      },
    ]

    expect(() => applyCleanPlan(plan)).toThrow(/拒绝清理/)
    expect(existsSync(path.join(profileDir, 'baseline.dump'))).toBe(true)
  })
})
