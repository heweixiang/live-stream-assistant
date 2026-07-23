"""基于网页版协议连接抖音直播间（非官方开放平台）。

使用方式：填 live.douyin.com/后面的直播号（web_rid）。
依赖 vendor/douyin_web（源自 DouyinLiveWebFetcher，AGPL-3.0）。
"""

from __future__ import annotations

import asyncio
import logging
import sys
import threading
import time
from collections.abc import AsyncIterator
from pathlib import Path

from .base import EventType, LiveEvent
from .cookie_util import build_ws_cookie, cookie_has_login, load_cookie
from .richtext import merge_parts_with_content, parts_from_rtf

log = logging.getLogger("live-core.douyin")

VENDOR_DIR = Path(__file__).resolve().parents[1] / "vendor" / "douyin_web"


def _first_image_url(image) -> str:
    """从 protobuf Image 取第一张可用图。"""
    if image is None:
        return ""
    urls = list(getattr(image, "url_list_list", None) or []) or list(
        getattr(image, "url_list", None) or []
    )
    # 优先 https 且像静态图的地址
    ranked: list[str] = []
    for u in urls:
        s = str(u or "").strip()
        if not s:
            continue
        ranked.append(s)
    for s in ranked:
        if s.startswith("https://") and any(ext in s.lower() for ext in (".png", ".webp", ".jpg", ".jpeg", ".gif", "~tplv")):
            return s
    for s in ranked:
        if s.startswith("http"):
            return s
    uri = (getattr(image, "uri", None) or "").strip()
    if uri:
        if uri.startswith("http"):
            return uri
        # 抖音 webcast 图床：uri → 完整 URL
        return f"https://p3-webcast.douyinpic.com/img/{uri}~tplv-obj.png"
    return ""


def _gift_icon_url(gift) -> str:
    """优先 image / icon / gift_label_icon。"""
    if gift is None:
        return ""
    return (
        _first_image_url(getattr(gift, "image", None))
        or _first_image_url(getattr(gift, "icon", None))
        or _first_image_url(getattr(gift, "gift_label_icon", None))
    )


def _urls_from_bytes(data: bytes) -> list[str]:
    """从二进制里捞礼物图 URL。"""
    import re

    found = re.findall(rb"https?://[^\s\"'<>\\]{12,240}", data)
    out: list[str] = []
    for raw in found:
        try:
            s = raw.decode("utf-8", errors="ignore").rstrip("\\")
        except Exception:
            continue
        low = s.lower()
        if any(k in low for k in ("douyinpic", "byteimg", "gift", "webcast", ".png", ".webp", ".jpg")):
            out.append(s)
    return out


def _gift_count(message) -> int:
    """连击数量：取各计数字段最大值。"""
    vals = [
        int(getattr(message, "combo_count", 0) or 0),
        int(getattr(message, "repeat_count", 0) or 0),
        int(getattr(message, "group_count", 0) or 0),
        int(getattr(message, "total_count", 0) or 0),
    ]
    return max(vals) if any(vals) else 1


def _parse_count_text(text: str) -> int:
    """从『43在线观众』『12.4万本场点赞』解析数量。"""
    import re

    s = (text or "").strip().replace(",", "")
    if not s:
        return 0
    m = re.search(r"(\d+(?:\.\d+)?)\s*万", s)
    if m:
        return int(float(m.group(1)) * 10000)
    m = re.search(r"(\d+(?:\.\d+)?)\s*w", s, re.I)
    if m:
        return int(float(m.group(1)) * 10000)
    m = re.search(r"(\d+)", s)
    return int(m.group(1)) if m else 0


def _common_text(common) -> str:
    """从 Common.describe / display_text 取可读文案。"""
    if common is None:
        return ""
    desc = (getattr(common, "describe", None) or "").strip()
    if desc:
        return desc
    dt = getattr(common, "display_text", None)
    if dt is None:
        return ""
    return (
        getattr(dt, "default_pattern", None)
        or getattr(dt, "default_patter", None)
        or getattr(dt, "key", None)
        or ""
    ).strip()


def _is_notice_text(text: str) -> bool:
    t = text or ""
    return any(k in t for k in ("恭喜", "升级", "TOP", "粉丝团", "成为在线观众"))


