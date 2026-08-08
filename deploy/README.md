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
#   │   └── certs/            ← SSL 证书（前端域名 + API 域名）
#   └── logs/
```

3. **准备后端 env**：无需手动准备——`env/.env.production` 由 CI 每次部署自动生成（连接串 host 已替换为容器服务名）；仅本地验证场景才按 `deploy/env/README.md` 手动生成。

4. **放置证书**：把现网 `/etc/nginx/conf.d` 中的证书文件复制到 `deploy/nginx/certs/`（文件名与 conf 中路径一致）。

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

## 日常更新（CI 自动执行）

```bash
cd /home/ubuntu/walnut-admin/deploy && docker compose pull && docker compose up -d
```

## 回滚

```bash
cd /home/ubuntu/walnut-admin/deploy
sed -i "s/^IMG_TAG=.*/IMG_TAG=<上一版本SHA>/" .env
docker compose up -d
```

## 证书更新（一年一次）

```bash
# 替换 deploy/nginx/certs/ 下对应文件后：
docker exec walnut-nginx nginx -s reload
```

## 数据层说明

- 卷名 `mongodb_master_data` / `redis_data` 与旧 compose 一致 → 数据无缝继承
- MongoDB 三节点与 Redis 不再暴露公网端口（内部网络互访）
- 备份：`docker exec prod-mongodb-primary mongodump ...`（按需）
