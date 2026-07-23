# -*- coding: utf-8 -*-
"""拉取抖音直播礼物列表，写入 app/public/douyin-gifts.json

用法: python tools/fetch_douyin_gifts.py
"""
from __future__ import annotations

import json
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "app" / "public" / "douyin-gifts.json"
URL = (
    "https://live.douyin.com/webcast/gift/list/"
    "?aid=6383&app_name=douyin_web&live_id=1"
    "&device_platform=web&language=zh-CN&cookie_enabled=true"
)


def first_url(img: object) -> str:
    if not isinstance(img, dict):
        return ""
    urls = img.get("url_list") or img.get("url_list_list") or []
    for u in urls:
        if isinstance(u, str) and u.startswith("http"):
            return u
    uri = (img.get("uri") or "").strip()
    if uri.startswith("http"):
        return uri
    if uri:
        return f"https://p3-webcast.douyinpic.com/img/{uri}~tplv-obj.png"
    return ""


def main() -> None:
    req = urllib.request.Request(
        URL,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            "Referer": "https://live.douyin.com/",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    gifts = (data.get("data") or {}).get("gifts") or []
    out: list[dict] = []
    seen: set[str] = set()
    for g in gifts:
        name = (g.get("name") or g.get("describe") or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        icon = first_url(g.get("image")) or first_url(g.get("icon"))
        out.append(
            {
                "id": int(g.get("id") or 0),
                "name": name,
                "diamond": int(g.get("diamond_count") or 0),
                "icon": icon,
                "panel": bool(g.get("is_displayed_on_panel")),
            }
        )

    out.sort(key=lambda x: (not x["panel"], x["diamond"], x["name"]))
    payload = {
        "version": 1,
        "source": "https://live.douyin.com/webcast/gift/list/",
        "updatedAt": date.today().isoformat(),
        "count": len(out),
        "gifts": out,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} gifts={len(out)} icons={sum(1 for x in out if x['icon'])}")


if __name__ == "__main__":
    main()
