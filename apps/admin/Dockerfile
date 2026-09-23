# ---------- runtime（薄镜像）----------
# 前端产物由 CI 在 runner 上构建（Vite + brotli/gzip 预压缩，见 release.yml 的 Stage 步骤），
# 本文件只做 COPY。构建上下文 = build/image/frontend：
#   html/                 ← apps/admin/dist 的拷贝
#   frontend-server.conf  ← deploy/nginx/frontend-server.conf
#
# 基础镜像是同一次发布构建出的 nginx（含 brotli_static/filter 模块）：
# CI 先 build+push ${REGISTRY}/${NS}/nginx:${TAG}，再 bake 本 target，由 NGINX_BASE 拉取。
# 旧的本地 tag（walnut-admin/nginx-brotli:latest）耦合已移除 —— 那条路径依赖"必须先在本机
# 构建 nginx 镜像"，在 bake/并行构建下无法成立。
#
# 本地构建见 deploy/README.md「本地构建镜像」：
#   先 docker build -f deploy/nginx/Dockerfile -t walnut-admin/nginx-brotli:local deploy/nginx
#   再 docker build --build-arg NGINX_BASE=walnut-admin/nginx-brotli:local -f apps/admin/Dockerfile build/image/frontend
ARG NGINX_BASE=ccr.ccs.tencentyun.com/tron1997/nginx:brotli
FROM ${NGINX_BASE}

COPY html/ /usr/share/nginx/html/
COPY frontend-server.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
