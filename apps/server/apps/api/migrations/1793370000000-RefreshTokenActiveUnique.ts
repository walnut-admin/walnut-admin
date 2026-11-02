// type-only：typeorm 是 CJS 包，本文件经 Node 原生类型剥离按 ESM 加载，具名值导入
// 无法静态解析（cjs-module-lexer 认不出 tslib 星转载出的名字）；类型导入剥离后零运行时依赖。
import type { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * F-26（CQ-010）：`auth_refresh_token` 的「未撤销现役行恒恰一行」不变量此前**只有
 * 应用层约定**（`refresh.shared.service.generateRefreshToken` 是 check-then-act：
 * 先查现役行、再插新行），并发登录可以各插一行 —— 同一 (user_id, device_id) 出现两条
 * `revoked = false`。而 duplicate-signin 判定、force-quit 全量撤销、revoke-and-insert
 * 轮换（旧行撤销 + 新行插入）全都建立在「恰一行」上，行数一旦失真，这些判定会静默
 * 走偏（例如 findActive 命中旧行、撤销腿漏撤现役行）。
 *
 * 本迁移把不变量下沉到 DB：**部分唯一索引**只收未撤销行
 * `UNIQUE (user_id, device_id) WHERE revoked = false`
 * - 只收 `revoked = false`：revoke-and-insert 轮换的历轮旧行都是 `revoked = true`，
 *   不参与索引，多行历史（每轮一行）不受影响；
 * - 与 `uq_jti`（jti 全局唯一）守的是不同维度，两者并存；
 * - 应用侧把冲突（23505）翻译成受控 40109（DuplicateSignIn），索引是最后防线。
 *
 * **存量数据**：本迁移先把同一维度多出来的现役行撤销（保留 `created_at` 最新的一行，
 * reason = `forceQuitOnline` —— 语义就是「多出来的那路会话被强制下线」，其 jti 随行级
 * 撤销永久作废，客户端下次 refresh 会拿到 40102 重新登录，与 duplicate-signin 的既有
 * 行为一致）。不这样做的话 `CREATE UNIQUE INDEX` 会在有脏数据的库上直接失败、把发布
 * 卡在一次无法自动收敛的数据问题上。
 */
const ACTIVE_UNIQUE_INDEX = 'uq_rt_active_device_user'

const UP_SQL = [
  // 1. 存量收敛：同 (user_id, device_id) 只留最新的现役行，其余置撤销（幂等）
  `UPDATE auth_refresh_token
     SET revoked = true, revoke_reason = 'forceQuitOnline'
   WHERE revoked = false
     AND id IN (
       SELECT id FROM (
         SELECT id, row_number() OVER (
           PARTITION BY user_id, device_id
           ORDER BY created_at DESC, id DESC
         ) AS rn
         FROM auth_refresh_token
         WHERE revoked = false
       ) ranked
       WHERE ranked.rn > 1
     )`,

  // 2. 不变量落库（部分唯一索引：只约束现役行）
  `CREATE UNIQUE INDEX ${ACTIVE_UNIQUE_INDEX}
     ON auth_refresh_token (user_id, device_id)
     WHERE revoked = false`,
]

const DOWN_SQL = [
  `DROP INDEX IF EXISTS ${ACTIVE_UNIQUE_INDEX}`,
]

export class RefreshTokenActiveUnique1793370000000 implements MigrationInterface {
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