def _strings_from_bytes(data: bytes, min_len: int = 2) -> list[str]:
    """从 protobuf 二进制里捞可读 UTF-8 串（兜底解析未知礼物包）。"""
    out: list[str] = []
    i = 0
    n = len(data)
    while i < n:
        # protobuf string: (field<<3)|2 then varint length
        if i + 1 < n and (data[i] & 7) == 2:
            pos = i + 1
            length = 0
            shift = 0
            ok = False
            while pos < n and shift < 32:
                b = data[pos]
                pos += 1
                length |= (b & 0x7F) << shift
                if not (b & 0x80):
                    ok = True
                    break
                shift += 7
            if ok and 0 < length <= 200 and pos + length <= n:
                chunk = data[pos : pos + length]
                try:
                    s = chunk.decode("utf-8")
                    if len(s) >= min_len and any("\u4e00" <= c <= "\u9fff" for c in s):
                        out.append(s)
                except Exception:
                    pass
                i = pos + length
                continue
        i += 1
    return out


def _ensure_vendor_path() -> Path:
    if not VENDOR_DIR.exists():
        raise RuntimeError(f"缺少抖音网页抓取依赖目录: {VENDOR_DIR}")
    path = str(VENDOR_DIR)
    if path not in sys.path:
        sys.path.insert(0, path)
    return VENDOR_DIR


class DouyinFetcher:
    """把 DouyinLiveWebFetcher 回调转成异步 LiveEvent 流。"""

    def __init__(self, live_id: str, cookie: str = "") -> None:
        self.live_id = str(live_id).strip()
        self.cookie = (cookie or "").strip()
        self._running = False
        self._thread: threading.Thread | None = None
        self._room = None
        self._queue: asyncio.Queue[LiveEvent | None] | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    async def events(self) -> AsyncIterator[LiveEvent]:
        if not self.live_id:
            yield LiveEvent(
                type=EventType.STATUS,
                user="system",
                content="请填写直播号（live.douyin.com/后面的数字）",
                room_id="",
                ts=time.time(),
            )
            return

        vendor = _ensure_vendor_path()
        # 延迟导入，避免 mock 模式也加载重依赖
        from liveMan import DouyinLiveWebFetcher, generateSignature  # type: ignore

        cookie = self.cookie or load_cookie()
        logged_in = cookie_has_login(cookie)

        self._queue = asyncio.Queue()
        self._loop = asyncio.get_running_loop()
        self._running = True

        adapter = _CallbackRoom(
            live_id=self.live_id,
            vendor_dir=vendor,
            emit=self._emit,
            generate_signature=generateSignature,
            base_cls=DouyinLiveWebFetcher,
            cookie=cookie,
        )
        self._room = adapter

        self._emit(
            LiveEvent(
                type=EventType.STATUS,
                user="system",
                content=f"connecting:{self.live_id}",
                room_id=self.live_id,
                ts=time.time(),
                extra={"mode": "douyin", "has_cookie": bool(cookie), "logged_in": logged_in},
            )
        )
        if not logged_in:
            self._emit(
                LiveEvent(
                    type=EventType.STATUS,
                    user="system",
                    content="gift_hint:未检测到登录 Cookie（需含 sessionid）。很多直播间不填登录态收不到礼物，请点顶栏「填登录 Cookie」粘贴后重连。",
                    room_id=self.live_id,
                    ts=time.time(),
                )
            )

        self._thread = threading.Thread(target=adapter.start, name="douyin-wss", daemon=True)
        self._thread.start()

        assert self._queue is not None
        while self._running:
            item = await self._queue.get()
            if item is None:
                break
            yield item

    def stop(self) -> None:
        self._running = False
        try:
            if self._room is not None:
                self._room.stop()
        except Exception as exc:  # noqa: BLE001
            log.warning("stop douyin room failed: %s", exc)
        if self._queue is not None and self._loop is not None:
            self._loop.call_soon_threadsafe(self._queue.put_nowait, None)

    def _emit(self, event: LiveEvent) -> None:
        if not self._running or self._queue is None or self._loop is None:
            return
        self._loop.call_soon_threadsafe(self._queue.put_nowait, event)


