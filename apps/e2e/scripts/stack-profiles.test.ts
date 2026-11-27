/**
 * `scripts/stack-profiles.ts` 的契约单测 —— 它是 profile 端口 / 库名 / IP 段 / 锁 key 的
 * **单一真源**，任何一项错位都不只是「测试挂了」：
 *
 * - 库名错位 ⇒ 跨 profile 串写（安全闸 `assertE2eDatabase` 的期望值也来自这里）；
 * - IP 段重叠 ⇒ 同机共享 Redis 时 `risk:rate:ip:*` 桶互相吃 4 次/60s 的额度；
 * - 端口错位 ⇒ 两个 profile 抢同一个后端 / 静态代理；
 * - default 的值必须与改造前逐字一致（零行为变化的判据）。
 */
import { describe, expect, it } from 'vitest'
import {
  E2E_DATABASE_PATTERN,
  E2E_PG_GLOBAL_LOCK_KEY,
  localIpFor,
  NAMED_STACK_PROFILES,
  namedProfileArtifactDirs,
  resolveProfileTestArgs,
  resolveStackProfile,
  STACK_PROFILE_NAMES,
  STACK_PROFILES,
} from './stack-profiles.ts'

describe('profile 表（设计稿 P1-6 的表格逐项对照）', () => {
  it('default 与改造前逐字一致：库 / 端口 / 基线根目录 / 锁 key', () => {
    expect(STACK_PROFILES.default).toMatchObject({
      name: 'default',
      database: 'walnut_e2e',
      backendPort: 3001,
      socketPort: 3002,
      webPort: 4173,
      ipSlot: 0,
      artifactDir: '.e2e',
      authDir: '.auth',
      lockKey: 2026112401,
    })
  })

  it.each([
    ['smoke', 'walnut_e2e_smoke', 3101, 3011, 4181, 1, 2026112402],
    ['risk', 'walnut_e2e_risk', 3102, 3012, 4182, 2, 2026112403],
    ['network', 'walnut_e2e_network', 3103, 3013, 4183, 3, 2026112404],
    ['pages', 'walnut_e2e_pages', 3104, 3014, 4184, 4, 2026112405],
    ['journey', 'walnut_e2e_journey', 3105, 3015, 4185, 5, 2026112406],
  ] as const)('%s 的库 / 端口 / 槽位 / 锁 key', (name, database, backendPort, socketPort, webPort, ipSlot, lockKey) => {
    expect(STACK_PROFILES[name]).toMatchObject({
      name,
      database,
      backendPort,
      socketPort,
      webPort,
      ipSlot,
      artifactDir: `.e2e/${name}`,
      authDir: `.auth/${name}`,
      lockKey,
    })
  })

  it('端口 / 库名在所有 profile 里唯一', () => {
    const profiles = STACK_PROFILE_NAMES.map(name => STACK_PROFILES[name])
    for (const field of ['database', 'backendPort', 'socketPort', 'webPort', 'ipSlot', 'lockKey'] as const) {
      const values = profiles.map(profile => profile[field])
      expect(new Set(values).size, `${field} 在 profile 间重复`).toBe(values.length)
    }
  })

  it('全局锁 key 是 default 的 profile 锁 key（default 不重复抢）', () => {
    expect(E2E_PG_GLOBAL_LOCK_KEY).toBe(STACK_PROFILES.default.lockKey)
    for (const name of NAMED_STACK_PROFILES) {
      expect(STACK_PROFILES[name].lockKey).not.toBe(E2E_PG_GLOBAL_LOCK_KEY)
    }
  })

  it('命名 profile 的基线目录就是 clean.ts 要递归保留的那五个', () => {
    expect(namedProfileArtifactDirs()).toEqual(['.e2e/smoke', '.e2e/risk', '.e2e/network', '.e2e/pages', '.e2e/journey'])
  })
})

describe('resolveStackProfile', () => {
  it('不设 / 空串 / default ⇒ default profile', () => {
    expect(resolveStackProfile(undefined).name).toBe('default')
    expect(resolveStackProfile('').name).toBe('default')
    expect(resolveStackProfile('  ').name).toBe('default')
    expect(resolveStackProfile('default').name).toBe('default')
  })

  it('命名 profile 正常解析（大小写与空白不宽容）', () => {
    expect(resolveStackProfile('smoke').name).toBe('smoke')
    expect(resolveStackProfile('risk').name).toBe('risk')
    expect(resolveStackProfile('network').name).toBe('network')
    expect(resolveStackProfile('pages').name).toBe('pages')
    expect(resolveStackProfile('journey').name).toBe('journey')
    expect(() => resolveStackProfile('Smoke')).toThrow(/E2E_STACK_PROFILE/)
    expect(() => resolveStackProfile('network ')).not.toThrow()
  })

  it('未知值 fail-fast（报错列出可选项，不静默回落 default）', () => {
    expect(() => resolveStackProfile('typo')).toThrow(/不认识/)
    expect(() => resolveStackProfile('typo')).toThrow(/default/)
  })
})

