# 环境配置

## 密文随仓库提交

环境文件用 **dotenvx** 加密（AES-256）后提交，明文从不进 git —— `env-encrypted/` 里的文件本身就是
模板，改配置时照着里面的注释加 key 即可。完整机制见
[环境变量加密管理](../monorepo/env-management.md)。

日常两条命令，都在**仓库根**执行：

- `pnpm setup-env` —— 解密 `env-encrypted/` → `env-local/`（新成员初始化，需要根目录的 `.env.keys`，
  私钥经 1Password 共享）
- `pnpm encrypt-env` —— 改完密钥后把 `env-local/` 重新加密回 `env-encrypted/`

`apps/server/env-local/` 是 gitignored 的。所以「改了 env 却不生效」的第一嫌疑永远是这个顺序问题：
先 `setup-env`，并且**后端必须从 `apps/server/` 目录启动**（ConfigModule 用 `process.cwd()` 定位 env；
从仓库根起后端走 `pnpm dev` 或 `pnpm dev:server` —— 它们由 turbo 在 `apps/server/` 下执行，cwd 正确）。

CI 里通过 GitHub Secret `ENV_KEYS`（内容就是 `.env.keys` 全文）自动解密；旧文档里的
`DOTENVX_KEYS_FILE` 已废弃。

## 加载哪几个文件

| 文件 | 用途 |
|------|------|
| `.env.development` | 开发配置 |
| `.env.production` | 生产配置 |
| `.env.stage` | 预发（stage）配置 |

## 部署后绝不能改的 5 个 key

下面这几个 key 是**数据加密的根**。它们只在首次部署时确定一次；改动之后，用旧 key 加密过的历史数据
（OPAQUE 凭据、MFA 密钥、refresh token、设备 ID、用户身份标识）**再也解不开** ——
不是「要迁移」，是直接不可读。

| key | 加密的是什么 |
|-----|-------------|
| `AUTH_OPAQUE_SECRET` | OPAQUE 协议密钥 |
| `MFA_ENCRYPTION_KEY` | MFA 数据 |
| `RT_ENCRYPTION_KEY` | refresh token |
| `DEVICE_ID_ENCRYPTION_KEY` | 设备 ID |
| `USER_ID_ENCRYPTION_KEY` | 用户身份标识 |

这几个 key 的名字也抄在常驻指引 `apps/server/AGENTS.md` 里 —— 它们属于「改之前必须想起来」的那一类，
不该只躺在参考文档里。
