#!/usr/bin/env bash
# 每周复盘：采集会话 → 生成周报（MD + 可勾选 HTML）。
#
# 调度：macOS 用 launchd、Windows 用任务计划程序 —— 都由 scripts/schedule.sh 安装
# 手动：bash ~/.dsh/learning/scripts/run-weekly.sh
# 隔离测试：DSH_LEARNING=/tmp/xx bash run-weekly.sh（不碰真实周报）
#
# 依赖：node（自动找：DSH_NODE → PATH → DSH runtime → Windows 常见安装位置）
#       zstd（会话是多帧 zstd，需要 CLI；DSH_ZSTD 可覆盖）
set -uo pipefail
umask 077  # 周报含会话标题/路径，默认仅 owner 可读写

BASE="${DSH_LEARNING:-$HOME/.dsh/learning}"
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"   # 脚本永远在自身目录，隔离试跑时 BASE 只管产出
# 调度器写入的持久配置（Windows 的 schtasks 不能带环境变量 → 统一走文件）
[ -f "$BASE/schedule.env" ] && . "$BASE/schedule.env"
DAYS="${DSH_WEEKLY_DAYS:-7}"

find_node() {
  local c
  [ -n "${DSH_NODE:-}" ] && [ -x "${DSH_NODE}" ] && { printf '%s\n' "$DSH_NODE"; return 0; }
  c="$(command -v node 2>/dev/null || true)"
  [ -n "$c" ] && { printf '%s\n' "$c"; return 0; }
  for c in "$HOME"/.dsh/dsh-runtimes/*/dependencies/node/bin/node \
           "$HOME"/.dsh/dsh-runtimes/*/dependencies/node/bin/node.exe; do
    [ -x "$c" ] && { printf '%s\n' "$c"; return 0; }
  done
  # 桌面端自带 runtime 的 node：装了 DSH 就有，不需要另装 node。
  # 路径与 scripts/_lib.sh 的 find_node 保持一致（两边各自独立，别只改一处）。
  for c in "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node" \
           "$HOME/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node" \
           "/c/Program Files/DeepSeek Harness/resources/runtime/primary-runtime/dependencies/node/bin/node.exe" \
           "${LOCALAPPDATA:-/nonexistent}/Programs/DeepSeek Harness/resources/runtime/primary-runtime/dependencies/node/bin/node.exe"; do
    [ -x "$c" ] && { printf '%s\n' "$c"; return 0; }
  done
  for c in "/c/Program Files/nodejs/node.exe" \
           "${LOCALAPPDATA:-/nonexistent}/Programs/nodejs/node.exe" \
           "$HOME/scoop/shims/node.exe"; do
    [ -x "$c" ] && { printf '%s\n' "$c"; return 0; }
  done
  return 1
}

find_zstd() {
  local c
  [ -n "${DSH_ZSTD:-}" ] && [ -x "${DSH_ZSTD}" ] && { printf '%s\n' "$DSH_ZSTD"; return 0; }
  c="$(command -v zstd 2>/dev/null || true)"
  [ -n "$c" ] && { printf '%s\n' "$c"; return 0; }
  for c in /opt/homebrew/bin/zstd /usr/local/bin/zstd /usr/bin/zstd \
           "${LOCALAPPDATA:-/nonexistent}/Microsoft/WinGet/Links/zstd.exe" \
           "$HOME/scoop/shims/zstd.exe" "/c/ProgramData/chocolatey/bin/zstd.exe"; do
    [ -x "$c" ] && { printf '%s\n' "$c"; return 0; }
  done
  # winget 不建 Links 别名，只把版本化包目录塞进 PATH → 有界递归扫（版本号目录名会变）
  local wgp="${LOCALAPPDATA:-/nonexistent}/Microsoft/WinGet/Packages"
  if [ -d "$wgp" ]; then
    c="$(find "$wgp" -maxdepth 3 -iname 'zstd.exe' 2>/dev/null | head -1)"
    [ -n "$c" ] && { printf '%s\n' "$c"; return 0; }
  fi
  return 1
}

