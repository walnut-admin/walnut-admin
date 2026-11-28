// type-only：typeorm 是 CJS 包，本文件经 Node 原生类型剥离按 ESM 加载，具名值导入
// 无法静态解析（cjs-module-lexer 认不出 tslib 星转载出的名字）；类型导入剥离后零运行时依赖。
import type { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * L1（2026-11-27）：锁屏密码「计次 / 退避 / 最近变更」三列 + 一条操作日志取值。
 *
 * ## 为什么加列而不是只放 Redis
 * 本仓既有纪律是「DB 是真源、缓存丢失不得软化安全」（P1-20 的 fail-open 修复口径）。
 * 把爆破预算放 Redis 的话，清一次缓存就重置了计数 —— 等于没有退避。三列：
 *
 * | 列 | 作用 |
 * |---|---|
 * | `lock_pwd_fail_count` | 连续失败次数（成功解锁 / 管理员重置即清零） |
 * | `lock_pwd_locked_until` | 退避截止时间；退避期内一律拒绝（与密码对错无关，避免侧信道） |
 * | `lock_pwd_updated_at` | 最近设置/变更时间（审计 + UI 展示；不是 bcrypt cost 版本号） |
 *
 * 曲线（30s→1m→2m→5m→15m→30m 封顶，5 次失败起）的唯一真源是
 * `libs/identity/src/user_lock/lock-pwd-backoff.ts`；这里只落列，不复制曲线。
 *
 * ## 为什么本文件还改了一条 CHECK
 * 管理员重置锁屏要写审计（Q6），`sys_log_operate.operation` 是 CHECK IN 枚举列 ——
 * 新增取值 `user.lock.reset` 必须同时出现在 `InitSchema`（新库）与本迁移（存量库）里，
 * 否则写入时撞 23514（受控 40000 但操作已经生效，日志丢失）。两边同集由
 * `dto-entity.drift.spec.ts` 的枚举三方守卫机械钉住。
 *
 * 生产未上线 ⇒ 不需要数据回填：存量 `lock_pwd_hash` 为空的行按「未设置密码」处理。
 */

const FK_COLUMNS = [
  `ALTER TABLE sys_user_lock ADD COLUMN IF NOT EXISTS lock_pwd_fail_count integer NOT NULL DEFAULT 0`,
  `ALTER TABLE sys_user_lock ADD COLUMN IF NOT EXISTS lock_pwd_locked_until timestamptz NULL`,
  `ALTER TABLE sys_user_lock ADD COLUMN IF NOT EXISTS lock_pwd_updated_at timestamptz NULL`,
]

const OPERATION_CONSTRAINT = 'ck_log_operate_operation'

const OPERATION_VALUES = [
  'deleted.recover',
  'appMonitorUser.forceQuit',
  'user.updatePassword',
  'user.clearPassword',
  'device.lock',
  'device.unlock',
  'device.ban',
  'device.unban',
  'appSetting.refreshCache',
  'auth.opaque.changePassword',
  'user.lock.reset',
]

const OPERATION_VALUES_BEFORE = OPERATION_VALUES.filter((v) => v !== 'user.lock.reset')

function operationConstraintSql(values: string[]) {
  return `ALTER TABLE sys_log_operate ADD CONSTRAINT ${OPERATION_CONSTRAINT} CHECK (operation IN (${values.map((v) => `'${v}'`).join(', ')}))`
}

const UP_SQL = [
  ...FK_COLUMNS,
  `ALTER TABLE sys_log_operate DROP CONSTRAINT IF EXISTS ${OPERATION_CONSTRAINT}`,
  operationConstraintSql(OPERATION_VALUES),
]

// down 只回滚 schema 形状：`user.lock.reset` 的存量日志行**不删**（数据操作不属于迁移），
// 因此 down 也可能因存量行撞 23514 —— 这是刻意保留的响亮失败：先人工决定日志去留。
const DOWN_SQL = [
  `ALTER TABLE sys_log_operate DROP CONSTRAINT IF EXISTS ${OPERATION_CONSTRAINT}`,
  operationConstraintSql(OPERATION_VALUES_BEFORE),
  `ALTER TABLE sys_user_lock DROP COLUMN IF EXISTS lock_pwd_updated_at`,
  `ALTER TABLE sys_user_lock DROP COLUMN IF EXISTS lock_pwd_locked_until`,
  `ALTER TABLE sys_user_lock DROP COLUMN IF EXISTS lock_pwd_fail_count`,
]

export class UserLockPwdAttempts1793400000000 implements MigrationInterface {
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
