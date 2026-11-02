// type-only：typeorm 是 CJS 包，本文件经 Node 原生类型剥离按 ESM 加载，具名值导入
// 无法静态解析（cjs-module-lexer 认不出 tslib 星转载出的名字）；类型导入剥离后零运行时依赖。
import type { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 组织基础表 —— `sys_dept`（部门树）/ `sys_post`（岗位）/ `sys_employee`（职工）。
 *
 * 结构真源：`apps/docs/src/zh-CN/content/plans/data-scope-design.md` §4（二期部门维度）与
 * `apps/docs/src/zh-CN/content/plans/postgres-migration-phase2.md` §2（通用约定 / FK 政策 / 索引策略）。
 * 三张表都是**新增表**，既有 `InitSchema` 是历史基线，一字不动（schema.md §4 纪律）。
 *
 * 设计口径（落地时逐条推导，与数据结构一一对应）：
 * - 部门树是**邻接表 + 递归 CTE**（同 area 批定案）：`ancestors` 逗号路径串不做 —— 移动部门
 *   无级联写放大，子树查询走 `WITH RECURSIVE ... CYCLE`（PG 14+ 环保护），索引服务
 *   `parent_id` 按层展开。`parent_id` 自引用 FK **ON DELETE RESTRICT**（对齐 sys_menu.pid
 *   的 Q6 定案：防误删静默扩面，子树处理在应用层）。
 * - 岗位是平表，无树、无自引用。
 * - 职工与登录账号（sys_user）**分离**：职工可以暂无账号。`user_id` 是**唯一可空松引用**
 *   —— partial unique（`WHERE user_id IS NOT NULL`）保证「一号一职工」，**不建 FK**
 *   （账号彻底删除不应级联销毁人事记录，对齐 phase2 2.4-3 的审计/松引用口径）。
 * - `dept_id` / `post_id` 都是 RESTRICT：有职工的部门/岗位不许删，删除前由应用层给受控错误
 *   （FK 是最后防线）。职工未定岗时 `post_id` 为 NULL。
 * - 岗位挂职工上（单岗直挂），不建 `sys_employee_post` junction —— 见模块服务注释与交付报告
 *   的选型说明：本批先落「一职工一岗」的简单形态，确有多岗诉求再拆 junction。
 * - 字符串枚举一律 `varchar + CHECK`（phase2 2.2：原生 ENUM 的取值变更要走 ALTER TYPE）。
 * - 时间列由 TypeORM CreateDate/UpdateDateColumn 维护，列级 `DEFAULT now()` 兜底；
 *   不部署触发器（phase2 5.4）。
 *
 * 约束命名规约：`pk_<table>` / `fk_<table>_<col>` / `ck_<table>_<col>` / 唯一与普通索引用
 * 登记名（`uq_*` / `idx_*`）。up/down 对称可逆（global-setup 会做 undo 全量回滚验证）。
 */

/** up 的 DDL 语句（单数组按序执行；down 反序 DROP） */
export const ORG_FOUNDATION_UP: string[] = [
  // ============================================================
  // 1. sys_dept —— 部门（自引用树）
  // ============================================================
  `CREATE TABLE sys_dept (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    parent_id uuid NULL,
    dept_code varchar(64) NOT NULL,
    dept_name text NOT NULL,
    leader text NULL,
    phone text NULL,
    email text NULL,
    sort_order integer NOT NULL DEFAULT 0,
    status varchar(16) NOT NULL DEFAULT 'enabled',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_sys_dept PRIMARY KEY (id),
    CONSTRAINT fk_dept_parent FOREIGN KEY (parent_id) REFERENCES sys_dept (id) ON DELETE RESTRICT,
    CONSTRAINT ck_dept_status CHECK (status IN ('enabled', 'disabled'))
  )`,
  'CREATE UNIQUE INDEX uq_dept_code ON sys_dept (dept_code)',
  // partial index：根节点 parent_id 为 NULL，全量表索引无意义（对齐 idx_menu_pid）
  'CREATE INDEX idx_dept_parent ON sys_dept (parent_id) WHERE "parent_id" IS NOT NULL',

  // ============================================================
  // 2. sys_post —— 岗位（平表）
  // ============================================================
  `CREATE TABLE sys_post (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    post_code varchar(64) NOT NULL,
    post_name text NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    status varchar(16) NOT NULL DEFAULT 'enabled',
    remark text NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_sys_post PRIMARY KEY (id),
    CONSTRAINT ck_post_status CHECK (status IN ('enabled', 'disabled'))
  )`,
  'CREATE UNIQUE INDEX uq_post_code ON sys_post (post_code)',
  'CREATE INDEX idx_post_status ON sys_post (status)',

  // ============================================================
  // 3. sys_employee —— 职工（人事记录，与登录账号分离）
  // ============================================================
  `CREATE TABLE sys_employee (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    employee_no varchar(64) NOT NULL,
    employee_name text NOT NULL,
    dept_id uuid NOT NULL,
    post_id uuid NULL,
    user_id uuid NULL,
    entry_date timestamptz NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_sys_employee PRIMARY KEY (id),
    CONSTRAINT fk_employee_dept FOREIGN KEY (dept_id) REFERENCES sys_dept (id) ON DELETE RESTRICT,
    CONSTRAINT fk_employee_post FOREIGN KEY (post_id) REFERENCES sys_post (id) ON DELETE RESTRICT,
    CONSTRAINT ck_employee_status CHECK (status IN ('probation', 'active', 'resigned'))
  )`,
  'CREATE UNIQUE INDEX uq_employee_no ON sys_employee (employee_no)',
  // 「一号一职工」：绑定后的 user_id 全库唯一；NULL（未绑账号）不受限
  'CREATE UNIQUE INDEX uq_employee_user ON sys_employee (user_id) WHERE "user_id" IS NOT NULL',
  'CREATE INDEX idx_employee_dept ON sys_employee (dept_id)',
  // FK 反查（岗位删除前计数、按岗位列职工）—— PG 的 FK 不自动建索引（phase2 2.5）
  'CREATE INDEX idx_employee_post ON sys_employee (post_id) WHERE "post_id" IS NOT NULL',
]

export const ORG_FOUNDATION_DOWN: string[] = [
  'DROP TABLE IF EXISTS sys_employee',
  'DROP TABLE IF EXISTS sys_post',
  'DROP TABLE IF EXISTS sys_dept',
]

export class OrgFoundation1793320975988 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of ORG_FOUNDATION_UP) {
      await queryRunner.query(sql)
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const sql of ORG_FOUNDATION_DOWN) {
      await queryRunner.query(sql)
    }
  }
}
