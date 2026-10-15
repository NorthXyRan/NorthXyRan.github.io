#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import io
import json
import os
import posixpath
import sys
import threading
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


RELOAD_SNIPPET = """
<script>
(() => {
  let lastVersion = null;
  async function poll() {
    try {
      const response = await fetch('/__livereload', { cache: 'no-store' });
      const payload = await response.json();
      if (lastVersion === null) {
        lastVersion = payload.version;
      } else if (payload.version !== lastVersion) {
        location.reload();
        return;
      }
    } catch (_) {
      // Server is restarting or temporarily unavailable.
    }
    setTimeout(poll, 1000);
  }
  poll();
})();
</script>
"""


def build_content(root: Path) -> None:
    """Load the builder again so edits to build.py also take effect live."""
    path = root / "scripts" / "build.py"
    spec = importlib.util.spec_from_file_location("_site_content_builder", path)
    if spec is None:
        raise RuntimeError(f"Cannot load the content builder: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    # Compile the source directly to avoid a stale bytecode cache when a script
    # is saved more than once within the same second.
    exec(compile(path.read_bytes(), str(path), "exec"), module.__dict__)
    module.build_site(root)


def report_build_error(error: Exception) -> None:
    print(f"[build] Failed: {error}", file=sys.stderr, flush=True)
    if isinstance(error, ModuleNotFoundError):
        print(
            "Install the build dependencies with: "
            "python3 -m pip install -r requirements.txt",
            file=sys.stderr,
            flush=True,
        )


class FileWatcher:
    def __init__(self, root: Path) -> None:
        self.root = root
        self._version = 0
        self._snapshot = self._take_snapshot()
        self._source_snapshot = self._sources(self._snapshot)
        self._build_failed = False
        self._lock = threading.Lock()

    @property
    def version(self) -> int:
        with self._lock:
            return self._version

    def build_initial(self) -> None:
        """Build from a stable source snapshot before accepting requests."""
        while True:
            sources = self._sources(self._take_snapshot())
            build_content(self.root)
            current = self._take_snapshot()
            if self._sources(current) == sources:
                self._source_snapshot = sources
                self._snapshot = current
                return

    def poll(self) -> None:
        current = self._take_snapshot()
        sources = self._sources(current)
        if sources != self._source_snapshot:
            # Remember the attempted sources, including on failure, so an
            # invalid edit reports once and is retried after the next edit.
            self._source_snapshot = sources
            try:
                build_content(self.root)
            except Exception as error:
                self._build_failed = True
                self._snapshot = self._take_snapshot()
                report_build_error(error)
                print(
                    "[build] Fix the content and save again. The browser will "
                    "reload after a successful build.",
                    file=sys.stderr,
                    flush=True,
                )
                return
            # Absorb generated output changes into this reload rather than
            # treating them as another edit on the next poll.
            self._snapshot = self._take_snapshot()
            if self._sources(self._snapshot) != sources:
                # A save during the build needs another build. Keep the source
                # baseline from before this attempt and do not reload its stale
                # output while the next edit is still pending.
                return
            self._build_failed = False
            with self._lock:
                self._version += 1
            print("[build] Content rebuilt; reloading browser.", flush=True)
            return

        if self._build_failed:
            # CSS or other file changes must not reload stale generated content
            # while Markdown is invalid.
            self._snapshot = current
            return
        with self._lock:
            if current != self._snapshot:
                self._snapshot = current
                self._version += 1

    @staticmethod
    def _sources(snapshot: dict[str, tuple[int, int]]) -> dict[str, tuple[int, int]]:
        return {
            name: stamp
            for name, stamp in snapshot.items()
            if name == "scripts/build.py"
            or name.startswith(("contents/", "templates/"))
        }

    def _take_snapshot(self) -> dict[str, tuple[int, int]]:
        snapshot: dict[str, tuple[int, int]] = {}
        for directory, subdirectories, filenames in os.walk(self.root):
            subdirectories[:] = [
                name
                for name in subdirectories
                if not name.startswith(".") and name != "__pycache__"
            ]
            for name in filenames:
                if name.startswith(".") or name.endswith((".pyc", ".pyo")):
                    continue
                path = Path(directory) / name
                try:
                    stat = path.stat()
                except FileNotFoundError:
                    # Editors can replace or remove a file during a scan.
                    continue
                snapshot[path.relative_to(self.root).as_posix()] = (
                    stat.st_mtime_ns,
                    stat.st_size,
                )
        return snapshot


class LiveReloadHandler(SimpleHTTPRequestHandler):
    watcher: FileWatcher
    root_dir: Path

    def translate_path(self, path: str) -> str:
        parsed = urlparse(path)
        clean_path = parsed.path
        clean_path = posixpath.normpath(unquote(clean_path))
        segments = [segment for segment in clean_path.split("/") if segment]
        resolved = self.root_dir
        for segment in segments:
            resolved /= segment
        return str(resolved.resolve())

    def _is_public_path(self, path: Path) -> bool:
        try:
            relative = path.relative_to(self.root_dir.resolve())
        except ValueError:
            return False
        if any(part.startswith(".") for part in relative.parts):
            return False
        if relative.parts and relative.parts[0].casefold() in {"contents", "templates", "scripts"}:
            return False
        return path.suffix.lower() not in {
            ".md", ".py", ".pyc", ".command", ".yml", ".yaml",
        } and path.name.lower() != "requirements.txt"

    def send_head(self):  # type: ignore[override]
        if urlparse(self.path).path == "/__livereload":
            return self._send_reload_payload()
        path = Path(self.translate_path(self.path))
        if not self._is_public_path(path):
            self.send_error(HTTPStatus.NOT_FOUND)
            return None
        if path.is_dir():
            for index in ("index.html", "index.htm"):
                index_path = (path / index).resolve()
                if index_path.exists():
                    if not self._is_public_path(index_path):
                        self.send_error(HTTPStatus.NOT_FOUND)
                        return None
                    path = index_path
                    break
        if path.is_file() and path.suffix.lower() in {".html", ".htm"}:
            return self._send_html(path)
        # Assets must also bypass old Last-Modified caches during live edits.
        if "If-Modified-Since" in self.headers:
            del self.headers["If-Modified-Since"]
        return super().send_head()

    def list_directory(self, path: str):
        self.send_error(HTTPStatus.NOT_FOUND)
        return None

    def _send_html(self, path: Path):
        try:
            content = path.read_text(encoding="utf-8")
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return None
        if "</body>" in content:
            content = content.replace("</body>", f"{RELOAD_SNIPPET}</body>", 1)
        else:
            content += RELOAD_SNIPPET
        return self._send_bytes(content.encode("utf-8"), "text/html; charset=utf-8")

    def _send_bytes(self, body: bytes, content_type: str):
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        return io.BytesIO(body)

    def _send_reload_payload(self):
        payload = json.dumps({
            "version": self.watcher.version,
            "project": "NorthXyRan.github.io",
            "root_id": hashlib.sha256(str(self.root_dir.resolve()).encode("utf-8")).hexdigest(),
        }).encode("utf-8")
        return self._send_bytes(payload, "application/json; charset=utf-8")

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_request(self, code="-", size="-") -> None:
        if urlparse(self.path).path != "/__livereload" or code != HTTPStatus.OK:
            super().log_request(code, size)

def start_watcher(watcher: FileWatcher) -> None:
    while True:
        watcher.poll()
        time.sleep(0.5)


def main() -> None:
    parser = argparse.ArgumentParser(description="Static dev server with live reload")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4000)
    parser.add_argument("--root", default=".")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    os.chdir(root)
    watcher = FileWatcher(root)
    try:
        watcher.build_initial()
    except Exception as error:
        report_build_error(error)
        print("[build] Server was not started.", file=sys.stderr, flush=True)
        raise SystemExit(1) from None

    LiveReloadHandler.watcher = watcher
    LiveReloadHandler.root_dir = root

    try:
        server = ThreadingHTTPServer((args.host, args.port), LiveReloadHandler)
    except OSError as error:
        print(f"[server] Cannot listen on {args.host}:{args.port}: {error}", file=sys.stderr)
        raise SystemExit(1) from None
    thread = threading.Thread(target=start_watcher, args=(watcher,), daemon=True)
    thread.start()
    print(f"Serving {root} at http://{args.host}:{server.server_port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
