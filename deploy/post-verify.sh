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
#
# **不在这里 `die`**（2026-09-30 实测的假红）：部署过程中 `docker compose up -d` 会**重建**容器，
# 重建的那一瞬间按名字 `docker inspect` 是查不到的 ⇒ 原来第一次轮询撞上窗口就整轮判死，
# 报出来的是 `容器 walnut-backend 状态异常：missing`，而实际上后端**Up 且 healthy**（同一轮
# 抓到的现场：`walnut-backend|Up 2 minutes (healthy)`）。整脚本本来就是个"最多 24 次的观察循环"，
# 瞬时状态必须允许重试 ⇒ 这里只记录问题，由主循环决定是否超时失败。
CONTAINERS_BAD=''
check_containers() {
  local c state status restarts bad=''
  for c in "$CONTAINER_BACKEND" "$CONTAINER_FRONTEND" "$CONTAINER_NGINX"; do
    state="$(docker inspect -f '{{.State.Status}} {{.State.RestartCount}}' "$c" 2>/dev/null || echo 'missing 0')"
    read -r status restarts <<< "$state"
    status="${status:-missing}"
    restarts="${restarts:-0}"
    if [ "$status" != "running" ]; then
      bad="$bad $c=$status"
    elif [ "$restarts" -ne 0 ]; then
      bad="$bad $c=重启${restarts}次"
    fi
  done
  CONTAINERS_BAD="${bad# }"
}

# ---- 运行中的镜像 tag 是否与 .env 的 IMG_TAG 一致 ----
# 同样不 `die`：重建窗口镜像 tag 也可能一时对不上，交给主循环的窗口去等。
IMAGE_TAG_BAD=''
check_image_tags() {
  local expected c image bad=''
  expected="$(grep -m1 '^IMG_TAG=' .env 2>/dev/null | cut -d= -f2- | tr -d '"')"
  [ -n "$expected" ] || { IMAGE_TAG_BAD=''; return 0; }
  for c in "$CONTAINER_BACKEND" "$CONTAINER_FRONTEND" "$CONTAINER_NGINX"; do
    image="$(docker inspect -f '{{.Config.Image}}' "$c" 2>/dev/null || true)"
    case "$image" in
      *":$expected") ;;
      *) bad="$bad $c=${image:-取不到}" ;;
    esac
  done
  IMAGE_TAG_BAD="${bad# }"
}

# ---- 后端日志：致命错误 / 启动标记 ----
#
# **已知良性噪声的单行豁免**（2026-09-30 实测：它把 v0.1.8 的部署判死过一次）。
#
# 空库首次启动时，`app_setting` 里还没有任何设置，`AppTechCacheAppSettingsService.getSetting`
# 会走 `JSON.parse(undefined)` ⇒ 抛 `SyntaxError: "undefined" is not valid JSON` ⇒ **被它自己的
# catch 接住并返回默认值**（源码里就有 try/catch）—— 也就是说：**这行是「已捕获」的日志噪声，
# 应用照常启动**。而 `FATAL_RE` 里的 `SyntaxError` 会把它判成致命错误。
#
# 为什么必须豁免而不是"让后端别打"：那是应用代码的日志策略，不该由部署脚本要求它改；
# 而且首次部署（空库）**必然**出现这行 ⇒ 不豁免就等于"首次部署永远失败"。
#
# 豁免条件写得**极窄**：要么是那条服务名 + 那句话，要么是**那句消息本身**所在的 stack 行
# （实测：这条日志是**多行**的 —— `SyntaxError: "undefined" is not valid JSON` 在单独一行上，
# 只豁免第一行不够，本地重放当场抓到）。真正的 SyntaxError（别的消息）仍然会命中 FATAL_RE。
BENIGN_RE='AppTechCacheAppSettingsService.*"undefined" is not valid JSON|SyntaxError: "undefined" is not valid JSON'

