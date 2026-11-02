// type-only：typeorm 是 CJS 包，本文件经 Node 原生类型剥离按 ESM 加载，具名值导入
// 无法静态解析（cjs-module-lexer 认不出 tslib 星转载出的名字）；类型导入剥离后零运行时依赖。
import type { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 拍板-5（设备追踪 P0 批）：`sys_device` 的「无真实浏览器活动的残留行」从此**只标记、
 * 不删除**（新增 `stale boolean NOT NULL DEFAULT false`）。
 *
 * 为什么不再物理删行（原 cron：`updateDeviceActiveStatusForCronJob` → 删行 + 删监控行）：
 * 1. **封禁绕过**：`banned` / `locked` 只存在这一行上，行被删 = 封禁被抹掉；攻击者只要
 *    `POST /app/monitor/user/state {left:true}` → `POST /system/device/initial` → 等一个
 *    cron tick，就能拿到一行干净设备（review P1-1 第 2 条绕过）。
 * 2. **cookie 死锁**：cookie 还在而行没了，DeviceGuard 回源 DB 查不到 ⇒ 40605，且前端
 *    没有重建路径（review P0-1 场景 B）。
 *
 * `stale` 只是「没有真实浏览器活动」的标记，不参与鉴权（DeviceGuard 不读）；设备重新
 * `initial` 时写回 false。索引是给后续「stale 且 updated_at 超过 N 天」的留存清理用的
 * （部分索引只收 stale 行，不膨胀）。
 */
const STALE_INDEX = 'idx_device_stale'

const UP_SQL = [
  `ALTER TABLE sys_device ADD COLUMN IF NOT EXISTS stale boolean NOT NULL DEFAULT false`,
  `CREATE INDEX IF NOT EXISTS ${STALE_INDEX} ON sys_device (updated_at) WHERE stale = true`,
]

const DOWN_SQL = [
  `DROP INDEX IF EXISTS ${STALE_INDEX}`,
  `ALTER TABLE sys_device DROP COLUMN IF EXISTS stale`,
]

export class DeviceStaleFlag1793380000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of UP_SQL) {
      await queryRunner.query(sql)
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const sql of DOWN_SQL) {
      await queryRunner.query(sql)
    }
  }
}
