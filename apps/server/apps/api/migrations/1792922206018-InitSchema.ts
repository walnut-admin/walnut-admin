// type-only：typeorm 是 CJS 包，本文件经 Node 原生类型剥离按 ESM 加载，具名值导入
// 无法静态解析（cjs-module-lexer 认不出 tslib 星转载出的名字）；类型导入剥离后零运行时依赖。
import type { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 初始 schema —— 26 表全量 DDL（24 主表 + sys_user_role / sys_role_menu 两张关联表）。
 *
 * 结构真源：`docs/plans/postgres-migration-phase2.md`（2026-10-25 全部拍板定稿）。
 * 本文件是该设计的可执行形态，逐列 / 逐索引 / 逐约束对齐；列数 298、jsonb 17、
 * 索引 82（含 PK 与唯一索引）、FK 17，口径见文档第 1 节总览。
 *
 * 手写而非 `migration:generate` 产出的原因（phase2 第 6 节）：partial unique index（WHERE 子句）、
 * CHECK 约束、pg_trgm GIN、FK 的 on delete 行为、关联表的复合 PK —— 这几类 generate 不可靠。
 * 约束命名规约：`pk_<table>` / `fk_<table>_<col>` / `ck_<table>_<col>` / 唯一与普通索引用文档
 * 登记名（`uq_*` / `idx_*`）。
 *
 * 顺序尊重 FK 依赖：无依赖表（含被引用的 sys_role / sys_device）→ sys_user → sys_menu（自引用）
 * → 关联表 → 从属表 → 日志 / 审计 / 会话表。down 完整可逆（反序 DROP TABLE + DROP EXTENSION）。
 *
 * 与文档字面不一致、按 const 为准落地的两处（详见 B0a 交付报告与 review 修订）：
 * - sys_log_operate.operation：文档写 varchar(16)，但注明「以 const 为准生成」，const 最长值
 *   25 字符 → 按 const 口径放宽 varchar(32)，CHECK 取全部 10 个 const 值；
 * - sys_log_operate.action_type：CHECK 取全部 10 个 const 值（含文档漏掉的 REFRESH / AUTH
 *   —— 少这两个会让 B8 迁移操作日志时写 REFRESH/AUTH 日志直接违反约束）。
 */
/**
 * up 的 DDL 段落。每段是一个数组，flat 后按顺序执行：
 * 扩展 → 无依赖表 → sys_user → sys_menu → 关联表 → 从属表 → 日志/审计/会话表。
 */
const UP_SECTIONS: string[][] = [
  // ============================================================
  // 0. 扩展依赖（pg_trgm：PG 18 trusted extension，无需超级用户；phase2 第 6 节）
  // ============================================================
  [
    'CREATE EXTENSION IF NOT EXISTS pg_trgm',
  ],

  // ============================================================
  // 1. 无依赖表
  // ============================================================
  [
    // phase2 4.2 sys_role（7 列 / 3 索引）
    `CREATE TABLE sys_role (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      role_name text NOT NULL,
      description text NULL,
      sort_order integer NULL,
      status boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_sys_role PRIMARY KEY (id)
    )`,
    'CREATE UNIQUE INDEX uq_role_name ON sys_role (role_name)',
    'CREATE INDEX idx_role_created_at ON sys_role (created_at DESC)',
  ],
  [
    // phase2 4.18 shared_area（4 列 / 3 索引；timestamps: false，pcode 不建 FK —— Q6/Q12 定案）
    `CREATE TABLE shared_area (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      code varchar(12) NOT NULL,
      name text NOT NULL,
      pcode varchar(12) NOT NULL,
      CONSTRAINT pk_shared_area PRIMARY KEY (id)
    )`,
    'CREATE UNIQUE INDEX uq_area_code ON shared_area (code)',
    'CREATE INDEX idx_area_pcode ON shared_area (pcode)',
  ],
  [
    // phase2 4.4 sys_lang（7 列 / 2 索引；lang 按 Q2 定案补 UNIQUE）
    `CREATE TABLE sys_lang (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      lang varchar(16) NOT NULL,
      description text NULL,
      sort_order integer NULL,
      status boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_sys_lang PRIMARY KEY (id)
    )`,
    'CREATE UNIQUE INDEX uq_lang ON sys_lang (lang)',
  ],
  [
    // phase2 4.6 sys_dict_type（7 列 / 3 索引）
    `CREATE TABLE sys_dict_type (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      name text NOT NULL,
      type text NOT NULL,
      status boolean NOT NULL DEFAULT true,
      description text NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_sys_dict_type PRIMARY KEY (id)
    )`,
    'CREATE UNIQUE INDEX uq_dict_type ON sys_dict_type (type)',
    'CREATE INDEX idx_dict_type_created_at ON sys_dict_type (created_at DESC)',
  ],
  [
    // phase2 4.19 app_setting（9 列 / 2 索引；created_by 为 Q4 定案新增列，松引用不建 FK）
    `CREATE TABLE app_setting (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      setting_name text NOT NULL,
      setting_key text NOT NULL,
      setting_value text NOT NULL,
      setting_type varchar(16) NOT NULL,
      remark text NULL,
      created_by uuid NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_app_setting PRIMARY KEY (id),
      CONSTRAINT ck_app_setting_type CHECK (setting_type IN ('auth', 'global', 'functional'))
    )`,
    'CREATE UNIQUE INDEX uq_setting_key ON app_setting (setting_key)',
  ],
  [
    // phase2 4.20 app_demo（17 列 / 3 索引；数组列 NOT NULL 无 DB 默认，应用侧显式给值）
    `CREATE TABLE app_demo (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      demo_string text NULL,
      demo_phone_number text NULL,
      demo_string_array text[] NOT NULL,
      demo_number integer NULL,
      demo_number_array integer[] NOT NULL,
      demo_boolean boolean NOT NULL DEFAULT false,
      demo_boolean_array boolean[] NOT NULL,
      demo_date timestamptz NULL,
      demo_date_array timestamptz[] NOT NULL,
      demo_enum smallint NOT NULL DEFAULT 1,
      demo_enum_array smallint[] NOT NULL,
      demo_uuid uuid NULL,
      demo_uuid_array uuid[] NOT NULL,
      demo_object jsonb NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_app_demo PRIMARY KEY (id),
      CONSTRAINT ck_app_demo_enum CHECK (demo_enum IN (1, 2, 3, 4))
    )`,
    'CREATE UNIQUE INDEX uq_demo_string ON app_demo (demo_string)',
    'CREATE UNIQUE INDEX uq_demo_phone_number ON app_demo (demo_phone_number)',
  ],
  [
    // phase2 4.23 app_key（11 列 / 3 索引）
    `CREATE TABLE app_key (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      key text NOT NULL,
      type varchar(16) NOT NULL,
      version integer NOT NULL,
      status varchar(16) NOT NULL DEFAULT 'ACTIVE',
      valid_start timestamptz NOT NULL,
      valid_end timestamptz NULL,
      rotate_after timestamptz NULL,
      meta jsonb NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_app_key PRIMARY KEY (id),
      CONSTRAINT ck_app_key_type CHECK (type IN ('RSA_PAIR', 'AES_KEY_URL', 'JWT_AT', 'JWT_RT')),
      CONSTRAINT ck_app_key_status CHECK (status IN ('ACTIVE', 'DEPRECATED', 'DISABLED'))
    )`,
    'CREATE UNIQUE INDEX uq_key ON app_key (key)',
    'CREATE INDEX idx_app_key_status ON app_key (status)',
  ],
  [
    // phase2 4.21 app_monitor_user（10 列 / 4 索引；时间戳改名 first_visit_at / last_active_at；
    // 松引用不建 FK；focus 默认按文档 false，schema 里是 true —— 差异已在交付报告登记）
    `CREATE TABLE app_monitor_user (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      visitor_id text NOT NULL,
      user_id uuid NULL,
      device_id text NULL,
      auth boolean NOT NULL DEFAULT false,
      focus boolean NOT NULL DEFAULT false,
      is_left boolean NOT NULL DEFAULT false,
      current_router text NULL,
      first_visit_at timestamptz NOT NULL DEFAULT now(),
      last_active_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_app_monitor_user PRIMARY KEY (id)
    )`,
    'CREATE UNIQUE INDEX uq_monitor_visitor ON app_monitor_user (visitor_id)',
    'CREATE INDEX idx_monitor_device ON app_monitor_user (device_id)',
    'CREATE INDEX idx_monitor_user ON app_monitor_user (user_id)',
  ],
  [
    // phase2 4.22 app_error（16 列 / 3 索引；只有 created_at；raw_payload 为 Q7 旁路列）
    `CREATE TABLE app_error (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      message text NULL,
      stack text NULL,
      status_code integer NULL,
      path text NULL,
      method varchar(8) NULL,
      headers jsonb NOT NULL DEFAULT '{}'::jsonb,
      payload jsonb NULL,
      raw_payload text NULL,
      error_type text NULL,
      user_id uuid NULL,
      response_code varchar(16) NULL,
      response_msg text NULL,
      ip text NULL,
      env varchar(16) NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_app_error PRIMARY KEY (id),
      CONSTRAINT ck_app_error_method CHECK (method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD')),
      CONSTRAINT ck_app_error_env CHECK (env IN ('development', 'stage', 'production'))
    )`,
    'CREATE INDEX idx_error_created_at ON app_error (created_at DESC)',
    'CREATE INDEX idx_error_user ON app_error (user_id)',
  ],
  [
    // phase2 4.8 sys_device（22 列 / 4 索引；device_id 是被引用业务键（Q5）必须 UNIQUE；
    // sr/vp/geo 拍平为数值列；ip 保持 text —— Q8 定案）
    `CREATE TABLE sys_device (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      device_name text NOT NULL,
      device_id text NOT NULL,
      device_info jsonb NOT NULL,
      hardware_info jsonb NULL,
      location_info jsonb NULL,
      location_history jsonb NOT NULL DEFAULT '[]'::jsonb,
      sr_height integer NULL,
      sr_width integer NULL,
      vp_height integer NULL,
      vp_width integer NULL,
      ip text NULL,
      ip_history text[] NOT NULL,
      active boolean NOT NULL DEFAULT false,
      locked boolean NOT NULL DEFAULT false,
      banned boolean NOT NULL DEFAULT false,
      private boolean NOT NULL DEFAULT false,
      geo_longitude double precision NULL,
      geo_latitude double precision NULL,
      risk_score smallint NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_sys_device PRIMARY KEY (id),
      CONSTRAINT ck_device_risk_score CHECK (risk_score BETWEEN 0 AND 100)
    )`,
    'CREATE UNIQUE INDEX uq_device_name ON sys_device (device_name)',
    'CREATE UNIQUE INDEX uq_device_id ON sys_device (device_id)',
    'CREATE INDEX idx_device_created_at ON sys_device (created_at DESC)',
  ],
  [
    // phase2 4.1 sys_user（13 列 / 4 索引 / 1 FK）
    `CREATE TABLE sys_user (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      user_name text NULL,
      nick_name text NULL,
      age integer NULL,
      gender smallint NOT NULL DEFAULT 9,
      avatar text NULL,
      description text NULL,
      status boolean NOT NULL DEFAULT true,
      role_mode varchar(16) NOT NULL DEFAULT 'switchable',
      current_role_id uuid NULL,
      mfa_setup boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_sys_user PRIMARY KEY (id),
      CONSTRAINT fk_user_current_role FOREIGN KEY (current_role_id) REFERENCES sys_role (id) ON DELETE SET NULL,
      CONSTRAINT ck_user_age CHECK (age > 0),
      CONSTRAINT ck_user_gender CHECK (gender IN (0, 1, 2, 9)),
      CONSTRAINT ck_user_role_mode CHECK (role_mode IN ('switchable', 'combinable'))
    )`,
    // 原 partial unique（$type: string 过滤）→ WHERE NOT NULL，语义等价（phase2 4.1）
    'CREATE UNIQUE INDEX uq_user_name ON sys_user (user_name) WHERE "user_name" IS NOT NULL',
    'CREATE INDEX idx_user_created_at ON sys_user (created_at DESC)',
    'CREATE INDEX idx_user_current_role ON sys_user (current_role_id)',
  ],
  [
    // phase2 4.3 sys_menu（29 列 / 4 索引 / 1 自引用 FK；meta 19 字段拍平 —— Q1 定案；
    // pid 可空 = 根节点；ON DELETE RESTRICT —— Q6 定案）
    `CREATE TABLE sys_menu (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      pid uuid NULL,
      type varchar(8) NOT NULL DEFAULT 'catalog',
      path text NULL,
      name text NULL,
      component text NULL,
      title text NULL,
      icon text NULL,
      sort_order integer NULL,
      ternal varchar(8) NOT NULL DEFAULT 'none',
      url text NULL,
      is_show boolean NOT NULL DEFAULT true,
      cache boolean NOT NULL DEFAULT false,
      status boolean NOT NULL DEFAULT true,
      affix boolean NOT NULL DEFAULT false,
      permission text NULL,
      menu_active_name text NULL,
      menu_active_same_tab boolean NOT NULL DEFAULT false,
      badge text NULL,
      active_icon text NULL,
      position boolean NOT NULL DEFAULT false,
      leave_tip boolean NOT NULL DEFAULT false,
      mask_url boolean NOT NULL DEFAULT false,
      hijack_refresh boolean NOT NULL DEFAULT false,
      watermark jsonb NULL,
      transition varchar(32) NOT NULL DEFAULT 'fade',
      cache_key_strategy varchar(8) NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_sys_menu PRIMARY KEY (id),
      CONSTRAINT fk_menu_pid FOREIGN KEY (pid) REFERENCES sys_menu (id) ON DELETE RESTRICT,
      CONSTRAINT ck_menu_type CHECK (type IN ('catalog', 'menu', 'element')),
      CONSTRAINT ck_menu_ternal CHECK (ternal IN ('none', 'internal', 'external')),
      -- custom 漏值修复（2026-10-27，枚举三方守卫 dto-entity.drift.spec 抓出）：contract
      -- CacheKeyStrategy 与 admin 菜单表单（cacheKeyStrategyOptions）都有 custom，
      -- CHECK 漏了它 → 合法 payload 撞 23514。以 const 为准补齐（存量库手工 ALTER，
      -- 同 P0-1 的 dev 库口径）。
      CONSTRAINT ck_menu_cache_key_strategy CHECK (cache_key_strategy IN ('name', 'path', 'custom'))
    )`,
    'CREATE UNIQUE INDEX uq_menu_name ON sys_menu (name) WHERE "name" IS NOT NULL',
    // partial index：根节点 pid 为 NULL，全量索引无意义（phase2 4.3）
    'CREATE INDEX idx_menu_pid ON sys_menu (pid) WHERE "pid" IS NOT NULL',
    'CREATE INDEX idx_menu_status_sort_order ON sys_menu (status, sort_order)',
  ],

  // ============================================================
  // 2. 关联表（数组字段拆出；双 FK 均 CASCADE；复合 PK 即去重）
  // ============================================================
  [
    // phase2 4.1 sys_user_role（2 列 / 2 索引；不保留 multikey unique 误声明，见 4.1 勘误）
    `CREATE TABLE sys_user_role (
      user_id uuid NOT NULL,
      role_id uuid NOT NULL,
      CONSTRAINT pk_sys_user_role PRIMARY KEY (user_id, role_id),
      CONSTRAINT fk_user_role_user FOREIGN KEY (user_id) REFERENCES sys_user (id) ON DELETE CASCADE,
      CONSTRAINT fk_user_role_role FOREIGN KEY (role_id) REFERENCES sys_role (id) ON DELETE CASCADE
    )`,
    'CREATE INDEX idx_role_id ON sys_user_role (role_id)',
  ],
  [
    // phase2 4.2 sys_role_menu（2 列 / 2 索引；勘误同上，见 4.2）
    `CREATE TABLE sys_role_menu (
      role_id uuid NOT NULL,
      menu_id uuid NOT NULL,
      CONSTRAINT pk_sys_role_menu PRIMARY KEY (role_id, menu_id),
      CONSTRAINT fk_role_menu_role FOREIGN KEY (role_id) REFERENCES sys_role (id) ON DELETE CASCADE,
      CONSTRAINT fk_role_menu_menu FOREIGN KEY (menu_id) REFERENCES sys_menu (id) ON DELETE CASCADE
    )`,
    'CREATE INDEX idx_menu_id ON sys_role_menu (menu_id)',
  ],

  // ============================================================
  // 3. 从属表（业务从属 → FK CASCADE；phase2 2.4-1）
  // ============================================================
  [
    // phase2 4.5 sys_locale（6 列 / 4 索引 / 1 FK；(lang_id, key) UNIQUE —— Q2/Q11 定案；
    // 全库唯一的 trgm GIN —— Q9 定案，TypeORM @Index 表达不了 gin_trgm_ops，只在此落）
    `CREATE TABLE sys_locale (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      lang_id uuid NOT NULL,
      key text NOT NULL,
      value text NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_sys_locale PRIMARY KEY (id),
      CONSTRAINT fk_locale_lang FOREIGN KEY (lang_id) REFERENCES sys_lang (id) ON DELETE CASCADE
    )`,
    'CREATE UNIQUE INDEX uq_locale_lang_key ON sys_locale (lang_id, key)',
    'CREATE INDEX idx_locale_key ON sys_locale (key)',
    'CREATE INDEX idx_locale_key_trgm ON sys_locale USING gin (key gin_trgm_ops)',
  ],
  [
    // phase2 4.7 sys_dict_data（10 列 / 2 索引 / 1 FK）
    `CREATE TABLE sys_dict_data (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      type_id uuid NOT NULL,
      label text NOT NULL,
      value text NOT NULL,
      sort_order integer NOT NULL DEFAULT 0,
      status boolean NOT NULL DEFAULT true,
      tag_type varchar(8) NOT NULL DEFAULT 'primary',
      description text NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_sys_dict_data PRIMARY KEY (id),
      CONSTRAINT fk_dict_data_type FOREIGN KEY (type_id) REFERENCES sys_dict_type (id) ON DELETE CASCADE,
      CONSTRAINT ck_dict_data_tag_type CHECK (tag_type IN ('primary', 'info', 'success', 'warning', 'error'))
    )`,
    'CREATE INDEX idx_dict_data_type_order ON sys_dict_data (type_id, sort_order)',
  ],
  [
    // phase2 4.9 sys_user_device（12 列 / 4 索引 / 2 FK；(user_id, device_id) UNIQUE —— Q2 定案；
    // device_id 按业务键 FK —— Q5 定案）
    `CREATE TABLE sys_user_device (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      device_name text NULL,
      user_id uuid NOT NULL,
      device_id text NOT NULL,
      link boolean NOT NULL DEFAULT false,
      link_type varchar(8) NOT NULL DEFAULT 'system',
      locked boolean NOT NULL DEFAULT false,
      last_active_at timestamptz NULL,
      trusted boolean NOT NULL DEFAULT false,
      trusted_expired_at timestamptz NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_sys_user_device PRIMARY KEY (id),
      CONSTRAINT fk_user_device_user FOREIGN KEY (user_id) REFERENCES sys_user (id) ON DELETE CASCADE,
      CONSTRAINT fk_user_device_device FOREIGN KEY (device_id) REFERENCES sys_device (device_id) ON DELETE CASCADE,
      CONSTRAINT ck_user_device_link_type CHECK (link_type IN ('user', 'admin', 'system'))
    )`,
    'CREATE UNIQUE INDEX uq_user_device ON sys_user_device (user_id, device_id)',
    'CREATE INDEX idx_user_device_device ON sys_user_device (device_id)',
    'CREATE INDEX idx_user_device_created_at ON sys_user_device (created_at DESC)',
  ],
  [
    // phase2 4.10 sys_user_identity（14 列 / 3 索引 / 1 FK）
    `CREATE TABLE sys_user_identity (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      type varchar(16) NOT NULL,
      purpose varchar(8) NOT NULL,
      value text NOT NULL,
      value_hash text NOT NULL,
      masked_value text NOT NULL,
      verified boolean NOT NULL DEFAULT false,
      verified_at timestamptz NULL,
      is_primary boolean NOT NULL DEFAULT true,
      status boolean NOT NULL DEFAULT true,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_sys_user_identity PRIMARY KEY (id),
      CONSTRAINT fk_user_identity_user FOREIGN KEY (user_id) REFERENCES sys_user (id) ON DELETE CASCADE,
      CONSTRAINT ck_user_identity_type CHECK (type IN ('phoneNumber', 'emailAddress', 'idCard', 'password')),
      CONSTRAINT ck_user_identity_purpose CHECK (purpose IN ('login', 'security'))
    )`,
    'CREATE UNIQUE INDEX uq_identity ON sys_user_identity (user_id, type, purpose)',
    'CREATE INDEX idx_identity_type_hash ON sys_user_identity (type, value_hash)',
  ],
  [
    // phase2 4.11 sys_user_lock（10 列 / 2 索引 / 1 FK；user_id UNIQUE —— Q2 定案）
    `CREATE TABLE sys_user_lock (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      lock_route jsonb NOT NULL DEFAULT '{}'::jsonb,
      lock_pwd_hash text NULL,
      lock_mode varchar(8) NOT NULL DEFAULT 'default',
      lock_idle_sec integer NOT NULL DEFAULT 600,
      lock_security_sec integer NOT NULL DEFAULT 60,
      lock_cross_device boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_sys_user_lock PRIMARY KEY (id),
      CONSTRAINT fk_user_lock_user FOREIGN KEY (user_id) REFERENCES sys_user (id) ON DELETE CASCADE,
      CONSTRAINT ck_user_lock_mode CHECK (lock_mode IN ('default', 'idle', 'security'))
    )`,
    'CREATE UNIQUE INDEX uq_user_lock_user ON sys_user_lock (user_id)',
  ],
  [
    // phase2 4.12 sys_user_mfa（16 列 / 3 索引 / 1 FK；device_id 松引用不建 FK —— Q5 定案；
    // webauthn_credential_id partial unique —— Q2 定案；transports 数组元素 CHECK）
    `CREATE TABLE sys_user_mfa (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      type varchar(8) NOT NULL,
      device_id text NOT NULL,
      name text NOT NULL,
      totp_secret_ciphertext text NULL,
      webauthn_credential_id text NULL,
      webauthn_public_key text NULL,
      webauthn_counter bigint NOT NULL DEFAULT 0,
      webauthn_transports text[] NOT NULL DEFAULT '{}',
      phone_number_ciphertext text NULL,
      backup_codes_ciphertext text[] NOT NULL DEFAULT '{}',
      status boolean NOT NULL DEFAULT true,
      last_used_at timestamptz NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_sys_user_mfa PRIMARY KEY (id),
      CONSTRAINT fk_user_mfa_user FOREIGN KEY (user_id) REFERENCES sys_user (id) ON DELETE CASCADE,
      CONSTRAINT ck_user_mfa_type CHECK (type IN ('totp', 'webauthn')),
      CONSTRAINT ck_user_mfa_webauthn_transports CHECK (
        webauthn_transports <@ ARRAY['usb', 'ble', 'nfc', 'internal', 'hybrid']::text[]
      )
    )`,
    'CREATE INDEX idx_user_mfa_user ON sys_user_mfa (user_id)',
    'CREATE UNIQUE INDEX uq_user_mfa_credential ON sys_user_mfa (webauthn_credential_id) WHERE "webauthn_credential_id" IS NOT NULL',
  ],
  [
    // phase2 4.13 sys_user_oauth（7 列 / 3 索引 / 1 FK；schema 死索引 {userId, enabled} 不迁移）
    `CREATE TABLE sys_user_oauth (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      provider varchar(16) NOT NULL,
      provider_id text NOT NULL,
      status boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_sys_user_oauth PRIMARY KEY (id),
      CONSTRAINT fk_user_oauth_user FOREIGN KEY (user_id) REFERENCES sys_user (id) ON DELETE CASCADE,
      CONSTRAINT ck_user_oauth_provider CHECK (provider IN ('google-one-tap', 'gitee', 'github'))
    )`,
    'CREATE UNIQUE INDEX uq_oauth ON sys_user_oauth (provider, provider_id)',
    'CREATE INDEX idx_oauth_user ON sys_user_oauth (user_id)',
  ],
  [
    // phase2 4.14 sys_user_preference（12 列 / 2 索引 / 1 FK；user_id UNIQUE —— Q2 定案）
    `CREATE TABLE sys_user_preference (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      font_size smallint NOT NULL DEFAULT 14,
      dark boolean NOT NULL DEFAULT false,
      reduced_motion boolean NOT NULL DEFAULT false,
      color_mode varchar(20) NOT NULL DEFAULT 'default',
      cvd varchar(20) NULL,
      locale varchar(16) NOT NULL DEFAULT 'zh_CN',
      layout_mode varchar(16) NOT NULL DEFAULT 'left-menu',
      layout jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_sys_user_preference PRIMARY KEY (id),
      CONSTRAINT fk_user_preference_user FOREIGN KEY (user_id) REFERENCES sys_user (id) ON DELETE CASCADE,
      CONSTRAINT ck_user_preference_font_size CHECK (font_size IN (10, 12, 14, 16, 20)),
      CONSTRAINT ck_user_preference_color_mode CHECK (color_mode IN ('default', 'cafe', 'contrast', 'grayscale', 'grayscale-inverted', 'inverted')),
      CONSTRAINT ck_user_preference_cvd CHECK (cvd IN ('default', 'protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia')),
      CONSTRAINT ck_user_preference_layout_mode CHECK (layout_mode IN ('left-menu', 'top-menu'))
    )`,
    'CREATE UNIQUE INDEX uq_user_preference_user ON sys_user_preference (user_id)',
  ],

  // ============================================================
  // 4. 日志 / 审计 / 会话表（追加型：PK 默认 uuidv7()；松引用不建 FK —— Q3 定案）
  // ============================================================
  [
    // phase2 4.15 sys_log_auth（13 列 / 4 索引；只有 authenticated_at，无 updated_at）
    `CREATE TABLE sys_log_auth (
      id uuid NOT NULL DEFAULT uuidv7(),
      ip text NULL,
      location text NULL,
      os text NULL,
      browser text NULL,
      user_id uuid NULL,
      user_name text NULL,
      identifier text NULL,
      success boolean NOT NULL DEFAULT false,
      msg text NULL,
      type varchar(16) NOT NULL,
      device_id text NULL,
      authenticated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_sys_log_auth PRIMARY KEY (id),
      CONSTRAINT ck_log_auth_type CHECK (type IN ('opaque', 'qrcode', 'otp', 'emailAddress', 'phoneNumber', 'github', 'gitee', 'googleFedCM'))
    )`,
    'CREATE INDEX idx_log_auth_at ON sys_log_auth (authenticated_at DESC)',
    'CREATE INDEX idx_log_auth_user ON sys_log_auth (user_id)',
    'CREATE INDEX idx_log_auth_device ON sys_log_auth (device_id)',
  ],
  [
    // phase2 4.16 sys_log_operate（25 列 / 4 索引；title 收紧 NOT NULL —— Q10-a 定案；
    // request/response_data 收 jsonb + raw_* text 旁路 —— Q7 定案）
    `CREATE TABLE sys_log_operate (
      id uuid NOT NULL DEFAULT uuidv7(),
      title text NOT NULL,
      action_type varchar(16) NOT NULL,
      -- B8 勘误（蓝图与现实冲突的裁定，见 phase3-plan §6 B8 追加）：文档写 NOT NULL，
      -- 但 crud 装饰器（create/update/delete 全量写面）从不传 operateType，运行时
      -- operation 恒 undefined —— Mongo 侧 schema default: null 本就容 null，
      -- NOT NULL 会让 fire-and-forget 把大多数日志行静默丢掉。收 NULL（PG CHECK
      -- 对 NULL 放行，显式写入值仍受 CHECK 约束）
      operation varchar(32) NULL,
      method varchar(8) NULL,
      url text NULL,
      http_version text NULL,
      location text NULL,
      os text NULL,
      browser text NULL,
      status_code integer NULL,
      request_data jsonb NULL,
      response_data jsonb NULL,
      raw_request_data text NULL,
      raw_response_data text NULL,
      corresponding_ms integer NULL,
      user_id uuid NULL,
      user_name text NULL,
      device_id text NULL,
      ip text NULL,
      invoking_method text NULL,
      success boolean NULL,
      snapshot_before jsonb NULL,
      snapshot_after jsonb NULL,
      operated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_sys_log_operate PRIMARY KEY (id),
      CONSTRAINT ck_log_operate_action_type CHECK (action_type IN ('OTHER', 'CREATE', 'UPDATE', 'DELETE', 'DELETE_MANY', 'IMPORT', 'EXPORT', 'CLEAR', 'REFRESH', 'AUTH')),
      CONSTRAINT ck_log_operate_operation CHECK (operation IN ('deleted.recover', 'appMonitorUser.forceQuit', 'user.updatePassword', 'user.clearPassword', 'device.lock', 'device.unlock', 'device.ban', 'device.unban', 'appSetting.refreshCache', 'auth.opaque.changePassword')),
      CONSTRAINT ck_log_operate_method CHECK (method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'))
    )`,
    'CREATE INDEX idx_log_operate_at ON sys_log_operate (operated_at DESC)',
    'CREATE INDEX idx_log_operate_user ON sys_log_operate (user_id)',
    'CREATE INDEX idx_log_operate_device ON sys_log_operate (device_id)',
  ],
  [
    // phase2 4.17 sys_deleted（8 列 / 4 索引；content 收 jsonb —— 5.3；deleted_by 松引用 —— Q3）
    `CREATE TABLE sys_deleted (
      id uuid NOT NULL DEFAULT uuidv7(),
      content jsonb NOT NULL,
      model_name text NOT NULL,
      collection_name text NOT NULL,
      deleted_id uuid NOT NULL,
      deleted_by uuid NOT NULL,
      log_operate_id uuid NULL,
      deleted_at timestamptz NULL,
      CONSTRAINT pk_sys_deleted PRIMARY KEY (id)
    )`,
    'CREATE INDEX idx_deleted_model_at ON sys_deleted (model_name, deleted_at DESC)',
    'CREATE INDEX idx_deleted_id ON sys_deleted (deleted_id)',
    'CREATE INDEX idx_deleted_by ON sys_deleted (deleted_by)',
  ],
  [
    // phase2 4.24 auth_refresh_token（9 列 / 5 索引 / 2 FK；只有 created_at；
    // user_id / device_id 双 FK CASCADE —— 2.4-1 与 Q5 定案）
    `CREATE TABLE auth_refresh_token (
      id uuid NOT NULL DEFAULT uuidv7(),
      jti text NOT NULL,
      user_id uuid NOT NULL,
      device_id text NOT NULL,
      encrypted_token text NOT NULL,
      expired_at timestamptz NOT NULL,
      revoked boolean NOT NULL DEFAULT false,
      revoke_reason varchar(24) NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_auth_refresh_token PRIMARY KEY (id),
      CONSTRAINT fk_rt_user FOREIGN KEY (user_id) REFERENCES sys_user (id) ON DELETE CASCADE,
      CONSTRAINT fk_rt_device FOREIGN KEY (device_id) REFERENCES sys_device (device_id) ON DELETE CASCADE,
      CONSTRAINT ck_refresh_token_revoke_reason CHECK (revoke_reason IN ('rotate', 'updatePass', 'resetPass', 'updateEmail', 'updatePhoneNumber', 'forceQuitOnline', 'forceQuitOffline', 'currentRoleBanned', 'currentUserBanned', 'deviceBanned', 'deviceHighRisk', 'versionUpgrade', 'userKickOther'))
    )`,
    'CREATE UNIQUE INDEX uq_jti ON auth_refresh_token (jti)',
    'CREATE INDEX idx_rt_user ON auth_refresh_token (user_id)',
    'CREATE INDEX idx_rt_device ON auth_refresh_token (device_id)',
    'CREATE INDEX idx_rt_expired ON auth_refresh_token (expired_at)',
  ],
]

/**
 * down：反序 DROP（关联表 / 从属表 / 日志表在前，被引用表在后；DROP TABLE 连带
 * 各表索引与约束），最后摘掉 up 里确保过的扩展。
 */
const DOWN_STATEMENTS: string[] = [
  'DROP TABLE IF EXISTS auth_refresh_token',
  'DROP TABLE IF EXISTS sys_deleted',
  'DROP TABLE IF EXISTS sys_log_operate',
  'DROP TABLE IF EXISTS sys_log_auth',
  'DROP TABLE IF EXISTS sys_user_preference',
  'DROP TABLE IF EXISTS sys_user_oauth',
  'DROP TABLE IF EXISTS sys_user_mfa',
  'DROP TABLE IF EXISTS sys_user_lock',
  'DROP TABLE IF EXISTS sys_user_identity',
  'DROP TABLE IF EXISTS sys_user_device',
  'DROP TABLE IF EXISTS sys_dict_data',
  'DROP TABLE IF EXISTS sys_locale',
  'DROP TABLE IF EXISTS sys_role_menu',
  'DROP TABLE IF EXISTS sys_user_role',
  'DROP TABLE IF EXISTS sys_menu',
  'DROP TABLE IF EXISTS sys_user',
  'DROP TABLE IF EXISTS sys_device',
  'DROP TABLE IF EXISTS app_error',
  'DROP TABLE IF EXISTS app_monitor_user',
  'DROP TABLE IF EXISTS app_key',
  'DROP TABLE IF EXISTS app_demo',
  'DROP TABLE IF EXISTS app_setting',
  'DROP TABLE IF EXISTS sys_dict_type',
  'DROP TABLE IF EXISTS sys_lang',
  'DROP TABLE IF EXISTS shared_area',
  'DROP TABLE IF EXISTS sys_role',
  'DROP EXTENSION IF EXISTS pg_trgm',
]

export class InitSchema1792922206018 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of UP_SECTIONS.flat()) {
      await queryRunner.query(sql)
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const sql of DOWN_STATEMENTS) {
      await queryRunner.query(sql)
    }
  }
}
