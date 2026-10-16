"""Local read-only dashboard; serves an exact asset allowlist."""
import argparse
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from campus import Client, Store, demo_snapshot
from journal import Journal

ROOT = Path(__file__).resolve().parent
ASSETS = {'/': ('dashboard/index.html', 'text/html; charset=utf-8'),
          '/favicon.svg': ('dashboard/favicon.svg', 'image/svg+xml'),
          '/app.js': ('dashboard/app.js', 'text/javascript; charset=utf-8'),
          '/model.js': ('dashboard/model.js', 'text/javascript; charset=utf-8'),
          '/style.css': ('dashboard/style.css', 'text/css; charset=utf-8')}


def dashboard_snapshot(payload):
    metrics = {key: {**m, 'available': m.get('value') is not None,
                    'updatedAt': m.get('providerAt'), 'sourceState': m.get('state'), 'estimate': False}
               for key, m in payload['metrics'].items()}
    return {'connected': any(m.get('state') == 'queried' for m in payload['metrics'].values()),
            'metrics': metrics, 'sources': {'power':'school','card':'school'}, 'checkedAt': None,
            'transport':'school'}


def handler(store=None, demo=False, journal=None):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            path = urlsplit(self.path).path
            # Block browser requests from other origins, including DNS rebinding.
            if self.headers.get('Host') not in self.server.allowed_hosts:
                self.send_error(403)
                return
            if self.headers.get('Sec-Fetch-Site') == 'cross-site':
                self.send_error(403)
                return
            if demo and path == '/' and not urlsplit(self.path).query:
                self.send_response(302)
                self.send_header('Location','/?mode=demo')
                self.end_headers()
                return
            if path in ('/api/snapshot', '/api/current'):
                payload = demo_snapshot() if demo else store.snapshot()
                if journal and not demo:
                    journal.record(payload)
                if path == '/api/current':
                    payload = dashboard_snapshot(payload)
                body, mime = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode(), 'application/json; charset=utf-8'
            elif path == '/api/history':
                body = json.dumps({'records':journal.read() if journal and not demo else []}, ensure_ascii=False).encode()
                mime = 'application/json; charset=utf-8'
            elif path in ASSETS:
                file, mime = ASSETS[path]
                body = (ROOT / file).read_bytes()
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('X-Frame-Options', 'DENY')
            self.send_header('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            # Manual record uses the cached snapshot; cannot force repeated school requests.
            if urlsplit(self.path).path != '/api/record':
                self.send_error(405)
                return
            if self.headers.get('Host') not in self.server.allowed_hosts or self.headers.get('Sec-Fetch-Site') == 'cross-site':
                self.send_error(403)
                return
            origin = self.headers.get('Origin')
            if origin and origin != f'http://{self.headers.get("Host")}':
                self.send_error(403)
                return
            if demo or not journal:
                self.send_error(405)
                return
            snapshot = store.snapshot()
            added = journal.record(snapshot)
            body = json.dumps({'added':added, 'snapshot':dashboard_snapshot(snapshot), 'records':journal.read()}, ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header('Content-Type','application/json; charset=utf-8')
            self.send_header('Content-Length',str(len(body)))
            self.send_header('Cache-Control','no-store')
            self.end_headers()
            self.wfile.write(body)
    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=Path, default=ROOT / 'config.local.json')
    parser.add_argument('--demo', action='store_true')
    parser.add_argument('--port', type=int, default=4186)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('端口范围为 1–65535')
    store = None
    if not args.demo:
        try:
            cfg = json.loads(args.config.read_text())
            if not isinstance(cfg, dict):
                raise ValueError()
        except (OSError, ValueError):
            parser.error('请先创建有效的 config.local.json，或用 --demo 预览')
        store = Store(Client(cfg))
    journal = None if args.demo else Journal(ROOT / 'private/campus.sqlite3')
    server = ThreadingHTTPServer(('127.0.0.1', args.port), handler(store, args.demo, journal))
    server.allowed_hosts = {f'127.0.0.1:{args.port}', f'localhost:{args.port}'}
    stop = threading.Event()
    def collect():
        while not stop.is_set():
            try:
                journal.record(store.snapshot())
            except Exception:
                pass
            stop.wait(1200)
    if not args.demo:
        threading.Thread(target=collect, daemon=True).start()
    print(f'校园余额：http://127.0.0.1:{args.port} （' + ('演示数据' if args.demo else '个人本机查询') + '）', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        server.server_close()


if __name__ == '__main__':
    main()
