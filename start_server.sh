#!/bin/bash
# HSK Flashcards Local Server Launcher
PORT=3333
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")

echo "================================================="
echo "  HSK Chinese Flashcards App"
echo "================================================="
echo ""
echo "Open on your Mac:"
echo "  http://localhost:${PORT}"
echo ""
echo "Open on your iPhone (same Wi-Fi):"
echo "  http://${IP}:${PORT}"
echo ""
echo "To install on iPhone:"
echo "  1. Open http://${IP}:${PORT} in Safari"
echo "  2. Tap the Share button (square with arrow)"
echo "  3. Tap 'Add to Home Screen'"
echo "  4. App will run full-screen and works 100% offline!"
echo "================================================="
echo ""
/usr/bin/python3 -c "
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class PWARequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def send_head(self):
        if 'If-Modified-Since' in self.headers:
            del self.headers['If-Modified-Since']
        if 'If-None-Match' in self.headers:
            del self.headers['If-None-Match']
        return super().send_head()

server = ThreadingHTTPServer(('0.0.0.0', ${PORT}), PWARequestHandler)
print('Serving HTTP on 0.0.0.0 port ${PORT} (http://0.0.0.0:${PORT}/) ...')
server.serve_forever()
"
