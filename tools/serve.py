"""本地预览服务器（禁用缓存）。用法：python web/tools/serve.py [端口=8765]"""
import http.server, os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')


class NoCache(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *a):
        pass


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
print(f'誓约竞技场：http://localhost:{port}')
http.server.ThreadingHTTPServer(('', port), NoCache).serve_forever()
