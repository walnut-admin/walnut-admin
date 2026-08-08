FROM nginx:1.27-alpine

# Alpine 官方仓库提供 brotli 动态模块（与镜像内 nginx 同源同版本线）
RUN apk add --no-cache nginx-mod-http-brotli

# load_module 必须置于 http 块之前；官方 nginx.conf 若未 include modules 目录，
# 则覆盖 nginx.conf（见构建验证时的备选方案）
RUN printf 'load_module /usr/lib/nginx/modules/ngx_http_brotli_filter_module.so;\nload_module /usr/lib/nginx/modules/ngx_http_brotli_static_module.so;\n' > /etc/nginx/modules-brotli.conf \
    && sed -i '1a include /etc/nginx/modules-brotli.conf;' /etc/nginx/nginx.conf

# 构建期验证：模块加载失败（版本不匹配）→ 构建失败
RUN nginx -t
