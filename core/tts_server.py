"""
内置 MeloTTS 本地服务：HTTP 127.0.0.1:8766
  GET  /health  → { ok, ready }
  POST /tts     → JSON { text, speed? } → { ok, dataUrl, bytes }  (wav base64)
  POST /tts/raw → 同上，直接返回 audio/wav 二进制
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import logging
import os
import sys
import tempfile
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

# Windows 控制台 UTF-8
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

_ROOT = Path(__file__).resolve().parents[1]

# 优先用项目内 NLTK 数据，避免缺 averaged_perceptron_tagger_eng
_NLTK_DIR = _ROOT / "models" / "nltk_data"
if _NLTK_DIR.is_dir():
    os.environ["NLTK_DATA"] = str(_NLTK_DIR)
    try:
        import nltk

        if str(_NLTK_DIR) not in nltk.data.path:
            nltk.data.path.insert(0, str(_NLTK_DIR))
    except Exception:
        pass

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("melo-tts")

HOST = "127.0.0.1"
PORT = 8766

_DEFAULT_MODEL = _ROOT / "models" / "melo-zh"

_model = None
_model_lock = threading.Lock()
_ready = False
_load_error: str | None = None


def _resolve_model_paths(model_dir: Path) -> tuple[Path, Path]:
    cfg = model_dir / "config.json"
    ckpt = model_dir / "checkpoint.pth"
    if not cfg.is_file() or not ckpt.is_file():
        raise FileNotFoundError(
            f"未找到 MeloTTS 模型文件：{cfg} / {ckpt}。"
            "请将 myshell-ai/MeloTTS-Chinese 的 config.json 与 checkpoint.pth 放到 models/melo-zh/"
        )
    return cfg, ckpt


def ensure_model(model_dir: Path, device: str = "cpu") -> Any:
    global _model, _ready, _load_error
    if _model is not None:
        return _model
    with _model_lock:
        if _model is not None:
            return _model
        try:
            # 把 vendor/MeloTTS 加入 path（editable 安装失败时兜底）
            vendor = _ROOT / "vendor" / "MeloTTS"
            if vendor.is_dir() and str(vendor) not in sys.path:
                sys.path.insert(0, str(vendor))
            from melo.api import TTS  # type: ignore

            cfg, ckpt = _resolve_model_paths(model_dir)
            log.info("loading MeloTTS ZH from %s ...", model_dir)
            m = TTS(
                language="ZH",
                device=device,
                use_hf=False,
                config_path=str(cfg),
                ckpt_path=str(ckpt),
            )
            _model = m
            _ready = True
            _load_error = None
            log.info("MeloTTS ready speakers=%s", dict(m.hps.data.spk2id))
            return m
        except Exception as e:
            _load_error = f"{type(e).__name__}: {e}"
            log.error("MeloTTS load failed: %s", _load_error)
            raise


def synthesize(text: str, speed: float = 1.0, model_dir: Path | None = None, device: str = "cpu") -> bytes:
    text = (text or "").strip()
    if not text:
        raise ValueError("朗读文本为空")
    if len(text) > 500:
        text = text[:500]
    speed = max(0.5, min(2.0, float(speed) or 1.0))
    model = ensure_model(model_dir or _DEFAULT_MODEL, device=device)
    spk_map = dict(model.hps.data.spk2id)
    spk = spk_map.get("ZH")
    if spk is None:
        # 取第一个 speaker
        spk = next(iter(spk_map.values()))
    # tts_to_file 写临时 wav
    fd, path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        model.tts_to_file(text, spk, path, speed=speed)
        with open(path, "rb") as f:
            return f.read()
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


class Handler(BaseHTTPRequestHandler):
    model_dir: Path = _DEFAULT_MODEL
    device: str = "cpu"

    def log_message(self, fmt: str, *args) -> None:
        log.info("%s - %s", self.address_string(), fmt % args)

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        if self.path.split("?")[0] in ("/health", "/"):
            self._json(
                200,
                {
                    "ok": True,
                    "ready": _ready,
                    "error": _load_error,
                    "provider": "melo",
                    "modelDir": str(self.model_dir),
                },
            )
            return
        self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:
        path = self.path.split("?")[0]
        if path not in ("/tts", "/tts/raw"):
            self._json(404, {"ok": False, "error": "not found"})
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(n) if n else b"{}"
            data = json.loads(raw.decode("utf-8") or "{}")
            text = str(data.get("text") or "")
            speed = float(data.get("speed") or 1.0)
            wav = synthesize(text, speed=speed, model_dir=self.model_dir, device=self.device)
            if path == "/tts/raw":
                self.send_response(200)
                self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Length", str(len(wav)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(wav)
                return
            b64 = base64.b64encode(wav).decode("ascii")
            self._json(
                200,
                {
                    "ok": True,
                    "dataUrl": f"data:audio/wav;base64,{b64}",
                    "bytes": len(wav),
                },
            )
        except Exception as e:
            log.error("tts failed: %s\n%s", e, traceback.format_exc())
            self._json(500, {"ok": False, "error": str(e)})


def main() -> None:
    parser = argparse.ArgumentParser(description="MeloTTS local server")
    parser.add_argument("--host", default=HOST)
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--model-dir", default=str(_DEFAULT_MODEL))
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--preload", action="store_true", help="启动时预加载模型")
    args = parser.parse_args()

    Handler.model_dir = Path(args.model_dir)
    Handler.device = args.device

    if args.preload:
        ensure_model(Handler.model_dir, device=args.device)

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    log.info("MeloTTS listening on http://%s:%s model=%s", args.host, args.port, Handler.model_dir)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        log.info("stopped")


if __name__ == "__main__":
    main()
