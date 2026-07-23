"""空闲数据源：只待命，不推弹幕。"""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator

from .base import EventType, LiveEvent


class IdleFetcher:
    def __init__(self) -> None:
        self._running = False

    async def events(self) -> AsyncIterator[LiveEvent]:
        self._running = True
        yield LiveEvent(
            type=EventType.STATUS,
            user="system",
            content="idle",
            room_id="",
            ts=time.time(),
            extra={"mode": "idle", "room": "disconnected"},
        )
        while self._running:
            await asyncio.sleep(3600)

    def stop(self) -> None:
        self._running = False
