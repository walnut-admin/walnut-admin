# deploy/env/

`env/.env.production` 由 CI 每次部署自动生成（连接串 host 已替换为容器服务名），**服务器上无需手动创建**。

禁止改动：AUTH_OPAQUE_SECRET / MFA_ENCRYPTION_KEY / RT_ENCRYPTION_KEY / DEVICE_ID_ENCRYPTION_KEY / USER_ID_ENCRYPTION_KEY / USER_ID_HASH_SALT（改后历史数据无法解密）。

## 本地验证时手动生成（参考）

1. 安装 pnpm + 复制 `apps/server/env-encrypted/` 与根 `.env.keys`
2. 在仓库根运行 `pnpm setup-env` 解密
3. 将 `apps/server/env-local/.env.production` 复制为 `deploy/env/.env.production`

**注意：把连接串 host 从 `127.0.0.1` 改为服务名：**
- `APP_REDIS_HOST=prod-single-redis`
- `DATABASE_PRIMARY=prod-mongodb-primary:27017`
- `DATABASE_SECONDARY=prod-mongodb-secondary:27017`
- `DATABASE_ARBITER=prod-mongodb-arbiter:27017`
