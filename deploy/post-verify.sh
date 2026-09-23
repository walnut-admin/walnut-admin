#!/usr/bin/env bash
#
# 部署后验证（post-verify）—— 由 CI 在服务器上调用（见 .github/workflows/deploy.yml）
#
# 为什么需要：`docker compose up -d --wait` 只能证明"容器起来了 + healthcheck 过了"，
# 不能证明"服务真的在正常工作"。本脚本在部署后持续观察一段时间：
#   1) 三个容器的状态与**重启次数**（restart: always 会把崩溃重启伪装成"一直 running"）
#   2) 运行中的镜像 tag 是否就是本次要部署的 tag
#   3) 后端日志：是否出现致命错误、是否出现启动成功标记
#   4) 前端与入口 nginx 日志：是否出现 5xx（日志走 stdout，见 deploy/nginx/Dockerfile）
#   5) 端到端请求：经公网域名（--resolve 指回本机）访问前端与 API 静态路由
#   6) 安全响应头：入口 nginx 有没有把 HSTS 等 4 个头发出来（见下方 check_security_headers）
# 轮询期内任一硬条件不满足 → 退出码 1，CI 步骤失败（部署不判成功）。
#
# 用法：post-verify.sh [轮询次数] [间隔秒]   默认 24 × 5s = 2 分钟
set -uo pipefail   # 故意不用 -e：要自己收集失败原因并打印上下文

ITER="${1:-24}"
INTERVAL="${2:-5}"
COMPOSE_DIR="${COMPOSE_DIR:-/home/ubuntu/walnut-admin/deploy}"

CONTAINER_BACKEND="${CONTAINER_BACKEND:-walnut-backend}"
CONTAINER_FRONTEND="${CONTAINER_FRONTEND:-walnut-frontend}"
CONTAINER_NGINX="${CONTAINER_NGINX:-walnut-nginx}"

FRONT_DOMAIN="${FRONT_DOMAIN:-www.walnut-admin.com}"
API_DOMAIN="${API_DOMAIN:-api.walnut-admin.com}"
API_PROBE_PATH="${API_PROBE_PATH:-/w/v1/static/images/demo.png}"

# 后端起不来时的典型特征。保守取值：宁可漏报也不误报，
# 漏报还有 healthcheck 与 --wait 兜底，误报会让部署白白失败。
FATAL_RE='Nest can.t resolve|MODULE_NOT_FOUND|Cannot find module|EADDRINUSE|UnhandledPromiseRejection|MongoServerError|MongooseError|ECONNREFUSED|FATAL|SyntaxError|ReferenceError'
# 后端启动成功标记：apps/server/apps/api/src/main.ts 中 app.listen() 之后的 console.log
READY_RE='APP is running in'

BACKEND_READY=0
FRONT_CODE=""
API_CODE=""
HEADERS_MISSING=""

say() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }

die() {
  printf '\n❌ POST-VERIFY FAILED: %s\n' "$*"
  exit 1
}

# ---- 容器状态与重启次数 ----
check_containers() {
  local c state status restarts
  for c in "$CONTAINER_BACKEND" "$CONTAINER_FRONTEND" "$CONTAINER_NGINX"; do
    state="$(docker inspect -f '{{.State.Status}} {{.State.RestartCount}}' "$c" 2>/dev/null || echo 'missing 0')"
    read -r status restarts <<< "$state"
    status="${status:-missing}"
    restarts="${restarts:-0}"
    [ "$status" = "running" ] || die "容器 $c 状态异常：$status（期望 running）"
    [ "$restarts" -eq 0 ] || die "容器 $c 已重启 $restarts 次（崩溃循环？）"
  done
}

# ---- 运行中的镜像 tag 是否与 .env 的 IMG_TAG 一致 ----
check_image_tags() {
  local expected c image
  expected="$(grep -m1 '^IMG_TAG=' .env 2>/dev/null | cut -d= -f2- | tr -d '"')"
  [ -n "$expected" ] || return 0
  for c in "$CONTAINER_BACKEND" "$CONTAINER_FRONTEND" "$CONTAINER_NGINX"; do
    image="$(docker inspect -f '{{.Config.Image}}' "$c" 2>/dev/null || true)"
    case "$image" in
      *":$expected") ;;
      *) die "容器 $c 运行的镜像不是本次 tag：$image（期望以 :$expected 结尾）" ;;
    esac
  done
}

# ---- 后端日志：致命错误 / 启动标记 ----
scan_backend_logs() {
  local logs
  logs="$(docker logs --tail 300 "$CONTAINER_BACKEND" 2>&1 || true)"
  if printf '%s\n' "$logs" | grep -Eq "$FATAL_RE"; then
    printf '%s\n' "$logs" | grep -E "$FATAL_RE" | tail -n 15
    die "后端日志出现致命错误"
  fi
  if printf '%s\n' "$logs" | grep -q "$READY_RE"; then
    BACKEND_READY=1
  fi
}

