# deploy/env/

服务器解密后的后端 env 文件放这里（**不入库，服务器上生成**）：

1. 服务器上安装 pnpm + 克隆仓库或复制 `apps/server/env-encrypted/` 与根 `.env.keys`
2. 在仓库根运行 `pnpm setup-env` 解密
3. 将 `apps/server/env-local/.env.production` 复制为 `deploy/env/.env.production`

**注意：把连接串 host 从 `127.0.0.1` 改为服务名：**
- `APP_REDIS_HOST=prod-single-redis`
- `DATABASE_PRIMARY=prod-mongodb-primary:27017`
- `DATABASE_SECONDARY=prod-mongodb-secondary:27017`
- `DATABASE_ARBITER=prod-mongodb-arbiter:27017`

禁止改动：AUTH_OPAQUE_SECRET / MFA_ENCRYPTION_KEY / RT_ENCRYPTION_KEY / DEVICE_ID_ENCRYPTION_KEY / USER_ID_ENCRYPTION_KEY / USER_ID_HASH_SALT（改后历史数据无法解密）。
