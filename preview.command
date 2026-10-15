#!/bin/bash
# Double-click in Finder to build, serve, and open the local homepage preview.
set -u

SERVER_PID=""
PROJECT_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)" || exit 1
cd -- "$PROJECT_DIR" || exit 1
PORT="${PREVIEW_PORT:-4000}"
URL="http://127.0.0.1:${PORT}"

finish() {
    exit_status=$?
    trap - EXIT INT TERM HUP
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    if [ "$exit_status" -ne 0 ] && [ -t 0 ]; then
        printf '\n按回车关闭此窗口……'
        read -r answer || true
    fi
    exit "$exit_status"
}
trap finish EXIT
trap 'exit 0' INT TERM HUP

fail() {
    printf '\n无法启动预览：%s\n' "$1" >&2
    exit 1
}

PYTHON=""
for candidate in "$PROJECT_DIR/.venv/bin/python3" /opt/homebrew/bin/python3 /usr/local/bin/python3 python3 /Library/Frameworks/Python.framework/Versions/Current/bin/python3; do
    if "$candidate" -c 'import sys; raise SystemExit(sys.version_info < (3, 10))' >/dev/null 2>&1; then
        PYTHON="$candidate"
        break
    fi
done
[ -n "$PYTHON" ] || fail "需要 Python 3.10 或更新版本。安装后重新双击 preview.command。"
"$PYTHON" -c 'import sys; port = int(sys.argv[1]); raise SystemExit(not 1 <= port <= 65535)' "$PORT" >/dev/null 2>&1 || fail "端口必须是 1–65535 之间的整数。"

# Verify both the preview service and this checkout, without exposing its path.
preview_status() {
    "$PYTHON" - "$PORT" <<'PY'
import hashlib
from http.client import HTTPException
import json
from pathlib import Path
import socket
import sys
import urllib.request

port = int(sys.argv[1])
try:
    with socket.create_connection(("127.0.0.1", port), timeout=0.4):
        pass
except ConnectionRefusedError:
    print("free")
    raise SystemExit
except OSError:
    print("occupied")
    raise SystemExit
try:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(f"http://127.0.0.1:{port}/__livereload", timeout=0.8) as response:
        payload = json.load(response)
    expected_root = hashlib.sha256(str(Path.cwd().resolve()).encode("utf-8")).hexdigest()
    ready = (
        payload.get("project") == "NorthXyRan.github.io"
        and payload.get("root_id") == expected_root
        and isinstance(payload.get("version"), int)
    )
except (OSError, ValueError, AttributeError, HTTPException):
    ready = False
print("ready" if ready else "occupied")
PY
}

open_preview() {
    printf '\n预览地址：%s\n' "$URL"
    if [ "${PREVIEW_NO_OPEN:-0}" != "1" ]; then
        open "$URL" || printf '浏览器未能自动打开，请手动访问上面的地址。\n' >&2
    fi
}

check_existing() {
    current_status="$(preview_status)" || fail "无法检查本地预览状态。"
    case "$current_status" in
        ready)
            printf '本项目的预览已在运行，直接打开。\n'
            open_preview
            exit 0
            ;;
        free) ;;
        *) fail "端口 ${PORT} 已被其他程序或旧版预览占用。请关闭占用该端口的程序后重试；本脚本不会停止已有进程。" ;;
    esac
}
check_existing

if [ ! -e .venv ]; then
    printf '首次运行：创建本地 Python 环境……\n'
    "$PYTHON" -m venv .venv || fail "创建 .venv 失败，请检查 Python 的 venv 组件是否可用。"
fi
VENV_PYTHON="$PROJECT_DIR/.venv/bin/python3"
"$VENV_PYTHON" -c 'import sys; raise SystemExit(sys.version_info < (3, 10))' >/dev/null 2>&1 || fail "现有 .venv 不可用或 Python 版本低于 3.10。请将 .venv 移走后重新运行。"

dependencies_ready() {
    "$VENV_PYTHON" - <<'PY'
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

try:
    for line in Path("requirements.txt").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        package, separator, pinned = line.partition("==")
        if not separator or version(package.strip()) != pinned.strip():
            raise SystemExit(1)
    import yaml
    from markdown_it import MarkdownIt
except (OSError, PackageNotFoundError, ImportError):
    raise SystemExit(1)
PY
}

if ! dependencies_ready >/dev/null 2>&1; then
    printf '安装或更新 Markdown 构建依赖（首次运行需要联网）……\n'
    "$VENV_PYTHON" -m pip install -r requirements.txt || fail "依赖安装失败。请检查网络后重新运行。"
    dependencies_ready || fail "依赖未安装完整，请查看上方错误后重新运行。"
fi

# A second launch may have started a server while dependencies were installing.
check_existing
printf '正在构建并启动预览；保持此窗口打开，编辑 contents 后页面会自动刷新。\n'
printf '按 Control+C 停止此次预览。\n'
"$VENV_PYTHON" scripts/dev_server.py --host 127.0.0.1 --port "$PORT" &
SERVER_PID=$!
deadline=$((SECONDS + 30))
ready=0
while [ "$SECONDS" -lt "$deadline" ]; do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        wait "$SERVER_PID" 2>/dev/null || true
        SERVER_PID=""
        fail "构建或启动失败，请查看上方错误并修改后重新运行。"
    fi
    if [ "$(preview_status)" = "ready" ]; then
        ready=1
        break
    fi
    sleep 0.2
done
[ "$ready" = "1" ] || fail "等待本地服务器超过 30 秒，请查看上方输出。"
open_preview
if ! wait "$SERVER_PID"; then
    SERVER_PID=""
    fail "预览服务器已退出，请查看上方错误。"
fi
SERVER_PID=""
