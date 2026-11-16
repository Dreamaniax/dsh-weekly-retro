#!/usr/bin/env bash
# Phase 1 验收：隔离 DSH_HOME（默认不含用户技能）加载本仓库的插件，
# 断言 runtime skill 真的注册成功；WITH_USER_SKILL=1 时再测同名冲突。
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
CLI="${DSH_CLI:-/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh}"
SRC="${DSH_SOURCE_PROFILE:-$HOME/.dsh/profiles/desktop}"
PORT="${DSH_SKILL_CANARY_PORT:-62339}"
V="$(mktemp -d /tmp/dsh-weekly-skill-canary.XXXXXX)"
PID=""
cleanup() { [ -n "${PID:-}" ] && kill "$PID" 2>/dev/null || true; rm -rf "$V"; }
trap cleanup EXIT

[ -x "$CLI" ] || { echo "FAIL: 找不到 dsh CLI：$CLI"; exit 1; }
[ -d "$SRC" ] || { echo "FAIL: 找不到源 profile：$SRC"; exit 1; }

mkdir -p "$V/profiles/web/node_modules"
cp "$SRC/package.json" "$SRC/cordis.yml" "$SRC/cordis.patch.yml" "$V/profiles/web/" 2>/dev/null || true
if [ "${WITH_USER_SKILL:-0}" = "1" ]; then
  mkdir -p "$V/skills"
  cp -R "$HOME/.dsh/skills/weekly-retro" "$V/skills/weekly-retro"
  echo "canary mode: 含用户技能（同名冲突探针）"
else
  echo "canary mode: 无用户技能"
fi

# 用真实 node_modules 的顶层 symlink 保留宿主依赖，再把插件替换成本仓库副本。
for p in "$SRC"/node_modules/* "$SRC"/node_modules/.[!.]*; do
  [ -e "$p" ] || continue
  b="$(basename "$p")"
  [ "$b" = "dsh-weekly-retro" ] && continue
  ln -s "$p" "$V/profiles/web/node_modules/$b"
done
mkdir -p "$V/profiles/web/node_modules/dsh-weekly-retro"
rsync -a --exclude .git --exclude test --exclude docs --exclude '.DS_Store' \
  "$HERE/" "$V/profiles/web/node_modules/dsh-weekly-retro/" 2>/dev/null \
  || cp -R "$HERE/lib" "$HERE/skills" "$HERE/pipeline" "$HERE/package.json" "$HERE/cordis.patch.yml" \
       "$V/profiles/web/node_modules/dsh-weekly-retro/"

PATCH="$V/plugin.patch.yml"
cat > "$PATCH" <<'YML'
- insert:
    - id: dsh-weekly-retro
      name: dsh-weekly-retro
YML

DSH_HOME="$V" nohup "$CLI" --profile web --patch "$PATCH" --no-open --port "$PORT" > "$V/web.log" 2>&1 &
PID=$!
CODE=000
for _ in $(seq 1 60); do
  sleep 1
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$PORT/" 2>/dev/null || echo 000)
  [ "$CODE" = "200" ] || [ "$CODE" = "401" ] && break
done
if [ "$CODE" != "200" ] && [ "$CODE" != "401" ]; then
  echo "FAIL: web 未启动（http=$CODE）"; tail -40 "$V/web.log"; exit 1
fi

DIAG=$(curl -s --max-time 8 "http://127.0.0.1:$PORT/dsh-weekly-retro/diagnostics")
echo "diagnostics: $DIAG"
node -e '
const d=JSON.parse(process.argv[1]||"{}");
const bad=[];
if(d.ok!==true) bad.push("ok!=true");
if(d.skill!==true) bad.push("skill 未注册："+(d.skillError||"?"));
if(d.skillName!=="weekly-retro") bad.push("skillName="+d.skillName);
if(!(d.skillBytes>1000)) bad.push("skillBytes="+d.skillBytes);
if(d.toolCount!==5) bad.push("toolCount="+d.toolCount);
if(d.routes!==13) bad.push("routes="+d.routes);
if(bad.length){console.error("FAIL: "+bad.join(" | "));process.exit(1)}
console.log("PASS: skill="+d.skillName+" · bytes="+d.skillBytes+" · tools="+d.toolCount+" · routes="+d.routes);
' "$DIAG"

if grep -E "dsh-weekly-retro.*(skill.*(失败|failed|error)|技能注册失败)" "$V/web.log" >/dev/null 2>&1; then
  echo "FAIL: 启动日志有技能注册错误"; grep -E 'dsh-weekly-retro' "$V/web.log" | tail -20; exit 1
fi
echo "canary log: 无技能注册错误"