describe('库名形态 E2E_DATABASE_PATTERN', () => {
  it('接收 default 与全部命名 profile 的库名（含扩面的 pages / journey）', () => {
    for (const name of STACK_PROFILE_NAMES) {
      expect(E2E_DATABASE_PATTERN.test(STACK_PROFILES[name].database), name).toBe(true)
    }
  })

  it('拒绝 dev 库与注入形态', () => {
    for (const database of ['walnut_pg', 'walnut_e2e_', 'walnut_e2e_Foo', 'walnut_e2e-1', 'x;DROP DATABASE walnut_pg']) {
      expect(E2E_DATABASE_PATTERN.test(database), database).toBe(false)
    }
  })
})

describe('localIpFor', () => {
  it('default 槽位与改造前的公式逐字一致（seq 0..239）', () => {
    for (let seq = 0; seq < 240; seq++) {
      const legacy = `127.0.${1 + Math.floor(seq / 200)}.${10 + seq}`
      expect(localIpFor(0, seq)).toBe(legacy)
    }
  })

  it('每个 profile 两个 /24：段边界（seq 0 / 199 / 200 / 239）', () => {
    expect(localIpFor(1, 0)).toBe('127.0.11.10')
    expect(localIpFor(1, 199)).toBe('127.0.11.209')
    expect(localIpFor(1, 200)).toBe('127.0.12.210')
    expect(localIpFor(1, 239)).toBe('127.0.12.249')
  })

  it('扩面 profile 的槽位沿用同一公式（pages 41–42、journey 51–52）', () => {
    expect(localIpFor(4, 0)).toBe('127.0.41.10')
    expect(localIpFor(4, 239)).toBe('127.0.42.249')
    expect(localIpFor(5, 0)).toBe('127.0.51.10')
    expect(localIpFor(5, 239)).toBe('127.0.52.249')
  })

  it('跨 profile 的地址集合不重叠（Redis rate 桶不相交的前提）', () => {
    const sets = STACK_PROFILE_NAMES.map((name) => {
      const slot = STACK_PROFILES[name].ipSlot
      return { name, ips: new Set(Array.from({ length: 240 }, (_, seq) => localIpFor(slot, seq))) }
    })
    for (let i = 0; i < sets.length; i++) {
      for (let j = i + 1; j < sets.length; j++) {
        const overlap = [...sets[i]!.ips].filter(ip => sets[j]!.ips.has(ip))
        expect(overlap, `${sets[i]!.name} 与 ${sets[j]!.name} 的 IP 段重叠`).toEqual([])
      }
    }
  })

  it('越界输入抛 RangeError（不是静默回绕）', () => {
    expect(() => localIpFor(0, -1)).toThrow(RangeError)
    expect(() => localIpFor(0, 240)).toThrow(RangeError)
    expect(() => localIpFor(25, 0)).toThrow(RangeError)
    expect(() => localIpFor(0, 1.5)).toThrow(RangeError)
  })
})

describe('resolveProfileTestArgs', () => {
  it('default 原样返回（本地可以跑任意 project / 全量）', () => {
    expect(resolveProfileTestArgs(STACK_PROFILES.default, ['--project=smoke'])).toEqual(['--project=smoke'])
    expect(resolveProfileTestArgs(STACK_PROFILES.default, [])).toEqual([])
  })

  it('命名 profile 没给 --project ⇒ 补同名 project', () => {
    expect(resolveProfileTestArgs(STACK_PROFILES.smoke, ['--grep', '@smoke'])).toEqual(['--grep', '@smoke', '--project=smoke'])
  })

  it('命名 profile 给了同名 project ⇒ 原样返回（两种写法都认）', () => {
    expect(resolveProfileTestArgs(STACK_PROFILES.risk, ['--project=risk'])).toEqual(['--project=risk'])
    expect(resolveProfileTestArgs(STACK_PROFILES.risk, ['--project', 'risk'])).toEqual(['--project', 'risk'])
  })

  it('命名 profile 跑了别的 project ⇒ 前置错误（不让用例跑在别的库上）', () => {
    expect(() => resolveProfileTestArgs(STACK_PROFILES.smoke, ['--project=risk'])).toThrow(/只能跑 --project=smoke/)
    expect(() => resolveProfileTestArgs(STACK_PROFILES.network, ['--project=network', '--project=risk'])).toThrow(/--project=risk/)
    expect(() => resolveProfileTestArgs(STACK_PROFILES.pages, ['--project=journey'])).toThrow(/只能跑 --project=pages/)
    expect(() => resolveProfileTestArgs(STACK_PROFILES.journey, ['--project=pages'])).toThrow(/只能跑 --project=journey/)
  })

  it('扩面 profile 默认补自己的同名 project（CI 的 --project=<p> 与 profile 1:1）', () => {
    expect(resolveProfileTestArgs(STACK_PROFILES.pages, [])).toEqual(['--project=pages'])
    expect(resolveProfileTestArgs(STACK_PROFILES.journey, ['--grep', '@journey'])).toEqual(['--grep', '@journey', '--project=journey'])
  })
})