class _CallbackRoom:
    """运行期拼出子类，避免静态依赖 vendor。"""

    def __init__(self, live_id, vendor_dir, emit, generate_signature, base_cls, cookie: str = "") -> None:
        sign_file = str(vendor_dir / "sign.js")
        abogus_file = str(vendor_dir / "a_bogus.js")
        outer_emit = emit
        self._emit = emit
        user_cookie = cookie or ""
        # 记录上一轮在线榜，用于发出「成为 TOP」提示
        prev_top_names: list[str] = []

        class Room(base_cls):  # type: ignore[misc,valid-type]
            def _connectWebSocket(self):  # noqa: N802
                # 升级 SDK + 补握手头，提升礼物下发成功率
                sdk = "1.0.15.0"
                ua = (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/134.0.0.0 Safari/537.36"
                )
                # hl / lq 节点轮换：部分房间礼物只在其一下发
                host = "webcast100-ws-web-hl.douyin.com"
                wss = (
                    f"wss://{host}/webcast/im/push/v2/?app_name=douyin_web"
                    f"&version_code=180800&webcast_sdk_version={sdk}"
                    f"&update_version_code={sdk}&compress=gzip&device_platform=web&cookie_enabled=true"
                    "&screen_width=1920&screen_height=1080&browser_language=zh-CN&browser_platform=Win32"
                    "&browser_name=Mozilla"
                    f"&browser_version=5.0%20(Windows%20NT%2010.0;%20Win64;%20x64)%20AppleWebKit/537.36%20(KHTML,"
                    "%20like%20Gecko)%20Chrome/134.0.0.0%20Safari/537.36"
                    "&browser_online=true&tz_name=Asia/Shanghai"
                    "&cursor=d-1_u-1_fh-7392091211001140287_t-1721106114633_r-1"
                    f"&internal_ext=internal_src:dim|wss_push_room_id:{self.room_id}|wss_push_did:7319483754668557238"
                    f"|first_req_ms:1721106114541|fetch_time:1721106114633|seq:1|wss_info:0-1721106114633-0-0|"
                    f"wrds_v:7392094459690748497"
                    f"&host=https://live.douyin.com&aid=6383&live_id=1&did_rule=3&endpoint=live_pc&support_wrds=1"
                    f"&user_unique_id=7319483754668557238&im_path=/webcast/im/fetch/&identity=audience"
                    f"&need_persist_msg_count=15&insert_task_id=&live_reason=&room_id={self.room_id}&heartbeatDuration=0"
                )
                signature = generate_signature(wss, script_file=sign_file)
                wss += f"&signature={signature}"

                import websocket

                cookie_header = build_ws_cookie(self.ttwid, user_cookie)
                # 握手头大小写按浏览器习惯；缺 Origin/Referer 时部分房间不下发礼物
                headers = [
                    f"User-Agent: {ua}",
                    f"Cookie: {cookie_header}",
                    "Origin: https://live.douyin.com",
                    f"Referer: https://live.douyin.com/{self.live_id}",
                ]
                log.info(
                    "wss connect room=%s cookie_keys=%s logged_in=%s",
                    self.live_id,
                    [p.split("=", 1)[0] for p in cookie_header.split("; ") if "=" in p][:12],
                    cookie_has_login(user_cookie),
                )
                self.ws = websocket.WebSocketApp(
                    wss,
                    header=headers,
                    on_open=self._wsOnOpen,
                    on_message=self._wsOnMessage,
                    on_error=self._wsOnError,
                    on_close=self._wsOnClose,
                )
                try:
                    self.ws.run_forever()
                except Exception:
                    self.stop()
                    raise

            def _wsOnMessage(self, ws, message):  # noqa: N802
                """覆盖上游：礼物解析失败也打日志，并解析弹幕富文本表情图。"""
                import gzip

                from protobuf.douyin import PushFrame, Response  # type: ignore

                package = PushFrame().parse(message)
                response = Response().parse(gzip.decompress(package.payload))
                if response.need_ack:
                    ack = PushFrame(
                        log_id=package.log_id,
                        payload_type="ack",
                        payload=response.internal_ext.encode("utf-8"),
                    ).SerializeToString()
                    ws.send(ack)

                handlers = {
                    "WebcastChatMessage": self._parseChatMsg,
                    "WebcastGiftMessage": self._parseGiftMsg,
                    "WebcastLikeMessage": self._parseLikeMsg,
                    "WebcastMemberMessage": self._parseMemberMsg,
                    "WebcastSocialMessage": self._parseSocialMsg,
                    "WebcastEmojiChatMessage": self._parseEmojiChatMsg,
                    "WebcastControlMessage": self._parseControlMsg,
                    "WebcastRoomUserSeqMessage": self._parseRoomUserSeqMsg,
                    "WebcastRoomStatsMessage": self._parseRoomStatsMsg,
                    "WebcastFansclubMessage": self._parseFansclubMsg,
                    "WebcastRoomMessage": self._parseRoomMsg,
                    "WebcastRoomRankMessage": self._parseRankMsg,
                    # 部分房间免费礼/轻礼物走这些 method
                    "WebcastLightGiftMessage": self._parseGiftMsgFallback,
                    "WebcastBindingGiftMessage": self._parseGiftMsgFallback,
                    "WebcastGiftSortMessage": self._parseGiftSortMsg,
                }
                for msg in response.messages_list:
                    fn = handlers.get(msg.method)
                    if not fn:
                        method = msg.method or ""
                        if any(k in method for k in ("Gift", "Level", "Rank", "Fans", "Notify", "Honor")):
                            log.info("unhandled method: %s", method)
                        continue
                    try:
                        fn(msg.payload)
                    except Exception as exc:  # noqa: BLE001
                        log.warning("parse %s failed: %s", msg.method, exc)

            def _wsOnOpen(self, ws):  # noqa: N802
                outer_emit(
                    LiveEvent(
                        type=EventType.STATUS,
                        user="system",
                        content="douyin_connected",
                        room_id=str(self.live_id),
                        ts=time.time(),
                        extra={"room_id": str(self.room_id)},
                    )
                )
                super()._wsOnOpen(ws)

            def _wsOnError(self, ws, error):  # noqa: N802
                outer_emit(
                    LiveEvent(
                        type=EventType.STATUS,
                        user="system",
                        content=f"douyin_error:{error}",
                        room_id=str(self.live_id),
                        ts=time.time(),
                    )
                )
                super()._wsOnError(ws, error)

            def _wsOnClose(self, ws, *args):  # noqa: N802
                outer_emit(
                    LiveEvent(
                        type=EventType.STATUS,
                        user="system",
                        content="douyin_closed",
                        room_id=str(self.live_id),
                        ts=time.time(),
                    )
                )
                # 不调用 get_room_status（上游标注过不稳定），直接结束
                try:
                    print("WebSocket connection closed.")
                except Exception:
                    pass

            def _parseChatMsg(self, payload):  # noqa: N802
                from protobuf.douyin import ChatMessage  # type: ignore

                message = ChatMessage().parse(payload)
                content = message.content or ""
                rtf_parts = parts_from_rtf(getattr(message, "rtf_content", None))
                parts = merge_parts_with_content(content, rtf_parts)
                # 聊天里偶发带 gift_image（表情/礼物图）
                gift_img = _first_image_url(getattr(message, "gift_image", None))
                if gift_img and not any(p.get("type") == "image" for p in parts):
                    parts = [*parts, {"type": "image", "value": gift_img}]
                outer_emit(
                    LiveEvent(
                        type=EventType.CHAT,
                        user=message.user.nick_name or "未知用户",
                        content=content,
                        content_parts=parts,
                        room_id=str(self.live_id),
                        ts=time.time(),
                        extra={"user_id": str(getattr(message.user, "id", ""))},
                    )
                )

            def _parseGiftMsg(self, payload):  # noqa: N802
                from protobuf.douyin import GiftMessage  # type: ignore

                message = GiftMessage().parse(payload)
                gift = message.gift
                gift_name = ""
                if gift is not None:
                    gift_name = (gift.name or "") or (gift.describe or "")
                if not gift_name:
                    # tray_display_text 兜底
                    try:
                        gift_name = getattr(message.tray_display_text, "default_patter", "") or "礼物"
                    except Exception:
                        gift_name = "礼物"
                count = _gift_count(message)
                unit = int(getattr(gift, "diamond_count", 0) or 0) if gift else 0
                icon = _gift_icon_url(gift)
                if not icon:
                    # 托盘文案 / 原始包里再捞图
                    urls = _urls_from_bytes(payload)
                    icon = urls[0] if urls else ""
                log.info("[gift] %s 送出 %s x%s icon=%s", (message.user.nick_name if message.user else None) or "?", gift_name, count, bool(icon))
                outer_emit(
                    LiveEvent(
                        type=EventType.GIFT,
                        user=(message.user.nick_name if message.user else None) or "未知用户",
                        gift_name=gift_name,
                        gift_count=count,
                        gift_value=unit * count,
                        gift_icon=icon,
                        content=f"送出了 {gift_name}",
                        room_id=str(self.live_id),
                        ts=time.time(),
                        extra={
                            "gift_id": str(getattr(gift, "id", "") if gift else getattr(message, "gift_id", "")),
                            "repeat_end": int(getattr(message, "repeat_end", 0) or 0),
                        },
                    )
                )

            def _parseGiftMsgFallback(self, payload):  # noqa: N802
                """LightGift / BindingGift：先按 GiftMessage 解，失败再抽字符串。"""
                try:
                    self._parseGiftMsg(payload)
                    return
                except Exception:
                    pass
                strs = _strings_from_bytes(payload)
                # 过滤噪声，优先像礼物名的短词
                skip = {"送出了", "送出", "个", "x", "X"}
                names = [s for s in strs if s not in skip and 1 < len(s) <= 16]
                user = next((s for s in strs if len(s) >= 2 and s not in names[:1]), "未知用户")
                gift_name = names[0] if names else (strs[0] if strs else "礼物")
                if user == gift_name and len(strs) > 1:
                    user = strs[0]
                    gift_name = strs[1]
                urls = _urls_from_bytes(payload)
                icon = urls[0] if urls else ""
                log.info("[gift-fallback] %s 送出了 %s | icon=%s raw=%s", user, gift_name, bool(icon), strs[:6])
                outer_emit(
                    LiveEvent(
                        type=EventType.GIFT,
                        user=user,
                        gift_name=gift_name,
                        gift_count=1,
                        gift_value=0,
                        gift_icon=icon,
                        content=f"送出了 {gift_name}",
                        room_id=str(self.live_id),
                        ts=time.time(),
                        extra={"source": "fallback"},
                    )
                )

            def _parseGiftSortMsg(self, payload):  # noqa: N802
                """礼物面板排序包：用来补全礼物名与图标目录（不计入送礼）。"""
                strs = _strings_from_bytes(payload)
                urls = _urls_from_bytes(payload)
                # 中文短名当作礼物名
                names = [
                    s
                    for s in strs
                    if 1 < len(s) <= 16 and any("\u4e00" <= c <= "\u9fff" for c in s)
                ]
                items = []
                for i, name in enumerate(names[:40]):
                    icon = urls[i] if i < len(urls) else (urls[0] if urls else "")
                    items.append({"name": name, "icon": icon})
                if items:
                    log.info("[gift-sort] catalog +%s", len(items))
                    outer_emit(
                        LiveEvent(
                            type=EventType.STATUS,
                            user="system",
                            content="gift_catalog",
                            room_id=str(self.live_id),
                            ts=time.time(),
                            extra={"items": items},
                        )
                    )

            def _parseEmojiChatMsg(self, payload):  # noqa: N802
                from protobuf.douyin import EmojiChatMessage  # type: ignore

                message = EmojiChatMessage().parse(payload)
                content = message.default_content or "[表情]"
                # emoji_content 里可能有文本
                try:
                    pieces = getattr(message.emoji_content, "pieces_list", None) or []
                    texts = []
                    for p in pieces:
                        t = getattr(getattr(p, "string_value", None), "default_pattern", None) or getattr(
                            p, "string_value", None
                        )
                        if isinstance(t, str) and t:
                            texts.append(t)
                        elif hasattr(t, "default_pattern") and t.default_pattern:
                            texts.append(t.default_pattern)
                    if texts:
                        content = "".join(texts)
                except Exception:
                    pass
                outer_emit(
                    LiveEvent(
                        type=EventType.CHAT,
                        user=message.user.nick_name or "未知用户",
                        content=content,
                        room_id=str(self.live_id),
                        ts=time.time(),
                        extra={"emoji_id": str(message.emoji_id)},
                    )
                )

            def _parseLikeMsg(self, payload):  # noqa: N802
                from protobuf.douyin import LikeMessage  # type: ignore

                message = LikeMessage().parse(payload)
                like_total = int(getattr(message, "total", 0) or 0)
                outer_emit(
                    LiveEvent(
                        type=EventType.LIKE,
                        user=message.user.nick_name or "未知用户",
                        content="点赞了",
                        room_id=str(self.live_id),
                        ts=time.time(),
                        extra={
                            "count": int(message.count or 1),
                            "like_total": like_total,
                        },
                    )
                )
                if like_total > 0:
                    outer_emit(
                        LiveEvent(
                            type=EventType.ROOM,
                            user="system",
                            content="like_total",
                            room_id=str(self.live_id),
                            ts=time.time(),
                            extra={"like_total": like_total},
                        )
                    )

            def _parseRoomUserSeqMsg(self, payload):  # noqa: N802
                from protobuf.douyin import RoomUserSeqMessage  # type: ignore

                message = RoomUserSeqMessage().parse(payload)
                # total ≈ 当前在线；total_str / online_user_for_anchor 为展示文案
                online = int(getattr(message, "total", 0) or 0)
                online_str = (
                    (getattr(message, "total_str", None) or "")
                    or (getattr(message, "online_user_for_anchor", None) or "")
                    or ""
                ).strip()
                if online <= 0 and online_str:
                    # 从「61」「1.2万」里尽量抠数字
                    online = _parse_count_text(online_str) or online
                log.info("[room] online=%s str=%s", online, online_str)
                outer_emit(
                    LiveEvent(
                        type=EventType.ROOM,
                        user="system",
                        content="online",
                        room_id=str(self.live_id),
                        ts=time.time(),
                        extra={
                            "online": online,
                            "online_str": online_str,
                            "total_user_str": getattr(message, "total_user_str", "") or "",
                        },
                    )
                )

            def _parseRoomStatsMsg(self, payload):  # noqa: N802
                from protobuf.douyin import RoomStatsMessage  # type: ignore

                message = RoomStatsMessage().parse(payload)
                display = (
                    getattr(message, "display_long", "")
                    or getattr(message, "display_middle", "")
                    or getattr(message, "display_short", "")
                    or ""
                )
                display_value = int(getattr(message, "display_value", 0) or 0)
                extra: dict = {"display": display, "display_value": display_value}
                # 「43在线观众」/「12.4万本场点赞」
                if display:
                    if "在线" in display or "观众" in display:
                        n = display_value or _parse_count_text(display)
                        if n:
                            extra["online"] = n
                            extra["online_str"] = display.replace("在线观众", "").replace("在线", "").strip() or str(n)
                    if "赞" in display:
                        n = display_value or _parse_count_text(display)
                        if n:
                            extra["like_total"] = n
                            extra["like_str"] = display
                if display or extra.get("online") or extra.get("like_total"):
                    log.info("[room] stats display=%s extra=%s", display, {k: extra[k] for k in extra if k != "display"})
                    outer_emit(
                        LiveEvent(
                            type=EventType.ROOM,
                            user="system",
                            content="stats",
                            room_id=str(self.live_id),
                            ts=time.time(),
                            extra=extra,
                        )
                    )

            def _parseMemberMsg(self, payload):  # noqa: N802
                from protobuf.douyin import MemberMessage  # type: ignore

                message = MemberMessage().parse(payload)
                user = (message.user.nick_name if message.user else None) or "未知用户"
                outer_emit(
                    LiveEvent(
                        type=EventType.ENTER,
                        user=user,
                        content="来了",
                        room_id=str(self.live_id),
                        ts=time.time(),
                    )
                )

            def _parseSocialMsg(self, payload):  # noqa: N802
                from protobuf.douyin import SocialMessage  # type: ignore

                message = SocialMessage().parse(payload)
                outer_emit(
                    LiveEvent(
                        type=EventType.FOLLOW,
                        user=message.user.nick_name or "未知用户",
                        content="关注了主播",
                        room_id=str(self.live_id),
                        ts=time.time(),
                    )
                )

            def _parseFansclubMsg(self, payload):  # noqa: N802
                from protobuf.douyin import FansclubMessage  # type: ignore

                message = FansclubMessage().parse(payload)
                content = (message.content or "").strip()
                user = (message.user.nick_name if message.user else None) or ""
                if not content:
                    kind = int(getattr(message, "type", 0) or 0)
                    if kind == 1:
                        content = f"恭喜 {user} 粉丝团升级"
                    elif kind == 2:
                        content = f"恭喜 {user} 加入粉丝团"
                    else:
                        content = f"{user} 粉丝团动态" if user else "粉丝团动态"
                if not user and content.startswith("恭喜"):
                    # 文案里常自带昵称
                    user = "系统"
                log.info("[fansclub] %s", content)
                outer_emit(
                    LiveEvent(
                        type=EventType.NOTICE,
                        user=user or "系统",
                        content=content,
                        room_id=str(self.live_id),
                        ts=time.time(),
                        extra={
                            "kind": "fansclub",
                            "fansclub_type": int(getattr(message, "type", 0) or 0),
                        },
                    )
                )

            def _parseRoomMsg(self, payload):  # noqa: N802
                from protobuf.douyin import RoomMessage  # type: ignore

                message = RoomMessage().parse(payload)
                content = (message.content or "").strip() or _common_text(getattr(message, "common", None))
                if not content or not _is_notice_text(content):
                    return
                log.info("[room-msg] %s", content)
                outer_emit(
                    LiveEvent(
                        type=EventType.NOTICE,
                        user="系统",
                        content=content,
                        room_id=str(self.live_id),
                        ts=time.time(),
                        extra={"kind": "room"},
                    )
                )

            def _parseRankMsg(self, payload):  # noqa: N802
                from protobuf.douyin import RoomRankMessage  # type: ignore

                nonlocal prev_top_names
                message = RoomRankMessage().parse(payload)
                ranks = list(getattr(message, "ranks_list", None) or [])
                names: list[str] = []
                for i, item in enumerate(ranks[:5], start=1):
                    u = getattr(item, "user", None)
                    name = (getattr(u, "nick_name", None) if u else None) or ""
                    if name:
                        names.append(name)
                # 首次只记榜，不刷屏；之后有人新进前三再提示
                if prev_top_names:
                    for i, name in enumerate(names[:3], start=1):
                        prev_idx = prev_top_names.index(name) + 1 if name in prev_top_names else 0
                        if prev_idx != i:
                            text = f"恭喜 {name} 成为在线观众TOP{i}"
                            log.info("[rank] %s", text)
                            outer_emit(
                                LiveEvent(
                                    type=EventType.NOTICE,
                                    user=name,
                                    content=text,
                                    room_id=str(self.live_id),
                                    ts=time.time(),
                                    extra={"kind": "top", "rank": i},
                                )
                            )
                prev_top_names = names

            def _parseControlMsg(self, payload):  # noqa: N802
                from protobuf.douyin import ControlMessage  # type: ignore

                message = ControlMessage().parse(payload)
                if message.status == 3:
                    outer_emit(
                        LiveEvent(
                            type=EventType.STATUS,
                            user="system",
                            content="live_ended",
                            room_id=str(self.live_id),
                            ts=time.time(),
                        )
                    )
                    self.stop()

        self._room = Room(live_id, abogus_file=abogus_file)

    def start(self) -> None:
        try:
            rid = self._room.room_id
            if not rid:
                raise RuntimeError("无法解析直播间，请确认直播号正确且正在开播")
            self._emit(
                LiveEvent(
                    type=EventType.STATUS,
                    user="system",
                    content=f"resolved_room:{rid}",
                    room_id=str(self._room.live_id),
                    ts=time.time(),
                    extra={"room_id": str(rid)},
                )
            )
            self._room.start()
        except Exception as exc:  # noqa: BLE001
            log.exception("douyin fetch failed: %s", exc)
            self._emit(
                LiveEvent(
                    type=EventType.STATUS,
                    user="system",
                    content=f"douyin_error:{exc}",
                    room_id=str(getattr(self._room, "live_id", "")),
                    ts=time.time(),
                )
            )

    def stop(self) -> None:
        try:
            self._room.stop()
        except Exception:
            pass
