/**
 * `scripts/pg-container.ts` 的平台判断与容器名校验 —— 纯函数部分。
 *
 * 为什么值得钉：win32 走 WSL、其它平台直接 docker 是「命令能不能跑起来」的分界；
 * 容器名会被拼进 WSL 的 bash 命令，白名单松一格就是一个注入面。
 */
import { describe, expect, it } from 'vitest'
import { assertContainerName, resolvePgExecMode, toWslPath } from './pg-container.ts'

describe('resolvePgExecMode', () => {
  it('win32 默认走 WSL 包装', () => {
    expect(resolvePgExecMode('win32', undefined)).toBe('wsl-bash')
  })

  it('linux / darwin 默认直接调 docker CLI', () => {
    expect(resolvePgExecMode('linux', undefined)).toBe('docker-cli')
    expect(resolvePgExecMode('darwin', undefined)).toBe('docker-cli')
  })

  it('`auto` / 空串等价于按平台判断', () => {
    expect(resolvePgExecMode('win32', 'auto')).toBe('wsl-bash')
    expect(resolvePgExecMode('linux', 'auto')).toBe('docker-cli')
    expect(resolvePgExecMode('win32', '  ')).toBe('wsl-bash')
  })

  it('显式覆盖优先于平台（Windows + Docker Desktop 用 docker）', () => {
    expect(resolvePgExecMode('win32', 'docker')).toBe('docker-cli')
    expect(resolvePgExecMode('linux', 'wsl')).toBe('wsl-bash')
    expect(resolvePgExecMode('win32', 'DOCKER-CLI')).toBe('docker-cli')
  })

  it('非法覆盖值按前置条件抛出（不静默回落）', () => {
    expect(() => resolvePgExecMode('win32', 'podman')).toThrow(/E2E_PG_EXEC_MODE/)
  })
})

describe('toWslPath', () => {
  it('windows 盘符路径 → /mnt/<drive>/…', () => {
    expect(toWslPath('D:\\walnut-admin\\walnut-admin\\apps\\e2e\\.e2e\\baseline.dump'))
      .toBe('/mnt/d/walnut-admin/walnut-admin/apps/e2e/.e2e/baseline.dump')
  })

  it('正斜杠形态也换算（WSL 里的 cwd 可能带 /）', () => {
    expect(toWslPath('C:/repo/apps/e2e/x.dump')).toBe('/mnt/c/repo/apps/e2e/x.dump')
  })

  it('已是 POSIX 形态时只做反斜杠归一', () => {
    expect(toWslPath('/tmp/x.dump')).toBe('/tmp/x.dump')
    expect(toWslPath('relative\\path\\x.dump')).toBe('relative/path/x.dump')
  })
})

describe('assertContainerName', () => {
  it('docker 允许的容器名通过', () => {
    for (const name of ['e2e-wsl-postgres', 'e2e-postgres', 'abc_1.2-3', 'a']) {
      expect(() => assertContainerName(name)).not.toThrow()
    }
  })

  it.each([
    ['空串', ''],
    ['以连字符开头', '-bad'],
    ['带空格', 'e2e postgres'],
    ['带 shell 元字符', 'postgres; rm -rf /'],
    ['带引号', 'e2e"postgres'],
    ['带路径分隔符', 'docker/e2e'],
  ])('%s 被拒绝', (_label, name) => {
    expect(() => assertContainerName(name)).toThrow(/E2E_PG_CONTAINER/)
  })
})
