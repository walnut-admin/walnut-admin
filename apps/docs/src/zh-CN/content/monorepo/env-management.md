# 环境变量加密管理

## 为什么需要加密

Walnut Admin 是公开的 GitHub 仓库，但项目实际在运营，大量敏感密钥（数据库密码、JWT secret、OAuth key、云服务 AK 等）不能暴露在仓库中。

传统做法是 `.env.local` 放真实值、gitignore 掉、新成员入职手动发文件。但换电脑或来新人时每次都要单独传，效率低且容易泄露。

我们的方案：用 **dotenvx** 加密 `.env` 文件，密文直接提交到 Git，团队成员只需一个私钥即可解密。

## 原理

dotenvx 使用 ECIES 椭圆曲线加密（AES-256 + Secp256k1），每个变量值独立加密：

```
# 明文
DATABASE_PRIMARY=127.0.0.1:27017

# 加密后（可安全提交 Git）
DATABASE_PRIMARY=encrypted:BPjEdKHuA1vOFRXhmkq/DF93...
```

加密后的文件放在 `env-encrypted/` 目录下提交 Git。私钥存储在 `.env.keys` 文件（gitignored，通过 1Password 分发）。

## 目录结构

```
walnut-admin/
├── .env.keys              ← gitignored（私钥，1Password 分发）
├── scripts/setup-env.ts   ← 加解密脚本
│
├── apps/admin/
│   ├── env/               ← 模板（占位符参考，提交 Git）
│   ├── env-encrypted/     ← 加密后的真实值（安全提交 Git！）
│   └── env-local/         ← 明文真实值（gitignored，由脚本生成）
│
└── apps/server/
    ├── env/               ← 模板
    ├── env-encrypted/     ← 加密后的真实值
    └── env-local/         ← 明文真实值
```

三个目录的关系：

| 目录 | 内容 | 提交 Git? | 谁生成 |
|------|------|-----------|--------|
| `env/` | `{{your ...}}` 占位符模板 | ✅ 是 | 手动维护 |
| `env-encrypted/` | `encrypted:...` 密文 | ✅ 是（安全） | `pnpm encrypt-env` |
| `env-local/` | 明文真实值 | ❌ 否 | `pnpm setup-env` |

## 密钥设计

**3 把 key，按环境划分：**

```
.env.keys:
  DOTENV_PRIVATE_KEY_DEVELOPMENT="admin的key,server的key"
  DOTENV_PRIVATE_KEY_PRODUCTION="admin的key,server的key"
  DOTENV_PRIVATE_KEY_STAGE="admin的key,server的key"
```

每个环境一把 key。因为 admin 和 server 都有 `.env.development`，dotenvx 对每个文件独立生成密钥对，同名 key 的值用逗号合并。解密时 dotenvx 会逐个尝试，哪个能解开就用哪个。

## 日常使用

### 新成员入职

```bash
# 1. 从 1Password 获取私钥，创建 .env.keys 文件
echo 'DOTENV_PRIVATE_KEY_DEVELOPMENT="..."' > .env.keys
# ...（完整内容从 1Password 复制）

# 2. 一键解密所有 env-encrypted/ → env-local/
pnpm setup-env

# 3. 正常开发
pnpm dev:admin
pnpm dev:server
```

### 修改或新增密钥

```bash
# 1. 直接修改 env-local/ 中的明文值
# 2. 同步更新 env/ 模板（占位符）
# 3. 重新加密
pnpm encrypt-env
# 4. 提交 env-encrypted/ + env/ 到 Git
```

### 新增环境变量

1. 在 `env-local/` 中添加新变量
2. 在 `env/` 模板中对应添加
3. **前端**：更新 `build/vite/config/env.*.ts` 中的 Zod schema
4. **后端**：更新 `libs/config/src/validation.ts` 中的校验装饰器
5. 运行 `pnpm encrypt-env` 重新加密
6. 提交所有变更

## 哪些文件需要加密

| 文件 | 是否加密 | 原因 |
|------|---------|------|
| admin `.env`（基础） | ❌ 不加密 | 只有 app title、GA ID 等非敏感配置 |
| admin `.env.development` | ✅ 加密 | 含内网代理地址 |
| admin `.env.production` / `.env.stage` | ✅ 加密 | 含 Sentry Auth Token、生产 API 地址 |
| server 全部 `.env.*` | ✅ 加密 | 含数据库密码、JWT secret、OAuth key、云 AK/SK |

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
