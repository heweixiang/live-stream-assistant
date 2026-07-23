"""抖音 Cookie 读写（礼物等消息常需登录态）。"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

CONFIG_PATH = Path(__file__).resolve().parents[1] / "config" / "douyin.json"


def load_cookie() -> str:
    try:
        if not CONFIG_PATH.exists():
            return ""
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        return str(data.get("cookie") or "").strip()
    except Exception:
        return ""


def save_cookie(cookie: str) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    existing: dict = {}
    if CONFIG_PATH.exists():
        try:
            existing = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except Exception:
            existing = {}
    existing["cookie"] = (cookie or "").strip()
    CONFIG_PATH.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")


def build_ws_cookie(ttwid: str | None, user_cookie: str = "") -> str:
    """组装 WSS Cookie：用户登录 Cookie 优先，并补齐常见字段。"""
    parts: dict[str, str] = {}
    raw = (user_cookie or "").strip()
    if raw:
        for seg in raw.split(";"):
            seg = seg.strip()
            if not seg or "=" not in seg:
                continue
            k, v = seg.split("=", 1)
            parts[k.strip()] = v.strip()
    if ttwid and "ttwid" not in parts:
        parts["ttwid"] = ttwid
    # 2025 起缺这些字段时，部分直播间不下发礼物
    if "x-web-secsdk-uid" not in parts:
        parts["x-web-secsdk-uid"] = str(uuid.uuid4())
    if "__live_version__" not in parts:
        parts["__live_version__"] = '"1.1.4.7838"'
    if "live_use_vvc" not in parts:
        parts["live_use_vvc"] = '"false"'
    return "; ".join(f"{k}={v}" for k, v in parts.items())


def cookie_has_login(cookie: str) -> bool:
    """粗判是否像登录态（含 sessionid / sid_tt 等）。"""
    low = (cookie or "").lower()
    return any(k in low for k in ("sessionid=", "sid_tt=", "uid_tt=", "sid_guard="))
