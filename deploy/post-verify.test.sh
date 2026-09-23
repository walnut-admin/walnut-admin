#!/usr/bin/env bash
#
# post-verify.sh 的行为测试 —— 用假的 docker / curl 覆盖各条失败分支，不需要真 Docker。
#
# 运行：bash deploy/post-verify.test.sh
# 退出码：0 全部通过；1 有用例失败
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/post-verify.sh"

pass=0
fail=0

# 假 docker：只实现 post-verify.sh 用到的 `inspect` 与 `logs`
make_fakes() {
  local bin="$1"
  cat > "$bin/docker" <<'FAKE'
#!/usr/bin/env bash
case "$1" in
  inspect)
    fmt="$3"
    container="${!#}"
    case "$fmt" in
      *RestartCount*) printf '%s %s\n' "${FAKE_STATUS:-running}" "${FAKE_RESTART:-0}" ;;
      *Config.Image*)
        name="${container#walnut-}"
        printf '%s\n' "${FAKE_IMAGE:-ccr.ccs.tencentyun.com/tron1997/"$name":${FAKE_TAG:-v9.9.9}}"
        ;;
    esac
    ;;
  logs)
    container="${!#}"
    case "$container" in
      *backend*) printf '%s\n' "${FAKE_BACKEND_LOGS:-APP is running in production mode on http://0.0.0.0:3000}" ;;
      *frontend*) printf '%s\n' "${FAKE_FRONTEND_LOGS:-1.2.3.4 - - [t] \"GET / HTTP/1.1\" 200 123}" ;;
      *nginx*) printf '%s\n' "${FAKE_NGINX_LOGS:-1.2.3.4 - - [t] \"GET / HTTP/1.1\" 200 123}" ;;
    esac
    ;;
esac
FAKE

  # 假 curl：`-D -` 时吐响应头（post-verify 的 check_security_headers 用），否则吐状态码。
  # 默认头**故意小写** —— 真 curl 打印的是服务器原样发出的大小写，而判据必须大小写不敏感。
  # 两个域名的头可分别覆盖（`FAKE_HEADERS` 前端 / `FAKE_HEADERS_API` 入口 API），
  # 因为它们是两个并列的 server 块，只覆盖一个正是要防的漏检。
  # `${VAR-default}` 而非 `${VAR:-default}`：**设了但为空**就是「一个头都没有」。
  cat > "$bin/curl" <<'FAKE'
#!/usr/bin/env bash
DEFAULT_HDRS='strict-transport-security: max-age=31536000
x-content-type-options: nosniff
x-frame-options: SAMEORIGIN
referrer-policy: strict-origin-when-cross-origin'
url=""; dump_headers=0
while [ $# -gt 0 ]; do
  case "$1" in
    -D)
      [ "${2:-}" = "-" ] && dump_headers=1
      shift 2 || shift
      continue
      ;;
    https://*) url="$1" ;;
  esac
  shift
done
case "$url" in
  *api.walnut-admin.com*) hdrs="${FAKE_HEADERS_API-$DEFAULT_HDRS}" ;;
  *) hdrs="${FAKE_HEADERS-$DEFAULT_HDRS}" ;;
esac
if [ "$dump_headers" = "1" ]; then
  printf '%s\n' "HTTP/2 200" "$hdrs"
else
  case "$url" in
    *api.walnut-admin.com*) printf '%s' "${FAKE_API_CODE:-200}" ;;
    *) printf '%s' "${FAKE_FRONT_CODE:-200}" ;;
  esac
fi
FAKE
  chmod +x "$bin/docker" "$bin/curl"
}

run_case() {
  local name="$1" expected="$2"
  shift 2
  local dir code
  dir="$(mktemp -d)"
  mkdir -p "$dir/deploy" "$dir/bin"
  printf 'IMG_TAG=v9.9.9\n' > "$dir/deploy/.env"
  make_fakes "$dir/bin"

  (
    cd "$dir" || exit 99
    # 场景变量必须以 `env` 方式注入：前缀赋值是解析期语法，不能由 "$@" 展开而来
    PATH="$dir/bin:$PATH" COMPOSE_DIR="$dir/deploy" ITER=2 INTERVAL=1 FAKE_TAG=v9.9.9 \
      env "$@" bash "$SCRIPT" 2 1
  ) > "$dir/log" 2>&1
  code=$?

  if [ "$code" -eq "$expected" ]; then
    printf '✅ %-34s exit=%s\n' "$name" "$code"
    pass=$((pass + 1))
  else
    printf '❌ %-34s exit=%s（期望 %s）\n' "$name" "$code" "$expected"
    sed 's/^/   | /' "$dir/log" | tail -n 12
    fail=$((fail + 1))
  fi
  rm -rf "$dir"
}

FATAL_LOG="Error: Nest can't resolve dependencies of the AppModule"

echo "== post-verify.sh 行为测试 =="
run_case '全部正常 → PASS'                 0
run_case '容器未运行 → 失败'               1 FAKE_STATUS=exited
run_case '容器重启过 → 失败'               1 FAKE_RESTART=3
run_case '镜像 tag 不匹配 → 失败'          1 FAKE_IMAGE='ccr.ccs.tencentyun.com/tron1997/backend:v0.0.1'
run_case '后端致命错误 → 立即失败'         1 FAKE_BACKEND_LOGS="$FATAL_LOG"
run_case '前端 5xx → 失败'                 1 FAKE_FRONTEND_LOGS='1.2.3.4 - - [t] "GET / HTTP/1.1" 502 123'
run_case '入口 nginx 5xx → 失败'           1 FAKE_NGINX_LOGS='1.2.3.4 - - [t] "GET / HTTP/1.1" 500 123'
run_case '前端非 200 → 超时失败'           1 FAKE_FRONT_CODE=503
run_case 'API 非 200 → 超时失败'           1 FAKE_API_CODE=502
run_case '后端无启动标记 → 超时失败'       1 FAKE_BACKEND_LOGS='booting, please wait...'
run_case '安全头全缺 → 超时失败'           1 FAKE_HEADERS=
run_case '只缺 Referrer-Policy → 失败'     1 FAKE_HEADERS='strict-transport-security: max-age=1
x-content-type-options: nosniff
x-frame-options: SAMEORIGIN'
run_case '仅 API 域名缺头 → 失败'          1 FAKE_HEADERS_API=
run_case '安全头取值不同 → 仍 PASS'        0 FAKE_HEADERS='Strict-Transport-Security: max-age=60
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer'

echo
printf '通过 %d，失败 %d\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
