# 环境变量加密管理

## 概述

Walnut Admin 是公开的 GitHub 仓库，但项目实际在运营——数据库密码、JWT secret、OAuth key、云服务 AK/SK 等敏感密钥不能暴露在仓库中。传统做法是 `.env.local` 放真实值、gitignore 掉、新成员入职手动发文件，效率低且容易泄露。

我们的方案：用 **dotenvx** 对 `.env` 文件做 ECIES 椭圆曲线加密（AES-256 + Secp256k1），每个变量值独立加密。密文直接提交 Git，团队成员只需一个私钥即可解密。

## 我们做了什么

### 1. 两层目录结构

```
walnut-admin/
├── .env.keys              ← gitignored（私钥，1Password 分发）
├── scripts/setup-env.ts   ← 加解密脚本
│
├── apps/admin/
│   ├── env-encrypted/     ← 加密后的真实值，文件内注释即模板（安全提交 Git）
│   └── env-local/         ← 明文真实值（gitignored，脚本生成）
│
└── apps/server/
    ├── env-encrypted/     ← 加密后的真实值，文件内注释即模板
    └── env-local/         ← 明文真实值
```

| 目录 | 内容 | 提交 Git? | 谁生成 |
|------|------|-----------|--------|
| `env-encrypted/` | `encrypted:...` 密文，文件内注释即模板 | ✅ 是（安全） | `pnpm encrypt-env` |
| `env-local/` | 明文真实值 | ❌ 否 | `pnpm setup-env` |

### 2. 多环境密钥

3 把 key 按环境划分，同一环境的 admin 和 server key 用逗号合并：

```
.env.keys:
  DOTENV_PRIVATE_KEY_DEVELOPMENT="admin的key,server的key"
  DOTENV_PRIVATE_KEY_PRODUCTION="admin的key,server的key"
  DOTENV_PRIVATE_KEY_STAGE="admin的key,server的key"
```

解密时 dotenvx 逐个尝试，哪个能解开就用哪个。

### 3. 日常命令

```bash
pnpm setup-env     # 一键解密 env-encrypted/ → env-local/
pnpm encrypt-env   # 修改密钥后重新加密
```

### 4. 前后端差异化

| 环境变量加载方式 | 前端（Vite） | 后端（NestJS） |
|----------------|-------------|---------------|
| 时机 | 构建时静态替换（`import.meta.env.VITE_*`） | 运行时加载（`@nestjs/config` + `ConfigModule.forRoot()`） |
| 影响缓存 | 是——`turbo.json` 声明了 `"env": ["VITE_*", "MODE"]` | 否——构建产物不包含 env 值 |
| 新增变量后 | 更新 `build/vite/config/` 中的 Zod schema | 更新 `libs/config/src/validation.ts` |

## 没做什么 / 为什么

### 不加密所有 `.env` 文件

admin 的基础 `.env` 模板（app title、GA ID 等非敏感配置）已随模板目录清理移除，不再维护明文模板。只加密 `.env.development`、`.env.production`、`.env.stage` 以及 server 的全部 `.env.*`，加密文件内的注释承担模板职责。

### 不把加密文件放在 monorepo 根目录

每个 app 有自己的 `env-encrypted/` 目录，而不是集中在根目录。原因是 admin 和 server 的部署方式完全不同、环境变量数量和敏感度也不同——分开管理更清晰。

---

## 注意事项

::: warning 禁止修改的密钥
以下密钥修改后会导致历史数据不可用：
- `AUTH_OPAQUE_SECRET` — OPAQUE 协议密钥
- `MFA_ENCRYPTION_KEY` — MFA 数据加密
- `RT_ENCRYPTION_KEY` — Refresh Token 加密
- `DEVICE_ID_ENCRYPTION_KEY` — 设备 ID 加密
- `USER_ID_ENCRYPTION_KEY` — 用户身份加密
:::

::: info 后端运行路径
服务器必须从 `apps/server/` 目录运行，因为 `ConfigModule` 使用 `process.cwd()` 定位 `env-local/` 目录。
:::

---

## 关键文件

| 文件 | 作用 |
|------|------|
| [scripts/setup-env.ts](https://github.com/walnut-admin/walnut-admin-client/blob/main/scripts/setup-env.ts) | 加解密脚本（`decrypt` / `encrypt` 子命令） |
| [apps/admin/env-encrypted/](https://github.com/walnut-admin/walnut-admin-client/tree/main/apps/admin/env-encrypted) | admin 加密环境变量（注释即模板） |
| [apps/server/env-encrypted/](https://github.com/walnut-admin/walnut-admin-client/tree/main/apps/server/env-encrypted) | server 加密环境变量（注释即模板） |
| [.env.keys](https://github.com/walnut-admin/walnut-admin-client/blob/main/.env.keys)（gitignored） | 私钥，通过 1Password 分发 |

## 相关 ADR

- [ADR-0003: No `import.meta.env` / `process.env` defaults in shared code](/content/adr/0003-no-env-defaults.md)
- [ADR-0012: Frontend-Backend Toolchain Divergence](/content/adr/0012-toolchain-divergence.md)（Decision 2: Environment Variable Loading）
