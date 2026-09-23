# Walnut Admin 服务器部署手册（全容器化）

## 首次初始化（一次性）

1. **安装 Docker + Compose 插件**（Ubuntu 24.04）：

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
docker compose version   # 确认 Compose v2
```

2. **创建部署目录并放置文件**：

```bash
mkdir -p /home/ubuntu/walnut-admin/deploy
# 从本仓库拷贝 deploy/ 目录（docker-compose.yml、nginx/ 等；.env 与 env/ 由 CI 自动生成）
# 目录结构：
#   /home/ubuntu/walnut-admin/deploy/
#   ├── docker-compose.yml
#   ├── .env                  ← CI 自动生成（IMG_TAG + 数据层密码）
#   ├── env/.env.production   ← CI 自动生成（后端 env，见 deploy/env/README.md）
#   ├── nginx/
#   │   ├── conf.d/*.conf     ← 域名/证书路径已按现网填写
#   │   └── certs/            ← SSL 证书 4 个文件（命名见第 4 步）
#   └── logs/
```

3. **准备后端 env**：无需手动准备——`env/.env.production` 由 CI 每次部署自动生成（连接串 host 已替换为容器服务名）；仅本地验证场景才按 `deploy/env/README.md` 手动生成。

4. **放置证书**：把 4 个证书文件直接放入服务器 `/home/ubuntu/walnut-admin/deploy/nginx/certs/`（即本仓库 `deploy/nginx/certs/`）。该目录经 docker-compose 挂载为容器内 `/etc/nginx/certs/`，nginx 按 conf 中的路径读取，**无需其他操作**。

   固定 4 个文件（两个域名各一对证书 + 私钥，命名与 `nginx/conf.d/` 中 `ssl_certificate` / `ssl_certificate_key` 一一对应）：

   | 文件 | 用途 |
   |------|------|
   | `www.walnut-admin.com.pem` | 前端域名证书（含完整链，腾讯云 bundle），`frontend.conf` 引用 |
   | `www.walnut-admin.com.key` | 前端域名私钥 |
   | `api.walnut-admin.com.pem` | API 域名证书（含完整链，腾讯云 bundle），`api.conf` 引用 |
   | `api.walnut-admin.com.key` | API 域名私钥 |

5. **填写 deploy/.env**：无需手动填写——由 CI 每次部署自动生成（数据层密码从解密产物提取）。

6. **启动（首次会先拉数据库镜像，需国内镜像源或稍等）**：

```bash
cd /home/ubuntu/walnut-admin/deploy
docker compose up -d
docker compose ps   # 全部 healthy/running
```

7. **下线旧体系**（确认新栈健康后）：

```bash
pm2 delete walnut-admin-nestjs-prod        # 停旧后端
systemctl stop nginx && systemctl disable nginx   # 停宿主机 nginx
```

## 日常更新（tag 发布自动执行）

发布流程：`pnpm release` → changeset 版本号 + changelog → commit → 打 tag `vX.Y.Z` → push。
推 tag 会触发 `.github/workflows/release.yml`：

```
verify（全量质量门禁）  ┐
                        ├─→ images（构建推送三镜像）→ GitHub Release → deploy（拉镜像 + 滚动重启 + 健康检查）
images（构建推送镜像）  ┘
```

服务器侧由 CI 自动完成，等价于手动执行：

```bash
cd /home/ubuntu/walnut-admin/deploy && docker compose pull && docker compose up -d --wait
```

- commit / PR 只跑质量门禁（`ci.yml`，不含 Docker）；只有 tag 才构建镜像
- 构建失败的补救：在该 run 上点 **Re-run all jobs**（同一个 tag，缓存命中后会快很多）
- 镜像 tag = 发布 tag（如 `v1.2.3`）；TCR 上同时保留 `nginx:brotli` 稳定别名

### 部署后验证（post-verify）

`docker compose up -d --wait` 只证明"容器起来了 + healthcheck 过"，不证明服务真的在工作。
所以 deploy 的最后一步会在服务器上跑 `post-verify.sh`（默认 **24 次 × 5s = 2 分钟**轮询）：

| 检查项 | 判定 |
|--------|------|
| 容器状态与重启次数 | 三个容器必须 `running` 且 `RestartCount=0`（`restart: always` 会把崩溃重启伪装成"一直 running"） |
| 运行中的镜像 tag | `Config.Image` 必须以本次 `.env` 的 `IMG_TAG` 结尾（防"部署成功但没换镜像"） |
| 后端日志 | 不得出现 `Nest can't resolve` / `MODULE_NOT_FOUND` / `EADDRINUSE` / `MongoServerError` / `ECONNREFUSED` 等；必须出现启动标记 `APP is running in`（来自 `apps/server/apps/api/src/main.ts`） |
| 前端 / 入口 nginx 日志 | 不得出现 5xx |
| 端到端 | 经公网域名 `--resolve` 指回本机：前端 `/` = 200，API `/w/v1/static/images/demo.png` = 200 |

