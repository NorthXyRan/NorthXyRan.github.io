#!/usr/bin/env python3
"""Regression checks for the local preview; no browser or network install runs."""
from __future__ import annotations

from contextlib import closing, redirect_stderr, redirect_stdout
import hashlib
import http.client
from http.server import ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import shlex
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

import dev_server


ROOT = Path(__file__).resolve().parents[1]


class WatcherTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / "contents").mkdir()
        self.source = self.root / "contents" / "news.md"
        self.source.write_text("before", encoding="utf-8")
        self.output = self.root / "index.html"
        self.watcher = dev_server.FileWatcher(self.root)
        stdout = redirect_stdout(io.StringIO())
        stderr = redirect_stderr(io.StringIO())
        stdout.__enter__()
        stderr.__enter__()
        self.addCleanup(stdout.__exit__, None, None, None)
        self.addCleanup(stderr.__exit__, None, None, None)

    def build(self, root):
        text = self.source.read_text(encoding="utf-8")
        if text == "invalid":
            raise ValueError("news.md: invalid source")
        self.output.write_text(text, encoding="utf-8")

    def test_initial_build_retries_an_edit_during_build(self):
        calls = []

        def changing_build(root):
            self.build(root)
            calls.append(True)
            if len(calls) == 1:
                self.source.write_text("latest", encoding="utf-8")

        with patch.object(dev_server, "build_content", changing_build):
            self.watcher.build_initial()
            self.watcher.poll()
        self.assertEqual(len(calls), 2)
        self.assertEqual(self.output.read_text(), "latest")
        self.assertEqual(self.watcher.version, 0)

    def test_edit_during_rebuild_waits_for_current_sources(self):
        with patch.object(dev_server, "build_content", self.build):
            self.watcher.build_initial()
        self.source.write_text("first edit", encoding="utf-8")

        def changing_build(root):
            self.build(root)
            self.source.write_text("second edit", encoding="utf-8")

        with patch.object(dev_server, "build_content", changing_build):
            self.watcher.poll()
        self.assertEqual(self.watcher.version, 0)
        with patch.object(dev_server, "build_content", self.build):
            self.watcher.poll()
            self.watcher.poll()
        self.assertEqual(self.output.read_text(), "second edit")
        self.assertEqual(self.watcher.version, 1)

    def test_correction_during_failed_build_is_retried(self):
        with patch.object(dev_server, "build_content", self.build):
            self.watcher.build_initial()
        self.source.write_text("invalid", encoding="utf-8")

        def corrected_during_failure(root):
            self.source.write_text("corrected", encoding="utf-8")
            raise ValueError("news.md: invalid source")

        with patch.object(dev_server, "build_content", corrected_during_failure):
            self.watcher.poll()
        self.assertEqual(self.watcher.version, 0)
        with patch.object(dev_server, "build_content", self.build):
            self.watcher.poll()
        self.assertEqual(self.output.read_text(), "corrected")
        self.assertEqual(self.watcher.version, 1)

    def test_invalid_source_suppresses_reload_and_recovers_without_loop(self):
        with patch.object(dev_server, "build_content", self.build):
            self.watcher.build_initial()
            self.source.write_text("invalid", encoding="utf-8")
            self.watcher.poll()
            (self.root / "asset.css").write_text("updated asset", encoding="utf-8")
            self.watcher.poll()
            self.assertEqual(self.watcher.version, 0)
            self.assertEqual(self.output.read_text(), "before")
            self.source.write_text("fixed", encoding="utf-8")
            self.watcher.poll()
            self.watcher.poll()
            self.assertEqual(self.watcher.version, 1)
            (self.root / "asset.css").write_text("another update", encoding="utf-8")
            self.watcher.poll()
            self.assertEqual(self.watcher.version, 2)


