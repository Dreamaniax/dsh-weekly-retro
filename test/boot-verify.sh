#!/usr/bin/env bash
# 在隔离的 DSH_HOME 里真启动 web，然后断言插件挂载成功。
# 用法：bash test/boot-verify.sh   （不碰你真实的 profile / 不重启 GUI）
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
CLI="${DSH_CLI:-/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh}"
SRC="${DSH_SOURCE_PROFILE:-$HOME/.dsh/profiles/desktop}"
PORT="${DSH_VERIFY_PORT:-62290}"
V="$(mktemp -d /tmp/dsh-weekly-verify.XXXXXX)"
PATCH="$V/plugin.patch.yml"
cleanup() { [ -n "${PID:-}" ] && kill "$PID" 2>/dev/null; rm -rf "$V"; }
trap cleanup EXIT

[ -x "$CLI" ] || { echo "FAIL: 找不到 dsh CLI：$CLI"; exit 1; }
[ -d "$SRC" ] || { echo "FAIL: 找不到源 profile：$SRC"; exit 1; }

mkdir -p "$V/profiles/web"
cp "$SRC/package.json" "$SRC/cordis.yml" "$SRC/cordis.patch.yml" "$V/profiles/web/" 2>/dev/null || true
ln -s "$SRC/node_modules" "$V/profiles/web/node_modules"
# 默认用 --patch 覆盖层试挂；DSH_NO_PATCH=1 时直接验证 profile 自身的 bundles（用于装回后复验）
if [ "${DSH_NO_PATCH:-0}" = "1" ]; then
  echo "（DSH_NO_PATCH=1：直接验证 profile bundles，不用覆盖层）"
  DSH_HOME="$V" nohup "$CLI" --profile web --no-open --port "$PORT" > "$V/web.log" 2>&1 &
else
  cat > "$PATCH" <<'YML'
- insert:
    - id: dsh-weekly-retro
      name: dsh-weekly-retro
YML
  DSH_HOME="$V" nohup "$CLI" --profile web --patch "$PATCH" --no-open --port "$PORT" > "$V/web.log" 2>&1 &
fi
PID=$!

CODE=000
i=0
while [ "$i" -lt 50 ]; do
  i=$((i + 1))
  sleep 1
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$PORT/" 2>/dev/null || echo 000)
  { [ "$CODE" = "200" ] || [ "$CODE" = "401" ]; } && break
done
if [ "$CODE" != "200" ] && [ "$CODE" != "401" ]; then
  echo "FAIL: web 未启动（最后 http=${CODE}），日志尾部："; tail -15 "$V/web.log"; exit 1
fi

DIAG=$(curl -s --max-time 8 "http://127.0.0.1:$PORT/dsh-weekly-retro/diagnostics")
SUM=$(curl -s --max-time 8 "http://127.0.0.1:$PORT/dsh-weekly-retro/summary")
echo "diagnostics: $DIAG"
echo "summary: ${SUM:0:160}…"

# UI 端点冒烟（client 半不会在这里渲染，但数据面必须通）
UI_OV=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:$PORT/dsh-weekly-retro/ui/overview")
UI_MT=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:$PORT/dsh-weekly-retro/ui/metrics")
UI_CD=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:$PORT/dsh-weekly-retro/ui/candidates")
echo "ui endpoints: overview=$UI_OV metrics=$UI_MT candidates=$UI_CD"
if [ "$UI_OV" != "200" ] || [ "$UI_MT" != "200" ] || [ "$UI_CD" != "200" ]; then
  echo "FAIL: UI 数据端点未全 200"; exit 1
fi
# 启动日志中不得出现本插件未激活/报错
if grep -E "dsh-weekly-retro.*(did not activate|failed to import|Error)" "$V/web.log" >/dev/null 2>&1; then
  echo "FAIL: 启动日志里有本插件错误："; grep -E "dsh-weekly-retro" "$V/web.log" | head -5; exit 1
fi
echo "boot log: 无 dsh-weekly-retro 错误"

node -e '
const d=JSON.parse(process.argv[1]||"{}");
const bad=[];
if(!d.ok) bad.push("ok!=true");
if(d.tools!==true) bad.push("tools 未注册："+(d.toolError||"?"));
if(d.toolCount!==4) bad.push("toolCount="+d.toolCount+"（期望 4）");
if(d.commands!==true) bad.push("commands 未注册");
if(d.routes!==13) bad.push("routes="+d.routes+"（期望 13）");
if(bad.length){console.error("FAIL: "+bad.join(" | "));process.exit(1)}
console.log("PASS: tools=4 · commands=1 · routes=13");
' "$DIAG"
