# 从 Alpine 官方仓库同源安装 nginx + brotli 动态模块（同一次 apk 安装，版本必然匹配）
# 背景：nginx:alpine 官方镜像的 nginx 可能超前于仓库模块版本
# （如 1.27.5 镜像 vs 1.26.3 模块 → ABI 不匹配：module version 1026003 instead of 1027005）
FROM alpine:3.21

RUN apk add --no-cache nginx nginx-mod-http-brotli

# nginx-mod-http-brotli 包自带 /etc/nginx/modules/10_http_brotli.conf 自动加载模块
# （nginx.conf 默认 include /etc/nginx/modules/*.conf），再手动 load_module 会重复加载
# 报 [emerg] already loaded。仅当包未自动加载时兜底手动加载 → 模块恰好加载一次
RUN if ! grep -rq 'ngx_http_brotli' /etc/nginx/modules/ 2>/dev/null; then \
      printf 'load_module /usr/lib/nginx/modules/ngx_http_brotli_filter_module.so;\nload_module /usr/lib/nginx/modules/ngx_http_brotli_static_module.so;\n' > /etc/nginx/modules-brotli.conf \
      && sed -i '1i include /etc/nginx/modules-brotli.conf;' /etc/nginx/nginx.conf; \
    fi

# 构建期验证：模块加载失败（版本不匹配）→ 构建失败
RUN nginx -t

# 日志走 stdout/stderr。alpine 的 nginx 包默认把 access/error log 写进
# /var/log/nginx/*.log，容器里 `docker logs` 因此是空的（官方 nginx 镜像就是靠这两个
# 软链解决的）。部署后的 post-verify（deploy/post-verify.sh）要靠 docker logs 检查
# 5xx 与启动错误；frontend 镜像 FROM 本镜像，因此一并生效。
RUN ln -sf /dev/stdout /var/log/nginx/access.log \
    && ln -sf /dev/stderr /var/log/nginx/error.log

# 前台运行（Alpine nginx 包无官方镜像的 entrypoint）
CMD ["nginx", "-g", "daemon off;"]
