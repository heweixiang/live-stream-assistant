"""本地 WebSocket 服务：把弹幕事件推给 Electron 桌面端。"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
import time
from typing import Any, Protocol

# Windows 控制台避免中文乱码
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import websockets
from websockets.asyncio.server import ServerConnection

from fetcher.base import EventType, LiveEvent
from fetcher.idle import IdleFetcher

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("live-core")

HOST = "127.0.0.1"
PORT = 8765
# idle=待命；mock=调试；douyin=抖音（后续可扩其它平台）
SUPPORTED_MODES = {"idle", "mock", "douyin"}


class EventSource(Protocol):
    async def events(self): ...

    def stop(self) -> None: ...


class LiveBridge:
    def __init__(self, mode: str, room_id: str, interval: float) -> None:
        self.mode = mode
        self.room_id = room_id
        self.interval = interval
        self.cookie = ""
        self.clients: set[ServerConnection] = set()
        self._pump_task: asyncio.Task[None] | None = None
        self._fetcher: EventSource | None = None
        self._switch_lock = asyncio.Lock()
        self.room_state = "disconnected"  # disconnected | connecting | connected

    def _create_fetcher(self, mode: str, room_id: str) -> EventSource:
        if mode == "idle":
            return IdleFetcher()
        if mode == "douyin":
            from fetcher.douyin import DouyinFetcher

            return DouyinFetcher(live_id=room_id, cookie=self.cookie)
        from fetcher import MockFetcher

        return MockFetcher(room_id=room_id or "mock-room", interval=self.interval)

    def _status_extra(self) -> dict[str, Any]:
        return {
            "clients": len(self.clients),
            "mode": self.mode,
            "room": self.room_state,
            "platform": self.mode if self.mode != "idle" else "",
        }

    async def register(self, ws: ServerConnection) -> None:
        self.clients.add(ws)
        await self._send(
            ws,
            {
                "type": "status",
                "user": "system",
                "content": "welcome",
                "room_id": self.room_id,
                "ts": time.time(),
                "extra": self._status_extra(),
            },
        )
        log.info("client connected, total=%s", len(self.clients))

    def unregister(self, ws: ServerConnection) -> None:
        self.clients.discard(ws)
        log.info("client disconnected, total=%s", len(self.clients))

    async def broadcast(self, event: LiveEvent) -> None:
        # 根据上游状态同步 room_state
        if event.type == EventType.STATUS:
            c = event.content or ""
            if c in {"douyin_connected", "mock_connected"}:
                self.room_state = "connected"
            elif c.startswith("connecting:") or c == "switched:douyin" or c == "switched:mock":
                if self.room_state != "connected":
                    self.room_state = "connecting"
            elif c in {"idle", "douyin_closed", "live_ended", "switched:idle"}:
                self.room_state = "disconnected"
            elif c.startswith("douyin_error:") or c.startswith("pump_error:") or c.startswith("error:"):
                self.room_state = "disconnected"
            event.extra = {**(event.extra or {}), **self._status_extra()}

        if not self.clients:
            return
        payload = json.dumps(event.to_dict(), ensure_ascii=False)
        dead: list[ServerConnection] = []
        for ws in self.clients:
            try:
                await ws.send(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.unregister(ws)

    async def _send(self, ws: ServerConnection, data: dict[str, Any]) -> None:
        await ws.send(json.dumps(data, ensure_ascii=False))

    async def _pump_loop(self) -> None:
        assert self._fetcher is not None
        try:
            async for event in self._fetcher.events():
                if event.type != EventType.STATUS:
                    log.info(
                        "[%s] %s %s",
                        event.type.value,
                        event.user,
                        event.content or event.gift_name,
                    )
                await self.broadcast(event)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            log.exception("pump failed: %s", exc)
            await self.broadcast(
                LiveEvent(
                    type=EventType.STATUS,
                    user="system",
                    content=f"pump_error:{exc}",
                    room_id=self.room_id,
                    ts=time.time(),
                )
            )

    async def stop_pump(self) -> None:
        if self._fetcher is not None:
            self._fetcher.stop()
            self._fetcher = None
        if self._pump_task is not None:
            self._pump_task.cancel()
            try:
                await self._pump_task
            except asyncio.CancelledError:
                pass
            self._pump_task = None

    async def start_pump(self) -> None:
        self._fetcher = self._create_fetcher(self.mode, self.room_id)
        self._pump_task = asyncio.create_task(self._pump_loop(), name="event-pump")

    async def switch(self, mode: str, room_id: str, cookie: str | None = None) -> None:
        """切换平台 / 断开。mode=idle 表示断开直播间。"""
        mode = (mode or "idle").strip().lower()
        room_id = (room_id or "").strip()
        if cookie is not None:
            self.cookie = cookie.strip()
            if self.cookie:
                try:
                    from fetcher.cookie_util import save_cookie

                    save_cookie(self.cookie)
                except Exception:
                    pass
        if mode not in SUPPORTED_MODES:
            raise ValueError(f"unknown mode: {mode}，当前支持: {', '.join(sorted(SUPPORTED_MODES))}")
        if mode == "douyin" and not room_id:
            raise ValueError("抖音模式需要填写直播号")

        async with self._switch_lock:
            log.info("switch mode=%s room=%s", mode, room_id)
            await self.stop_pump()

            self.mode = mode
            if mode == "idle":
                self.room_id = ""
                self.room_state = "disconnected"
            elif mode == "douyin":
                self.room_id = room_id
                self.room_state = "connecting"
            else:
                self.room_id = room_id or "mock-room"
                self.room_state = "connecting"

            await self.start_pump()
            await self.broadcast(
                LiveEvent(
                    type=EventType.STATUS,
                    user="system",
                    content=f"switched:{self.mode}",
                    room_id=self.room_id,
                    ts=time.time(),
                    extra=self._status_extra(),
                )
            )

    async def handler(self, ws: ServerConnection) -> None:
        await self.register(ws)
        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                action = msg.get("action")
                if action == "ping":
                    await self._send(
                        ws,
                        {
                            "type": "status",
                            "user": "system",
                            "content": "pong",
                            "extra": self._status_extra(),
                        },
                    )
                    continue

                if action == "disconnect":
                    try:
                        await self.switch(mode="idle", room_id="")
                        await self._send(
                            ws,
                            {
                                "type": "status",
                                "user": "system",
                                "content": "ok",
                                "ts": time.time(),
                                "extra": self._status_extra(),
                            },
                        )
                    except Exception as exc:  # noqa: BLE001
                        await self._send(
                            ws,
                            {
                                "type": "status",
                                "user": "system",
                                "content": f"error:{exc}",
                                "ts": time.time(),
                            },
                        )
                    continue

                if action in {"connect", "switch"}:
                    try:
                        await self.switch(
                            mode=str(msg.get("mode") or msg.get("platform") or self.mode),
                            room_id=str(msg.get("room_id") or msg.get("live_id") or ""),
                            cookie=msg.get("cookie"),
                        )
                        await self._send(
                            ws,
                            {
                                "type": "status",
                                "user": "system",
                                "content": "ok",
                                "room_id": self.room_id,
                                "ts": time.time(),
                                "extra": self._status_extra(),
                            },
                        )
                    except Exception as exc:  # noqa: BLE001
                        log.exception("switch failed")
                        self.room_state = "disconnected"
                        await self._send(
                            ws,
                            {
                                "type": "status",
                                "user": "system",
                                "content": f"error:{exc}",
                                "ts": time.time(),
                                "extra": self._status_extra(),
                            },
                        )
        finally:
            self.unregister(ws)


async def main(mode: str, room_id: str, interval: float) -> None:
    bridge = LiveBridge(mode=mode, room_id=room_id, interval=interval)
    async with websockets.serve(bridge.handler, HOST, PORT):
        log.info("live core listening on ws://%s:%s mode=%s", HOST, PORT, mode)
        # 默认 idle：只起服务，等桌面端点「连接」再进直播间
        await bridge.start_pump()
        await asyncio.Future()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="直播助手弹幕核心")
    parser.add_argument(
        "--mode",
        choices=sorted(SUPPORTED_MODES),
        default="idle",
        help="idle=待命(默认)；douyin/mock 可直接启动对应源",
    )
    parser.add_argument(
        "--room",
        default="",
        help="抖音填 live.douyin.com/后面的直播号",
    )
    parser.add_argument("--interval", type=float, default=1.2, help="Mock 事件基础间隔秒")
    args = parser.parse_args()
    try:
        asyncio.run(main(args.mode, args.room, args.interval))
    except KeyboardInterrupt:
        log.info("bye")