任一硬条件在超时前不满足 → 该步骤失败（**部署不判成功**），并打印后端 / nginx 日志尾部便于定位。
在 Actions 里看 `deploy` job 的 **Post-deploy verification** 步骤。

手动排查时在服务器上直接跑：

```bash
cd /home/ubuntu/walnut-admin/deploy
bash post-verify.sh          # 默认 24 次 × 5s
bash post-verify.sh 6 5      # 只想快速看一眼：30 秒
```

改了脚本之后先在本地跑行为测试（用假 docker/curl，不需要 Docker）：

```bash
bash deploy/post-verify.test.sh   # 10 个场景：正常 / 未运行 / 重启过 / tag 不匹配 / 致命错误 / 5xx / 端到端不过 / 超时
```

> **nginx 日志为什么能通过 `docker logs` 看到**：alpine 的 nginx 包默认把 access/error log 写进
> `/var/log/nginx/*.log`（容器里 `docker logs` 是空的）。`deploy/nginx/Dockerfile` 用两个软链把它们
> 接到 stdout/stderr（与官方 nginx 镜像做法一致）；入口 nginx 与 frontend 共用同一基础镜像，因此都生效。

## 回滚

**推荐：Actions → Deploy → Run workflow**，`image_tag` 填上一个发布 tag（如 `v0.9.0`），
workflow 会先校验三个镜像都存在、再部署，并在日志里打印部署前后的容器→镜像映射。

手动兜底（服务器上直接改 tag）：

```bash
cd /home/ubuntu/walnut-admin/deploy
sed -i "s/^IMG_TAG=.*/IMG_TAG=v0.9.0/" .env
docker compose pull && docker compose up -d --wait
```

## 本地构建镜像（薄镜像流程）

镜像里不再有任何 `pnpm install` / 构建 —— 重活都在本机（或 CI runner）完成，
镜像只 `COPY` 产物。所以本地构建要按同样的三步来：

```bash
# 1) 后端：构建 + 抽取生产依赖（产出 build/image/server）
pnpm exec turbo run build --filter=@walnut/server...
pnpm deploy --legacy --filter=@walnut/server --prod build/image/server

# 2) 前端：Vite 产物 + 站点配置（产出 build/image/frontend）
pnpm exec turbo run build --filter=@walnut/admin
mkdir -p build/image/frontend/html
cp -a apps/admin/dist/. build/image/frontend/html/
cp deploy/nginx/frontend-server.conf build/image/frontend/

# 3) 构建镜像（backend + frontend 并行；nginx 需要先有基础镜像）
docker build -f deploy/nginx/Dockerfile -t walnut-admin/nginx-brotli:local deploy/nginx
docker build --build-arg NGINX_BASE=walnut-admin/nginx-brotli:local -f apps/admin/Dockerfile build/image/frontend
docker build -f apps/server/Dockerfile build/image/server
```

或直接用 bake（`docker-bake.hcl`，与 CI 同一份定义）：

```bash
REGISTRY=ccr.ccs.tencentyun.com NS=tron1997 TAG=local pnpm images:build   # backend + frontend
pnpm images:print                                                          # 只打印解析结果
```

> ⚠️ `pnpm deploy --prod` 会把工作区标记成"仅生产依赖"，**之后任何 pnpm 命令都会删掉 devDependencies**
> （`vite`、`cross-env` 当场消失）。所以 deploy 要放在最后；万一踩到，`pnpm install` 即可恢复。
>
> ⚠️ 产物目录曾把 `apps/server/env-local/`（解密后的明文密钥）一起拷进去 —— 镜像里绝不允许有，
> CI 与 Dockerfile 都有剔除步骤；本地手工构建时请确认 `build/image/server/env-local` 不存在。

## 证书更新（一年一次）

```bash
# 替换 deploy/nginx/certs/ 下对应文件后：
docker exec walnut-nginx nginx -s reload
```

## 数据层说明

- 卷名 `mongodb_master_data` / `redis_data` 与旧 compose 一致 → 数据无缝继承
- MongoDB 三节点与 Redis 不再暴露公网端口（内部网络互访）
- 备份：`docker exec prod-mongodb-primary mongodump ...`（按需）
