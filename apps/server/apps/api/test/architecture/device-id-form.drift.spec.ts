import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isValidDeviceId, WALNUT_DEVICE_ID_PREFIX } from '@walnut-server/const/app/device'
import { describe, expect, it } from 'vitest'
import { SERVER_ROOT } from './module-graph'

/**
 * `sys_device.device_id` 的形态判据有两份**必然**存在的副本：
 * - 代码侧唯一真源：`libs/const/src/app/device.ts` 的 `isValidDeviceId`（管道 / DeviceGuard /
 *   device-id 签发腿都用它）；
 * - migration 的 CHECK：`apps/api/migrations/1793390000000-DeviceIdFormCheck.ts`。
 *   migration 经 Node 类型剥离加载，拿不到 `@walnut-server/*` 别名 ⇒ 正则只能复制一份。
 *
 * 复制是必然的，**漂移不是**：这条 spec 读 migration 源码，把它的正则与代码判据喂同一组
 * 样本 —— 合法形态两边都过、旧形态（64 位 hex）两边都拒。改了任一侧而忘了另一侧，这里红。
 */
const MIGRATION_FILE = 'apps/api/migrations/1793390000000-DeviceIdFormCheck.ts'

describe('device_id 形态（B5）：migration CHECK 与代码判据同形', () => {
  const source = readFileSync(resolve(SERVER_ROOT, MIGRATION_FILE), 'utf8')

  it('migration 的正则 = WALNUT_DEVICE_ID_PREFIX + 32 位小写 hex', () => {
    const literal = /const DEVICE_ID_REGEX = '([^']+)'/.exec(source)
    expect(literal, `${MIGRATION_FILE} 里找不到 DEVICE_ID_REGEX`).not.toBeNull()

    const pattern = new RegExp(literal![1])
    const valid = `${WALNUT_DEVICE_ID_PREFIX}${'a'.repeat(32)}`
    const legacy = 'a'.repeat(64)

    expect(pattern.test(valid), 'CHECK 正则应当接受服务端签发的形态').toBe(true)
    expect(isValidDeviceId(valid), '代码判据应当接受同一值').toBe(true)

    expect(pattern.test(legacy), 'CHECK 正则必须拒掉旧形态（64 位 hex）').toBe(false)
    expect(isValidDeviceId(legacy), '代码判据必须拒掉旧形态').toBe(false)
  })

  it('cHECK 挂在 sys_device.device_id 上，且带 revert（DROP CONSTRAINT）', () => {
    expect(source).toContain('ALTER TABLE sys_device ADD CONSTRAINT')
    expect(source).toContain('CHECK (device_id ~')
    expect(source).toContain('ALTER TABLE sys_device DROP CONSTRAINT IF EXISTS')
  })
})
