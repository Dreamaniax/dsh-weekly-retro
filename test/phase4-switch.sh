#!/usr/bin/env bash
# Phase 4 预演：把本地 0.5.0-rc 包装进隔离 profile，验证 runtime skill 与 5 个工具。
# 真实技能只做备份，不移动；"moved" 模式只在隔离 DSH_HOME 内把技能副本移走。
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
CLI="${DSH_CLI:-/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh}"
SRC="${DSH_SOURCE_PROFILE:-$HOME/.dsh/profiles/desktop}"
V="$(mktemp -d /tmp/dsh-weekly-phase4.XXXXXX)"
BACKUP="${DSH_WEEKLY_PHASE4_BACKUP:-$HOME/dsh-config-backups/weekly-retro-phase4-$(date +%Y%m%d-%H%M%S)}"
LOCAL_SKILL="$HOME/.dsh/skills/weekly-retro"
CONFIG_SKILL="$HOME/dsh-config/skills/weekly-retro"
PORT="${DSH_PHASE4_PORT:-62341}"
PID=""
cleanup() { [ -n "${PID:-}" ] && kill "$PID" 2>/dev/null || true; rm -rf "$V"; }
trap cleanup EXIT

[ -x "$CLI" ] || { echo "FAIL: 找不到 dsh CLI：$CLI"; exit 1; }
[ -d "$SRC" ] || { echo "FAIL: 找不到源 profile：$SRC"; exit 1; }
[ -f "$LOCAL_SKILL/SKILL.md" ] || { echo "FAIL: 缺少本地技能：$LOCAL_SKILL"; exit 1; }
[ -f "$CONFIG_SKILL/SKILL.md" ] || { echo "FAIL: 缺少仓库技能：$CONFIG_SKILL"; exit 1; }

# 1) 本地 rc 包：必须从当前工作区打包，不能从 profile 的旧包取。
TARBALL="$(cd "$HERE" && npm pack --silent --pack-destination "$V" | tail -1)"
mkdir -p "$V/package"
tar -xzf "$V/$TARBALL" -C "$V/package"
[ -f "$V/package/package/skills/weekly-retro/SKILL.md" ] || { echo "FAIL: rc 包缺技能"; exit 1; }
PKG_VERSION="$(node -p 'require(process.argv[1]).version' "$V/package/package/package.json")"
echo "rc package: $PKG_VERSION ($TARBALL)"

# 2) 真实技能只备份，不移动；备份放仓库外，权限收紧。
mkdir -p "$BACKUP/local-skill" "$BACKUP/config-skill"
cp -R "$LOCAL_SKILL/." "$BACKUP/local-skill/"
cp -R "$CONFIG_SKILL/." "$BACKUP/config-skill/"
chmod -R go-rwx "$BACKUP"
{
  echo "phase4 backup $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "local:  $(shasum -a 256 "$LOCAL_SKILL/SKILL.md" | awk '{print $1}')"
  echo "config: $(shasum -a 256 "$CONFIG_SKILL/SKILL.md" | awk '{print $1}')"
  echo "note: real skills were NOT moved; only isolated test copies were moved."
} > "$BACKUP/MANIFEST.txt"
chmod 600 "$BACKUP/MANIFEST.txt"
echo "backup: $BACKUP"

# 3) 隔离 profile：宿主依赖用 symlink，插件用 rc 包。
mkdir -p "$V/profiles/web/node_modules"
cp "$SRC/package.json" "$SRC/cordis.yml" "$SRC/cordis.patch.yml" "$V/profiles/web/" 2>/dev/null || true
for p in "$SRC"/node_modules/* "$SRC"/node_modules/.[!.]*; do
  [ -e "$p" ] || continue
  b="$(basename "$p")"
  [ "$b" = "dsh-weekly-retro" ] && continue
  ln -s "$p" "$V/profiles/web/node_modules/$b"
done
cp -R "$V/package/package" "$V/profiles/web/node_modules/dsh-weekly-retro"
printf '%s\n' '- insert:' '    - id: dsh-weekly-retro' '      name: dsh-weekly-retro' > "$V/plugin.patch.yml"

start_case() {
  local mode="$1" port="$2" copy="${3:-0}"
  rm -rf "$V/skills"
  mkdir -p "$V/skills"
  if [ "$copy" = "1" ]; then
    cp -R "$LOCAL_SKILL" "$V/skills/weekly-retro"
  fi
  if [ "$mode" = "moved" ]; then
    mv "$V/skills/weekly-retro" "$V/removed-skill"
  fi
  DSH_HOME="$V" nohup "$CLI" --profile web --patch "$V/plugin.patch.yml" --no-open --port "$port" > "$V/$mode.log" 2>&1 &
  PID=$!
  local code=000
  for _ in $(seq 1 60); do
    sleep 1
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$port/" 2>/dev/null || echo 000)"
    { [ "$code" = "200" ] || [ "$code" = "401" ]; } && break
  done
  if [ "$code" != "200" ] && [ "$code" != "401" ]; then
    echo "FAIL[$mode]: web 未启动（http=$code）"; tail -30 "$V/$mode.log"; exit 1
  fi
  local diag
  diag="$(curl -s --max-time 8 "http://127.0.0.1:$port/dsh-weekly-retro/diagnostics")"
  echo "[$mode] diagnostics: $diag"
  node -e '
    const d=JSON.parse(process.argv[1]||"{}");
    const bad=[];
    if(d.ok!==true) bad.push("ok!=true");
    if(d.skill!==true) bad.push("skill 未注册："+(d.skillError||"?"));
    if(d.skillName!=="weekly-retro") bad.push("skillName="+d.skillName);
    if(!(d.skillBytes>1000)) bad.push("skillBytes="+d.skillBytes);
    if(d.toolCount!==5) bad.push("toolCount="+d.toolCount);
    if(d.routes!==13) bad.push("routes="+d.routes);
    if(bad.length){ console.error("FAIL["+process.argv[2]+"]: "+bad.join(" | ")); process.exit(1); }
    console.log("PASS["+process.argv[2]+"]: skill="+d.skillName+" · bytes="+d.skillBytes+" · tools="+d.toolCount+" · routes="+d.routes);
  ' "$diag" "$mode"
  kill "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
  PID=""
}

start_case no-user 62341 0
start_case with-user 62342 1
start_case moved 62343 1
echo "PHASE4 PREFLIGHT PASS: rc=$PKG_VERSION; runtime skill verified; real skills untouched."
