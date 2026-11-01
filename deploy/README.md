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

后端容器的 healthcheck 探的是 `/health/ready`（W2-B 起）：PG `SELECT 1` 与 Redis `PING`
都真实可用才判 healthy，`depends_on` 也要求 postgres / redis 先 healthy（redis 自带带密码
PING 的 healthcheck）。探针只挂在编排网络内 —— nginx 对公网 `/health/` 返回 404，
语义见 [`backend/modules/system-data.md`](../apps/docs/src/zh-CN/content/backend/modules/system-data.md) 的「探针端点」小节。

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

### 参考数据注入（每次部署自动跑）

空库起来后界面能用，但**菜单是空的、界面显示 i18n key** —— 参考数据（菜单 / 字典 / 语言包 / 应用设置）
还没进库。它随 Release 以发版资产的形式发布，注入由部署工作流**每次部署自动执行**（没有开关 ——
挂在开关上时"打 tag 自动部署"这条路永远不注入数据，线上库一直是空的，才撤掉的）。

它做的事（`deploy.yml` 的 `Seed reference data on server` 一步）：

1. 从该 tag 的 Release 下载 `walnut-admin-seed-<版本>.tar.gz`（CI 直接 tar 仓内 `apps/server/db/seed/`
   打出）；
2. `scp` 到服务器，解到部署目录下的 `seed-staging/`，与 seed 工具链一起 `docker cp` 进 **backend
   容器**（容器里有 Node 24 与 pg 依赖，服务器宿主机上没有仓库和工具链）；
3. 在容器里跑 `db:seed:pg`（与开发侧同一条命令）：**按 id upsert，库收敛到仓** —— 已存在的行整行
   刷新为仓内值，junction 关联只补缺不回收，签名密钥缺 ACTIVE 才现造。幂等，重复跑安全。
4. 在 postgres 容器里用 `psql` 打印每张参考表的行数 —— 那就是可复核的证据。

**语义变更（相对 mongoimport 时代，明说）**：旧通道"集合非空就整集跳过"，代价是后续版本新增的行
永远到不了已有数据的库；现在收敛到仓，仓是唯一真源。**运维在后台改过的菜单名 / 设置，必须走回灌
通道带进仓库**（`pnpm db:export:pg` 出差异 → PR 审 → 随发版走），否则下次部署会被冲掉。

**在服务器上自己复核**（不用等 CI）：

```bash
cd /home/ubuntu/walnut-admin/deploy
# 参考数据是否就位（空库首跑后这些数字应当接近仓内条数）
for t in app_setting sys_dict_data sys_dict_type sys_lang sys_locale sys_menu sys_role sys_user; do
  printf '%-16s' "$t"
  docker compose exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -tA -c 'SELECT count(*) FROM $t'"
done
# 看应用是否已经能用（语言包不再返回 500）
curl -sk -o /dev/null -w '%{http_code}\n' https://www.walnut-admin.com/api/system/locale/message/zh_CN
```

**口令凭证不在这条路径上**：演示账号与第一个管理员的口令是 OPAQUE 注册记录，**绑定本环境的
`AUTH_OPAQUE_SECRET`**，不能随仓库发布。它的建立是显式的一次性操作（见
[`backend/postgresql.md`](../apps/docs/src/zh-CN/content/backend/postgresql.md) 的「哪些数据刻意不在仓库里」）。

### 部署后验证（post-verify）

`docker compose up -d --wait` 只证明"容器起来了 + healthcheck 过"，不证明服务真的在工作。
所以 deploy 的最后一步会在服务器上跑 `post-verify.sh`（默认 **24 次 × 5s = 2 分钟**轮询）：