scan_backend_logs() {
  local logs health
  # 「后端是否就绪」优先看**容器健康状态**（compose 的 healthcheck 探的就是那个静态路由），
  # 而不是日志里的启动标记 —— 2026-09-30 实测出的坑：镜像没变时 compose **不会重建**后端，
  # 于是它的日志里已经积了几个小时的 cron 行，`--tail 300` 早就把启动标记挤出去 ⇒
  # `BACKEND_READY` 永远是 0 ⇒ post-verify 必然跑满 24 轮超时（部署假红）。
  # 健康状态与日志长度无关，且正是 `docker compose up --wait` 判过的同一件事。
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$CONTAINER_BACKEND" 2>/dev/null || true)"
  if [ "$health" = "healthy" ]; then
    BACKEND_READY=1
  fi

  # 日志仍然要看：**致命错误**的判据不能因为"没重建容器"而失效（那种情况下更要看老日志）。
  # 窗口从 300 行放宽到 3000 行，避免长时间运行的容器把错误挤出窗口。
  logs="$(docker logs --tail 3000 "$CONTAINER_BACKEND" 2>&1 || true)"
  logs="$(printf '%s\n' "$logs" | grep -Ev "$BENIGN_RE" || true)"
  if printf '%s\n' "$logs" | grep -Eq "$FATAL_RE"; then
    printf '%s\n' "$logs" | grep -E "$FATAL_RE" | tail -n 15
    die "后端日志出现致命错误"
  fi
  # 没有 healthcheck 定义时（health 为空）退回日志标记，且同样用放宽后的窗口。
  if [ "$BACKEND_READY" != "1" ] && printf '%s\n' "$logs" | grep -q "$READY_RE"; then
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
  say "#$i 就绪=$BACKEND_READY 容器='${CONTAINERS_BAD}' tag='${IMAGE_TAG_BAD}' 前端=$FRONT_CODE API=$API_CODE 缺失安全头='${HEADERS_MISSING}'"
  if [ "$BACKEND_READY" = "1" ] && [ -z "$CONTAINERS_BAD" ] && [ -z "$IMAGE_TAG_BAD" ] \
    && [ "$FRONT_CODE" = "200" ] && [ "$API_CODE" = "200" ] && [ -z "$HEADERS_MISSING" ]; then
    printf '\n✅ POST-VERIFY PASS（第 %s 次轮询：容器 running、镜像 tag 一致、后端已就绪，前端 200，API 200，安全头齐备）\n' "$i"
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

# **先把探测值归一化再比较**（2026-09-30 实测的坑）：`[ "$API_CODE" = "200" ]` 是逐字符比较，
# 而 curl 的 `-w '%{http_code}'` 经过命令替换/远端传输后可能带上 CR 或空白 ⇒ 值"看起来是 200"
# 却不等于 "200"，于是死在一句**自相矛盾**的 `超时：API 域名返回 200（期望 200）` 上，
# 把排查带偏了好几轮。这里先去掉所有空白字符，再逐项判，且每项的消息只说**自己这一项**。
FRONT_CODE="$(printf '%s' "${FRONT_CODE:-}" | tr -d '[:space:]')"
API_CODE="$(printf '%s' "${API_CODE:-}" | tr -d '[:space:]')"

say "最终各项：就绪=$BACKEND_READY 容器='${CONTAINERS_BAD}' tag='${IMAGE_TAG_BAD}' 前端='$FRONT_CODE' API='$API_CODE' 缺失安全头='${HEADERS_MISSING}'"
[ -z "$CONTAINERS_BAD" ] || die "超时：容器状态不对 [$CONTAINERS_BAD]（部署在重建窗口内没等到 running？）"
[ -z "$IMAGE_TAG_BAD" ] || die "超时：运行中的镜像与 IMG_TAG 不一致 [$IMAGE_TAG_BAD]"
[ "$BACKEND_READY" = "1" ] || die "超时：后端既不是 healthy、日志里也没有启动标记（匹配 $READY_RE）"
[ "$FRONT_CODE" = "200" ] || die "超时：前端域名返回 '$FRONT_CODE'（期望 200）"
[ -z "$HEADERS_MISSING" ] || die "超时：入口 nginx 仍缺安全响应头 [$HEADERS_MISSING]（改的是 deploy/nginx/conf.d/frontend.conf？重载了吗？）"
[ "$API_CODE" = "200" ] || die "超时：API 域名返回 '$API_CODE'（期望 200）"