class HTTPFixture(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="preview test with spaces ")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.html = "<!doctype html><body><p>Preview fixture</p></body>"
        (self.root / "index.html").write_text(self.html, encoding="utf-8")
        for name in (".git/config", ".venv/pyvenv.cfg", "contents/news.md", "templates/index.html", "scripts/build.py", "README.md", "requirements.txt", "preview.command"):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("private source fixture", encoding="utf-8")
        (self.root / "assets").mkdir()
        (self.root / "assets/site.css").write_text("old", encoding="utf-8")
        (self.root / "data").mkdir()
        (self.root / "data/news.json").write_text("[]", encoding="utf-8")

        class Handler(dev_server.LiveReloadHandler):
            def log_message(self, *args):
                pass

        Handler.root_dir = self.root
        Handler.watcher = dev_server.FileWatcher(self.root)
        self.errors = []

        class Server(ThreadingHTTPServer):
            def handle_error(server, request, client_address):
                self.errors.append(sys.exc_info()[1])

        self.server = Server(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(self, path, *, method="GET", headers=None):
        with closing(http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)) as connection:
            connection.request(method, path, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()


class HTTPTests(HTTPFixture):
    def test_head_and_get_use_the_same_html_headers_without_socket_errors(self):
        status, headers, body = self.request("/", method="HEAD")
        self.assertEqual((status, body), (200, b""))
        status, get_headers, body = self.request("/")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Length"], str(len(body)))
        self.assertEqual(headers["Content-Length"], get_headers["Content-Length"])
        self.assertIn(dev_server.RELOAD_SNIPPET.encode(), body)
        self.assertEqual(self.errors, [])

    def test_live_reload_supports_head_and_does_not_expose_root_path(self):
        status, headers, body = self.request("/__livereload")
        payload = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(payload["root_id"], hashlib.sha256(str(self.root.resolve()).encode()).hexdigest())
        self.assertNotIn(str(self.root), body.decode())
        status, head_headers, body = self.request("/__livereload", method="HEAD")
        self.assertEqual((status, body), (200, b""))
        self.assertEqual(headers["Content-Length"], head_headers["Content-Length"])

    def test_sources_hidden_files_and_directory_listings_are_not_served(self):
        for path in ("/.git/config", "/%2egit/config", "/.venv/pyvenv.cfg", "/contents/news.md", "/templates/index.html", "/scripts/build.py", "/README.md", "/requirements.txt", "/preview.command", "/data/"):
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 404)
        self.assertEqual(self.request("/data/news.json")[0], 200)

    def test_symlinks_cannot_expose_sources_or_files_outside_the_root(self):
        with tempfile.TemporaryDirectory() as outside:
            secret = Path(outside) / "secret.html"
            secret.write_text("outside fixture", encoding="utf-8")
            (self.root / "outside.html").symlink_to(secret)
            (self.root / "source.html").symlink_to(self.root / "templates/index.html")
            nested = self.root / "assets/nested"
            nested.mkdir()
            (nested / "index.html").symlink_to(secret)
            for path in ("/outside.html", "/source.html", "/assets/nested/"):
                with self.subTest(path=path):
                    self.assertEqual(self.request(path)[0], 404)

    def test_assets_bypass_conditional_caches_and_cross_origin_access(self):
        _, headers, _ = self.request("/assets/site.css")
        (self.root / "assets/site.css").write_text("new", encoding="utf-8")
        status, headers, body = self.request("/assets/site.css", headers={"If-Modified-Since": headers["Last-Modified"]})
        self.assertEqual((status, body), (200, b"new"))
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertNotIn("Access-Control-Allow-Origin", headers)


class LauncherTests(HTTPFixture):
    def prepare_launcher(self, directory):
        shutil.copy2(ROOT / "preview.command", directory / "preview.command")
        python = directory / ".venv/bin/python3"
        python.parent.mkdir(parents=True, exist_ok=True)
        python.write_text("#!/bin/sh\nexec " + shlex.quote(sys.executable) + ' "$@"\n', encoding="utf-8")
        python.chmod(0o755)
        fakebin = directory / "fakebin"
        fakebin.mkdir()
        opener = fakebin / "open"
        opener.write_text('#!/bin/sh\nprintf "%s\\n" "$1" >> "$OPEN_LOG"\n', encoding="utf-8")
        opener.chmod(0o755)
        return dict(os.environ, PATH=f"{fakebin}:{os.environ['PATH']}", OPEN_LOG=str(directory / "opened.log"), PREVIEW_PORT=str(self.server.server_port), PIP_NO_INDEX="1")

    def run_launcher(self, directory, env):
        return subprocess.run(["/bin/bash", str(directory / "preview.command")], cwd="/tmp", env=env, capture_output=True, text=True, timeout=5)

    def test_existing_preview_is_reused_and_browser_opens_once(self):
        env = self.prepare_launcher(self.root)
        result = self.run_launcher(self.root, env)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("预览已在运行", result.stdout)
        self.assertEqual((self.root / "opened.log").read_text().splitlines(), [f"http://127.0.0.1:{self.server.server_port}"])
        self.assertEqual(self.request("/")[0], 200)

    def test_other_checkout_is_not_reused_or_stopped(self):
        with tempfile.TemporaryDirectory() as other:
            directory = Path(other)
            env = self.prepare_launcher(directory)
            result = self.run_launcher(directory, env)
            self.assertEqual(result.returncode, 1)
            self.assertIn("端口", result.stderr)
            self.assertFalse((directory / "opened.log").exists())
            self.assertEqual(self.request("/")[0], 200)

    def test_non_http_port_occupant_is_reported_without_traceback(self):
        class Occupant(socketserver.StreamRequestHandler):
            def handle(self):
                if self.rfile.readline():
                    self.wfile.write(b"not an HTTP response\r\n")

        with socketserver.TCPServer(("127.0.0.1", 0), Occupant) as occupant:
            thread = threading.Thread(target=occupant.serve_forever, daemon=True)
            thread.start()
            try:
                env = self.prepare_launcher(self.root)
                env["PREVIEW_PORT"] = str(occupant.server_address[1])
                result = self.run_launcher(self.root, env)
                self.assertEqual(result.returncode, 1)
                self.assertIn("端口", result.stderr)
                self.assertNotIn("Traceback", result.stderr)
                self.assertFalse((self.root / "opened.log").exists())
            finally:
                occupant.shutdown()
                thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
