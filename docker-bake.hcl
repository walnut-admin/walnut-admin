# Walnut Admin 镜像构建定义（docker buildx bake）
#
# 为什么用 bake：
# 1) 每个 target 有独立的 GHA 缓存 scope。历史问题：deploy.yml 三次 build 都写
#    cache-to: type=gha 而没写 scope —— buildx 的 scope 默认是 buildkit，多个镜像
#    互相覆盖对方的缓存（Docker 官方文档：each build will overwrite the cache of the
#    previous, leaving only the final cache），导致 backend 永远是冷构建：同一份
#    Dockerfile 实测在 15m49s ~ 77m53s 之间抖动，一次上线 85 分钟里它占 78 分钟。
# 2) backend 与 frontend 在同一个 bake 里并行构建（互不依赖）。
# 3) 一份定义同时服务 CI 与本地（pnpm images:build / images:push / images:print）。
#
# 构建上下文都是"薄"上下文：镜像本身只做 COPY，重活（pnpm install / SWC / Vite /
# pnpm deploy --prod）都在 runner（或本机）上完成。
# 见 release.yml 的 Stage 步骤与 apps/*/Dockerfile 顶部注释。
#
# 用法：
#   pnpm images:build                                   # 本地构建 backend + frontend
#   REGISTRY=... NS=... TAG=v1.2.3 pnpm images:push      # 构建并推送（CI 用法）
#   pnpm images:print                                    # 只打印解析结果，不构建
#
# nginx 单独用 docker build 处理（见 release.yml）：frontend 的 FROM 依赖 nginx:${TAG}
# 已存在于 registry（或本地镜像），所以先构建/推送 nginx，再用 bake 构建 backend+frontend ——
# 顺序确定，不依赖 bake 的 target 间隐式依赖。

variable "REGISTRY" {
  default = "ccr.ccs.tencentyun.com"
}

variable "NS" {
  default = "tron1997"
}

variable "TAG" {
  default = "local"
}

# 上下文位置由环境变量覆盖（bake 变量同名环境变量优先）。
# CI 把 staging 落在工作区之外（release.yml 的 IMAGE_STAGE=../walnut-image-staging），
# 免得 268MB / 4 万文件的产物进工作树；默认值即本地构建用的位置（.gitignore 已忽略）。
variable "SERVER_CONTEXT" {
  default = "build/image/server"
}

variable "FRONTEND_CONTEXT" {
  default = "build/image/frontend"
}

# Dockerfile 位置。默认值相对 **context 根**（staging 步骤会把 apps/*/Dockerfile 拷进去），
# CI 里则由 release.yml 传**绝对路径**覆盖 —— bake 的 `dockerfile` 字段相对谁解析（context /
# bake 文件 / cwd）文档没写清，绝对路径三种解释下都指向同一个文件，省掉一次试错发版。
variable "SERVER_DOCKERFILE" {
  default = "Dockerfile"
}

variable "FRONTEND_DOCKERFILE" {
  default = "Dockerfile"
}

# CI 里的默认组：nginx 已由前一步构建推送，这里只并行构建两个应用镜像
group "default" {
  targets = ["backend", "frontend"]
}

# 本地全量：nginx + 两个应用镜像。注意 frontend 依赖 nginx:${TAG}，
# 单独跑时请先 `docker build -f deploy/nginx/Dockerfile -t <REGISTRY>/<NS>/nginx:<TAG> deploy/nginx`
# （或直接按 deploy/README.md 的三步手工构建）。
group "all" {
  targets = ["nginx", "backend", "frontend"]
}

# nginx + brotli：apk 同源安装，构建期 nginx -t 兜底（上下文 = deploy/nginx，
# 其 .dockerignore 排除 certs/，证书私钥永不进入构建上下文）
target "nginx" {
  context    = "deploy/nginx"
  dockerfile = "deploy/nginx/Dockerfile"
  tags = [
    "${REGISTRY}/${NS}/nginx:${TAG}",
    # 稳定别名：apps/admin/Dockerfile 的默认 NGINX_BASE 指向它
    "${REGISTRY}/${NS}/nginx:brotli",
  ]
  cache-from = ["type=gha,scope=nginx"]
  cache-to   = ["type=gha,mode=max,scope=nginx,ignore-error=true"]
}

# 上下文 = 本机/runner 侧 `pnpm deploy --legacy --filter=@walnut/server --prod` 的产物
#
# `dockerfile` 在 bake 里是相对 **context** 解析的（不像 `docker build -f` 那样相对 cwd）——
# 所以 staging 步骤会把 `apps/server/Dockerfile` 拷到 context 根，这里按根引用。
# 写成 `apps/server/Dockerfile` 会让 bake 去 context 里找 `apps/server/`（staged 树里只有
# `apps/api`）⇒ 报 "failed to read dockerfile"（2026-09-30 v0.1.0 首次发版实测踩到）。
target "backend" {
  context    = SERVER_CONTEXT
  dockerfile = SERVER_DOCKERFILE
  tags       = ["${REGISTRY}/${NS}/backend:${TAG}"]
  cache-from = ["type=gha,scope=backend"]
  cache-to   = ["type=gha,mode=max,scope=backend,ignore-error=true"]
}

# 上下文 = 本机/runner 侧 Vite 产物 + 站点配置（<stage>/frontend/{html,frontend-server.conf,Dockerfile}）
# `dockerfile` 同理按 context 根引用（staging 步骤把 apps/admin/Dockerfile 拷了过来）
target "frontend" {
  context    = FRONTEND_CONTEXT
  dockerfile = FRONTEND_DOCKERFILE
  tags       = ["${REGISTRY}/${NS}/frontend:${TAG}"]
  args = {
    NGINX_BASE = "${REGISTRY}/${NS}/nginx:${TAG}"
  }
  cache-from = ["type=gha,scope=frontend"]
  cache-to   = ["type=gha,mode=max,scope=frontend,ignore-error=true"]
}