NODE="$(find_node)" || {
  echo "找不到 node。设 DSH_NODE=/path/to/node，或把 node 加进 PATH。" >&2
  exit 1
}
ZSTD="$(find_zstd)" || {
  echo "找不到 zstd：会话文件是多帧 zstd，缺它无法完整解压。" >&2
  case "$(uname -s)" in
    Darwin) echo "  安装：brew install zstd" >&2 ;;
    MINGW*|MSYS*|CYGWIN*) echo "  安装：winget install Meta.Zstandard（或 scoop install zstd）" >&2 ;;
    *) echo "  安装：apt install zstd ；或设 DSH_ZSTD=/path/to/zstd" >&2 ;;
  esac
  exit 2
}
export DSH_ZSTD="$ZSTD"

mkdir -p "$BASE/weekly" "$BASE/logs"

# 换机首次运行：仓库带了脱敏 history 副本（apply 会装到 scripts/），本机没有就播种
if [ ! -f "$BASE/weekly/history.jsonl" ] && [ -f "$SCRIPTS/history.jsonl" ]; then
  cp "$SCRIPTS/history.jsonl" "$BASE/weekly/history.jsonl"
  echo "history 首次播种：来自 $SCRIPTS/history.jsonl"
fi

# 单实例锁：两个 run-weekly 同时写同一 learning 目录会互相覆盖（回填 + 本周并发实测会丢报告）
LOCK="$BASE/.weekly.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  # 上次被 SIGKILL 时 trap 不会跑，锁会永久残留：用 pid 判断持有者是否还活着
  OLD_PID="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [ -n "${OLD_PID}" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "another weekly run is in progress (pid ${OLD_PID}, ${LOCK}); exit to avoid overwriting" >&2
    exit 3
  fi
  echo "stale lock removed (pid '${OLD_PID}' not running): ${LOCK}" >&2
  rm -rf "$LOCK"
  mkdir "$LOCK" 2>/dev/null || { echo "lock 创建失败：${LOCK}" >&2; exit 3; }
fi
echo "$$" >"$LOCK/pid"
trap 'rm -rf "${LOCK}" 2>/dev/null || true' EXIT
LOG="$BASE/logs/weekly-$(date +%Y%m%d-%H%M%S).log"
exec 3>&1                      # 保留原始 stdout：手动跑时把结果给人看，调度器跑时没人看也无害
exec >>"$LOG" 2>&1

echo "=== $(date '+%F %T') 开始周报（窗口 ${DAYS} 天）==="
echo "node：$NODE"
echo "zstd：$ZSTD"
echo "base：$BASE"

"$NODE" "$SCRIPTS/collect.mjs" "$DAYS" || { echo "❌ 采集失败"; printf '采集失败，看日志：%s\n' "$LOG" >&3; exit 1; }

# 分析包 packet.md：给会话里的模型读的工作流上下文（确定性生成，不调模型）
# --check 是门控：digest 不是 v2 就跳过，绝不让它阻断统计版周报
# 0 会话不算成功：否则会把已有周报/digest 备份/history 覆盖成空壳（实测不可逆）
SESSIONS="$("$NODE" -e 'try{const d=require(process.argv[1]);process.stdout.write(String(d.totalSessions||0))}catch(e){process.stdout.write("0")}' "$BASE/weekly/digest.json" 2>/dev/null || echo 0)"
if [ "${SESSIONS:-0}" = "0" ]; then
  echo "❌ 本周命中 0 个会话，拒绝生成空周报（保留上一份报告不动）"
  printf '本周 0 个会话，未覆盖既有报告。检查采集窗口/DSH_SESSIONS。\n' >&3
  exit 2
fi