| 检查项 | 判定 |
|--------|------|
| 容器状态与重启次数 | 三个容器必须 `running` 且 `RestartCount=0`（`restart: always` 会把崩溃重启伪装成"一直 running"） |
| 运行中的镜像 tag | `Config.Image` 必须以本次 `.env` 的 `IMG_TAG` 结尾（防"部署成功但没换镜像"） |
| 后端日志 | 不得出现 `Nest can't resolve` / `MODULE_NOT_FOUND` / `EADDRINUSE` / `ECONNREFUSED` 等；必须出现启动标记 `APP is running in`（来自 `apps/server/apps/api/src/main.ts`） |
| 前端 / 入口 nginx 日志 | 不得出现 5xx |
| 健康探针挡板 | 经入口 nginx 访问 `/health/ready` 必须 404——探针只给编排层，公网可达 = PG/Redis 可用性侦察面泄露（W2-B 起） |
| 端到端 | 经公网域名 `--resolve` 指回本机：前端 `/` = 200，API `/w/v1/static/images/demo.png` = 200 |
| 安全响应头 | **两个域名各取一次响应头**，`Strict-Transport-Security` / `X-Content-Type-Options` / `X-Frame-Options` / `Referrer-Policy` 必须都在（只比头名、不比取值）。它们写死在 `nginx/conf.d/` 里，而本机没有 Docker ⇒ 这是唯一验得到「头真的发出去了」的地方 |

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
bash deploy/post-verify.test.sh   # 覆盖各条失败分支：容器/tag/后端日志/5xx/端到端/安全头/超时
```

> 安全响应头那一段有**两个面**，别只记住一个：
> 推送前由 `pnpm lint:nginx-headers` 静态查「`conf.d/` 里的配置写全了没有」（毫秒级、不需要 Docker），
> 部署后由 `post-verify.sh` 查「头真的发出去了没有」（环境/drift 那一面）。
> 两边的头名清单必须一致，由 `nginx-headers.test.ts` 机械核对。

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
# Dockerfile 必须落在 **context 根**：`docker buildx bake` 里 `dockerfile` 相对 context 解析
# （`docker build -f` 才是相对 cwd）—— 少了这行，`pnpm images:*` 会报 "failed to read dockerfile"
cp apps/server/Dockerfile build/image/server/Dockerfile

# 2) 前端：Vite 产物 + 站点配置（产出 build/image/frontend）
pnpm exec turbo run build --filter=@walnut/admin
mkdir -p build/image/frontend/html
cp -a apps/admin/dist/. build/image/frontend/html/
cp deploy/nginx/frontend-server.conf build/image/frontend/
cp apps/admin/Dockerfile build/image/frontend/Dockerfile   # 同上

# 3) 构建镜像（backend + frontend 并行；nginx 需要先有基础镜像）
docker build -f deploy/nginx/Dockerfile -t walnut-admin/nginx-brotli:local deploy/nginx
docker build --build-arg NGINX_BASE=walnut-admin/nginx-brotli:local -f apps/admin/Dockerfile build/image/frontend
docker build -f apps/server/Dockerfile build/image/server
```

对照与自查（不需要真的构建，`--print` 会把解析后的 context / dockerfile 打出来）：

```bash
pnpm images:print   # 三行里 backend/frontend 的 dockerfile 应当都是 "Dockerfile"
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

- 卷名 `postgres_data` / `redis_prod_data` 都是**新卷**：PG 是本次迁移新建的库；redis 换官方镜像后
  卷内路径从 bitnami 的 `/bitnami/redis/data` 变成 `/data`，旧卷不兼容、内容只有缓存/会话，直接弃
  （旧 `mongodb_master_data` 卷随迁移退役，数据已由 ETL 搬入 PG，确认不再需要后在服务器上手工删）
- PostgreSQL 与 Redis 不暴露公网端口（compose 内部网络互访；backend 经服务名 `postgres` 连接）
- 备份：`docker exec prod-postgres pg_dump -U walnut -d walnut_pg ...`（按需；账号与库名对齐 `.env` 的
  `POSTGRES_USER` / `POSTGRES_DB`）