# ---- 前端 / 入口 nginx 日志：5xx ----
scan_http_logs() {
  local c logs n
  for c in "$CONTAINER_FRONTEND" "$CONTAINER_NGINX"; do
    logs="$(docker logs --tail 300 "$c" 2>&1 || true)"
    n="$(printf '%s\n' "$logs" | grep -Ec '" 5[0-9]{2} ' || true)"
    n="${n:-0}"
    if [ "$n" -gt 0 ]; then
      printf '%s\n' "$logs" | grep -E '" 5[0-9]{2} ' | tail -n 5
      die "容器 $c 出现 $n 条 5xx 响应"
    fi
  done
}

# ---- 端到端：公网域名指回本机，绕过 CDN/公网 DNS ----
probe_urls() {
  FRONT_CODE="$(curl -sk -o /dev/null -w '%{http_code}' --resolve "$FRONT_DOMAIN:443:127.0.0.1" "https://$FRONT_DOMAIN/" -m 10 || true)"
  API_CODE="$(curl -sk -o /dev/null -w '%{http_code}' --resolve "$API_DOMAIN:443:127.0.0.1" "https://$API_DOMAIN$API_PROBE_PATH" -m 10 || true)"
}

# ---- 安全响应头：入口 nginx 有没有把它们发出来 ----
#
# 为什么在这里验：本机没有 Docker，`deploy/nginx/conf.d/*.conf` 的改动
# **没有任何本地手段能验证**（`pnpm lint:workflows` 那个 actionlint 管不到 nginx）。
# 部署后这一次是唯一验得到的地方，所以它是**硬条件**而不是提示。
#
# 判据是「响应头里出现了这几个名字」，**不比对取值** —— 取值会随运维调整（如 HSTS max-age），
# 逐字比对会变成误报源。用 `-D -` 单独取一次头，不复用 probe_urls 的 `-w '%{http_code}'`。
#
# **两个域名都要查**：`frontend.conf` 与 `api.conf` 是两个并列的 server 块，nginx 的
# `add_header` 不跨 server 块继承 —— 只查前端域名会漏掉整个 api 域名（那个坑实测踩过）。
check_security_headers() {
  local domain hdrs name miss missing=''
  for domain in "$FRONT_DOMAIN" "$API_DOMAIN"; do
    hdrs="$(curl -sk -D - -o /dev/null --resolve "$domain:443:127.0.0.1" "https://$domain/" -m 10 || true)"
    miss=''
    for name in Strict-Transport-Security X-Content-Type-Options X-Frame-Options Referrer-Policy; do
      # 头名大小写不敏感；`|| true` 防空集时 grep 的退出码把脚本带偏
      printf '%s\n' "$hdrs" | grep -qi "^${name}:" || miss="$miss $name"
    done
    [ -z "$miss" ] || missing="$missing $domain:$miss"
  done
  HEADERS_MISSING="${missing# }"
}

# ------------------------------ main ------------------------------

cd "$COMPOSE_DIR" || die "找不到部署目录 $COMPOSE_DIR"

IMG_TAG="$(grep -m1 '^IMG_TAG=' .env 2>/dev/null | cut -d= -f2- | tr -d '"')"
say "post-verify 开始：IMG_TAG=${IMG_TAG:-未知}，最多 $ITER 次 × ${INTERVAL}s"
say "检查项：容器状态/重启次数、镜像 tag、后端日志、nginx 5xx、安全响应头、前端+API 端到端"

i=0
while [ "$i" -lt "$ITER" ]; do
  i=$((i + 1))
  check_containers
  check_image_tags
  scan_backend_logs
  scan_http_logs
  probe_urls
  check_security_headers
  say "#$i 后端就绪=$BACKEND_READY 前端=$FRONT_CODE API=$API_CODE 缺失安全头='${HEADERS_MISSING}'"
  if [ "$BACKEND_READY" = "1" ] && [ "$FRONT_CODE" = "200" ] && [ "$API_CODE" = "200" ] && [ -z "$HEADERS_MISSING" ]; then
    printf '\n✅ POST-VERIFY PASS（第 %s 次轮询：后端已就绪，前端 200，API 200，安全头齐备）\n' "$i"
    exit 0
  fi
  if [ "$i" -lt "$ITER" ]; then
    sleep "$INTERVAL"
  fi
done

# 超时：把现场日志打出来再失败，省得再去服务器上翻
say '--- 诊断：后端日志尾部 ---'
docker logs --tail 40 "$CONTAINER_BACKEND" 2>&1 || true
say '--- 诊断：入口 nginx 日志尾部 ---'
docker logs --tail 20 "$CONTAINER_NGINX" 2>&1 || true

[ "$BACKEND_READY" = "1" ] || die "超时：后端日志始终没有出现启动标记（匹配 $READY_RE）"
[ "$FRONT_CODE" = "200" ] || die "超时：前端域名返回 $FRONT_CODE（期望 200）"
[ -z "$HEADERS_MISSING" ] || die "超时：入口 nginx 仍缺安全响应头 [$HEADERS_MISSING]（改的是 deploy/nginx/conf.d/frontend.conf？重载了吗？）"
die "超时：API 域名返回 $API_CODE（期望 200）"
