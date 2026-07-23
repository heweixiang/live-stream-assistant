"""从抖音 ChatMessage.rtf_content 提取可展示片段。"""

from __future__ import annotations

from typing import Any


def _img_url(image) -> str:
    if image is None:
        return ""
    urls = list(getattr(image, "url_list_list", None) or [])
    for u in urls:
        if u:
            return str(u)
    return ""


def parts_from_rtf(rtf) -> list[dict[str, str]]:
    """返回 [{type: text|image, value: ...}, ...]"""
    parts: list[dict[str, str]] = []
    if rtf is None:
        return parts
    for piece in list(getattr(rtf, "pieces_list", None) or []):
        s = getattr(piece, "string_value", None)
        if isinstance(s, str) and s:
            parts.append({"type": "text", "value": s})
            continue
        img = _img_url(getattr(getattr(piece, "image_value", None), "image", None))
        if img:
            parts.append({"type": "image", "value": img})
            continue
        gift = getattr(piece, "gift_value", None)
        if gift is not None:
            name_ref = getattr(gift, "name_ref", None)
            name = getattr(name_ref, "default_pattern", None) or ""
            if name:
                parts.append({"type": "text", "value": str(name)})
    return parts


def merge_parts_with_content(content: str, rtf_parts: list[dict[str, str]]) -> list[dict[str, str]]:
    """优先用 rtf 图片片段；若没有则退回纯文本（前端再做 [表情] 映射）。"""
    if rtf_parts:
        # rtf 里常只有图片，没有文字；若 content 有 [表情] 且 rtf 全是图，保留 rtf
        return rtf_parts
    if content:
        return [{"type": "text", "value": content}]
    return []
