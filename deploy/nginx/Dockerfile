# 从 Alpine 官方仓库同源安装 nginx + brotli 动态模块（同一次 apk 安装，版本必然匹配）
# 背景：nginx:alpine 官方镜像的 nginx 可能超前于仓库模块版本
# （如 1.27.5 镜像 vs 1.26.3 模块 → ABI 不匹配：module version 1026003 instead of 1027005）
FROM alpine:3.21

RUN apk add --no-cache nginx nginx-mod-http-brotli

# load_module 必须置于 http 块之前；插入到 Alpine nginx 包自带 nginx.conf 第一行
RUN printf 'load_module /usr/lib/nginx/modules/ngx_http_brotli_filter_module.so;\nload_module /usr/lib/nginx/modules/ngx_http_brotli_static_module.so;\n' > /etc/nginx/modules-brotli.conf \
    && sed -i '1i include /etc/nginx/modules-brotli.conf;' /etc/nginx/nginx.conf

# 构建期验证：模块加载失败（版本不匹配）→ 构建失败
RUN nginx -t

# 前台运行（Alpine nginx 包无官方镜像的 entrypoint）
CMD ["nginx", "-g", "daemon off;"]
