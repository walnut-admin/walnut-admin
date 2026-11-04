// type-only：typeorm 是 CJS 包，本文件经 Node 原生类型剥离按 ESM 加载，具名值导入
// 无法静态解析（cjs-module-lexer 认不出 tslib 星转载出的名字）；类型导入剥离后零运行时依赖。
import type { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * B5 收尾：`sys_device.device_id` 的**形态 CHECK** —— 「设备身份由服务端签发」在 schema 里
 * 的落款（本轮唯一一条 DDL）。
 *
 * 为什么需要：形态判据在代码里已有唯一真源（`libs/const/src/app/device.ts` 的
 * `isValidDeviceId`，形如 `/^d1_[0-9a-f]{32}$/`），但代码判据绕得过去 —— 脚本、临时 SQL、
 * 将来漏校验的新写腿都能写进 64 位 hex。CHECK 是**最后一层代码绕不过去**的守卫：写旧形态
 * 拿 23514（可控、带约束名），而不是悄悄铸出一个身份。
 *
 * ## 为什么正则在这里复制一份
 * migration 经 Node 类型剥离加载（见 data-source.cli.ts），拿不到 `@walnut-server/*` 别名；
 * 复制是必然的。两边同形由 `apps/api/src/common/monorepo/device-id-form.drift.spec.ts`
 * 机械钉住（读本文件源码比对 `WALNUT_DEVICE_ID_PREFIX` + 32 位 hex）。
 *
 * ## 跑之前必须先清旧行（**故意不在本 migration 里删数据**）
 * 存量 64 位 hex 行会让 `ADD CONSTRAINT` 直接 23514（dev 库实测：
 * "is violated by some row"）。清理是**数据操作**，走部署前的 pre-step（脚本 + RETURNING 记账），
 * 本 migration 保持 schema-only ⇒ `down` 能真正回到「没有这条约束」的状态。
 * 若把 DELETE 写进 up，`down` 就只能造出「约束没了但数据也回不来」的假可逆。
 *
 * pre-step（`DATABASE_PG_USER`，BYPASSRLS）：
 * ```sql
 * BEGIN;
 * DELETE FROM app_monitor_user
 *  WHERE device_id IN (SELECT device_id FROM sys_device WHERE device_id !~ '^d1_[0-9a-f]{32}$');
 * DELETE FROM sys_device WHERE device_id !~ '^d1_[0-9a-f]{32}$';
 * COMMIT;
 * ```
 * **必须连带删 monitor 行**：`app_monitor_user.visitor_id` 全局唯一（uq_monitor_visitor）且
 * 与 sys_device 之间**没有 FK**（松引用）。只删设备行会留下孤儿指纹 —— 同一浏览器回来是
 * 「新 deviceId + 老 visitor_id」⇒ 首行 insert 撞 23505 ⇒ 40000，那台设备心跳永久坏。
 *
 * 刻意**不做**的两件事（各条的理由就地写清）：
 * - 不加 `fingerprint_hash` 列：全仓 0 消费者，而「指纹必须等于首见值」的硬校验会把
 *   指纹的**合法漂移**（换 GPU 驱动 / 字体 / 窗口尺寸）变成没有自愈路径的永久 40099；
 * - 不加 `ON UPDATE CASCADE`：全仓没有「把 device_id 改成另一个值」的路径，现状 FK 的
 *   23503 是免费的最后防线；换 CASCADE 会把响亮的报错换成「静默改写子表」。
 */
const CONSTRAINT = 'ck_device_device_id_form'

/** 与服务端签发同形：`WALNUT_DEVICE_ID_PREFIX` + 32 位小写 hex（drift spec 钉住两边一致） */
const DEVICE_ID_REGEX = '^d1_[0-9a-f]{32}$'

const UP_SQL = [
  // 不加 IF NOT EXISTS 的等价物（PG 没有 ADD CONSTRAINT IF NOT EXISTS）：重复执行应当报错 ——
  // 那意味着有人手工加过约束，静默跳过会让「schema 从哪来」失去唯一答案。
  `ALTER TABLE sys_device ADD CONSTRAINT ${CONSTRAINT} CHECK (device_id ~ '${DEVICE_ID_REGEX}')`,
]

const DOWN_SQL = [
  `ALTER TABLE sys_device DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`,
]

export class DeviceIdFormCheck1793390000000 implements MigrationInterface {
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