if [ -f "$SCRIPTS/condense.mjs" ]; then
  # 只跑一次：condense 自身能处理旧 digest 并写明降级，不需要额外 --check 进程
  "$NODE" "$SCRIPTS/condense.mjs" --budget="${DSH_PACKET_BUDGET:-20000}" \
    && echo "分析包：$BASE/weekly/packet.md" \
    || echo "⚠️ 分析包生成失败（统计版周报不受影响）"
fi

"$NODE" "$SCRIPTS/report.mjs"        || { echo "❌ 生成 MD 失败"; printf '生成 MD 失败，看日志：%s\n' "$LOG" >&3; exit 1; }
"$NODE" "$SCRIPTS/report-html.mjs"   || { echo "❌ 生成 HTML 失败"; printf '生成 HTML 失败，看日志：%s\n' "$LOG" >&3; exit 1; }
REDACT="${DSH_WEEKLY_REDACT:-1}"
if [ "$REDACT" = "1" ] && [ -f "$SCRIPTS/redact-report.mjs" ]; then
  "$NODE" "$SCRIPTS/redact-report.mjs" || echo "⚠️ 报告脱敏失败（原文件保留）"
fi

# 周号由 digest 的窗口终点算，不要用 ls -t：并发/时钟偏斜时会把别的周归档错位
W="$("$NODE" -e 'const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const t=new Date(d.windowEnd||d.generatedAt);const u=new Date(Date.UTC(t.getFullYear(),t.getMonth(),t.getDate()));const day=u.getUTCDay()||7;u.setUTCDate(u.getUTCDate()+4-day);const ys=new Date(Date.UTC(u.getUTCFullYear(),0,1));process.stdout.write(u.getUTCFullYear()+"-W"+String(Math.ceil(((u-ys)/86400000+1)/7)).padStart(2,"0"))' "$BASE/weekly/digest.json" 2>/dev/null || true)"
WEEK="$BASE/weekly/$W.md"
[ -f "$WEEK" ] || WEEK=""
if [ -n "${WEEK:-}" ]; then
  W="$(basename "$WEEK" .md)"
  cp -p "$BASE/weekly/digest.json" "$BASE/weekly/digest-$W.json" 2>/dev/null || true
  echo "周报：$WEEK"
fi
echo "=== $(date '+%F %T') 完成 ==="

# 系统通知：只有 macOS 有 osascript；其它平台跳过（报告本身就在文件里）
if [ -n "${WEEK:-}" ] && [ "$(uname -s)" = "Darwin" ] && [ -z "${DSH_NO_NOTIFY:-}" ]; then
  /usr/bin/osascript -e "display notification \"$W 已生成（MD + 可勾选 HTML）\" with title \"DSH 周报复盘\" subtitle \"$(date '+%m-%d')\" sound name \"Glass\"" >/dev/null 2>&1 || true
fi

# 收尾自检：提前发现环境漂移（node/zstd/权限）。不阻断已生成的报告，失败用独立退出码。
SELFTEST_RC=0
if [ -z "${DSH_NO_SELFTEST:-}" ] && [ -f "$SCRIPTS/selftest.sh" ]; then
  STLOG="$BASE/logs/selftest-$(date +%Y%m%d-%H%M%S).log"
  if bash "$SCRIPTS/selftest.sh" >"$STLOG" 2>&1; then
    echo "自检：通过（${STLOG}）"
  else
    SELFTEST_RC=4
    echo "❌ 自检未通过，详见 $STLOG"
  fi
fi

if [ -n "${WEEK:-}" ]; then
  printf '周报已生成：%s\n日志：%s\n' "$WEEK" "$LOG" >&3 2>/dev/null || true
  if [ "$SELFTEST_RC" -ne 0 ]; then printf '⚠️ 自检未通过，详见 %s/logs/selftest-*.log\n' "$BASE" >&3 2>/dev/null || true; fi
  exit "$SELFTEST_RC"
fi
printf '没有生成周报，看日志：%s\n' "$LOG" >&3 2>/dev/null || true
exit 1
