/**
 * `scripts/stack.ts` 的纯函数：形态判定、容器名映射、compose argv 拼装。
 *
 * 为什么值得钉：WSL 形态要把 `D:\…` 换成 `/mnt/d/…` 再塞进 `bash -c`；槽位 / 映射错一位，
 * `down` 就会去停另一份 compose（或根本没在跑的项目），而症状只是「命令跑成功了但栈还在」。
 */
import { describe, expect, it } from 'vitest'
import {
  composeArgv,
  GENERIC_PG_CONTAINER,
  GENERIC_REDIS_CONTAINER,
  resolveStackShape,
  stackTargetOf,
  statusExitCode,
  WSL_PG_CONTAINER,
  WSL_REDIS_CONTAINER,
} from './stack.ts'

describe('resolveStackShape', () => {
  it('win32 默认 WSL 常驻栈，原生平台默认通用栈', () => {
    expect(resolveStackShape('win32', undefined, undefined)).toBe('wsl')
    expect(resolveStackShape('linux', undefined, undefined)).toBe('generic')
    expect(resolveStackShape('darwin', undefined, undefined)).toBe('generic')
  })

  it('开关 E2E_PG_EXEC_MODE 覆盖平台判断', () => {
    expect(resolveStackShape('win32', 'docker', undefined)).toBe('generic')
    expect(resolveStackShape('linux', 'wsl', undefined)).toBe('wsl')
  })

  it('显式容器名优先：通用 compose 的容器名 ⇒ 通用栈', () => {
    expect(resolveStackShape('win32', undefined, GENERIC_PG_CONTAINER)).toBe('generic')
    expect(resolveStackShape('linux', undefined, WSL_PG_CONTAINER)).toBe('wsl')
  })

  it('非法 E2E_PG_EXEC_MODE 按前置错误抛出（不静默回落）', () => {
    expect(() => resolveStackShape('win32', 'podman', undefined)).toThrow(/E2E_PG_EXEC_MODE/)
  })
})

describe('stackTargetOf', () => {
  it('容器名 / compose 项目与两份 compose 逐字对齐', () => {
    const wsl = stackTargetOf('wsl', 'wsl-bash')
    expect(wsl).toMatchObject({
      shape: 'wsl',
      projectName: 'walnut-e2e-wsl',
      pgContainer: WSL_PG_CONTAINER,
      redisContainer: WSL_REDIS_CONTAINER,
      execMode: 'wsl-bash',
    })
    expect(wsl.composeFile.endsWith('docker-compose.wsl.yml')).toBe(true)

    const generic = stackTargetOf('generic', 'docker-cli')
    expect(generic).toMatchObject({
      shape: 'generic',
      projectName: 'walnut-e2e',
      pgContainer: GENERIC_PG_CONTAINER,
      redisContainer: GENERIC_REDIS_CONTAINER,
      execMode: 'docker-cli',
    })
    expect(generic.composeFile.endsWith('docker-compose.yml')).toBe(true)
  })

  it('开关 E2E_PG_CONTAINER 只覆盖 PG 容器名，Redis 跟随 compose 文件', () => {
    const target = stackTargetOf('wsl', 'wsl-bash', 'my-postgres')
    expect(target.pgContainer).toBe('my-postgres')
    expect(target.redisContainer).toBe(WSL_REDIS_CONTAINER)
  })
})

describe('statusExitCode', () => {
  it('默认恒 0（只读报告：有 FAIL 也不拦）', () => {
    expect(statusExitCode(false, [])).toBe(0)
    expect(statusExitCode(false, ['PG 连不上'])).toBe(0)
  })

  it('--strict：任一健康项 FAIL ⇒ 1；全绿 ⇒ 0', () => {
    expect(statusExitCode(true, [])).toBe(0)
    expect(statusExitCode(true, ['PG 连不上'])).toBe(1)
  })
})

describe('composeArgv', () => {
  it('docker-cli：argv 直传，路径保持绝对 Windows / POSIX 形态', () => {
    const target = stackTargetOf('generic', 'docker-cli')
    expect(composeArgv(target, ['up', '-d'])).toEqual(['docker', 'compose', '-f', target.composeFile, 'up', '-d'])
  })

  it('wsl-bash：经 `wsl -e bash -c`，compose 路径换成 /mnt/… 并用单引号包住', () => {
    const target = stackTargetOf('wsl', 'wsl-bash')
    const argv = composeArgv(target, ['down'])
    expect(argv.slice(0, 4)).toEqual(['wsl', '-e', 'bash', '-c'])
    const script = argv[4]!
    expect(script).toMatch(/^docker compose -f '.+' down$/)
    expect(script).not.toContain('\\')
    if (target.composeFile.includes(':')) {
      expect(script).toContain('\'/mnt/')
    }
  })
})
