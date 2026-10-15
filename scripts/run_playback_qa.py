"""Local HLS fixture for manual browser QA; never represents a public camera.

Requires ffmpeg on PATH or the optional development package imageio-ffmpeg.
Run with the frontend dev server, then open /playback-qa.html.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import subprocess


def main():
    root = Path(__file__).resolve().parents[1] / "output" / "playback-qa"
    root.mkdir(parents=True, exist_ok=True)
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    subprocess.run([
        ffmpeg, "-y", "-loglevel", "error", "-f", "lavfi", "-i",
        "testsrc2=size=320x180:rate=10", "-t", "180", "-c:v", "libx264",
        "-preset", "ultrafast", "-g", "20", "-sc_threshold", "0", "-an",
        "-f", "hls", "-hls_time", "2", "-hls_list_size", "0",
        "-hls_playlist_type", "vod", str(root / "playlist.m3u8"),
    ], check=True)
    state = {"cut": False}

    class Handler(BaseHTTPRequestHandler):
        def send_headers(self, code, content_type="text/plain"):
            self.send_response(code)
            self.send_header("Access-Control-Allow-Origin", "http://127.0.0.1:3001")
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()

        def do_POST(self):
            if self.path not in ("/cut", "/resume"):
                self.send_headers(404)
                return
            state["cut"] = self.path == "/cut"
            self.send_headers(200)
            self.wfile.write(b"cut" if state["cut"] else b"available")

        def do_GET(self):
            if self.path == "/health":
                self.send_headers(200)
                self.wfile.write(b"cut" if state["cut"] else b"available")
                return
            filename = self.path.removeprefix("/")
            if "/" in filename or "\\" in filename or not filename.endswith((".m3u8", ".ts")):
                self.send_headers(404)
                return
            path = root / filename
            if not path.is_file():
                self.send_headers(404)
                return
            if state["cut"]:
                self.send_headers(503)
                return
            content_type = "application/vnd.apple.mpegurl" if path.suffix == ".m3u8" else "video/mp2t"
            self.send_headers(200, content_type)
            try:
                self.wfile.write(path.read_bytes())
            except (BrokenPipeError, ConnectionResetError):
                pass

        def log_message(self, *_args):
            pass

    print("Local synthetic HLS fixture: http://127.0.0.1:8003; UI /playback-qa.html", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 8003), Handler).serve_forever()


if __name__ == "__main__":
    main()
