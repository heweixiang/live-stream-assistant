"""Mock 弹幕源：不连抖音，持续产出模拟事件，方便联调 UI。"""

from __future__ import annotations

import asyncio
import random
import time
from collections.abc import AsyncIterator

from .base import EventType, LiveEvent

USERS = [
    "小明同学",
    "摸鱼选手",
    "夜猫子",
    "礼物暴击王",
    "路过的观众",
    "整蛊受害者",
    "气氛组组长",
    "沉默的铁粉",
]

CHATS = [
    "主播好！",
    "来了来了",
    "笑死我了哈哈哈",
    "整蛊！",
    "惩罚！",
    "冲冲冲",
    "666",
    "这个好好玩",
    "抽我抽我",
    "下次一定",
    "前方高能",
    "求播歌",
]

GIFTS = [
    # name, unit_value, icon
    ("小心心", 1, "/gifts/heart.svg"),
    ("玫瑰", 5, "/gifts/rose.svg"),
    ("抖音", 10, "/gifts/douyin.svg"),
    ("跑车", 1200, "/gifts/car.svg"),
    ("嘉年华", 3000, "/gifts/carnival.svg"),
]


class MockFetcher:
    """按间隔随机推送弹幕 / 礼物 / 进场。"""

    def __init__(self, room_id: str = "mock-room", interval: float = 1.2) -> None:
        self.room_id = room_id
        self.interval = interval
        self._running = False

    async def events(self) -> AsyncIterator[LiveEvent]:
        self._running = True
        yield LiveEvent(
            type=EventType.STATUS,
            user="system",
            content="mock_connected",
            room_id=self.room_id,
            ts=time.time(),
        )
        while self._running:
            await asyncio.sleep(self.interval * random.uniform(0.6, 1.4))
            yield self._random_event()

    def stop(self) -> None:
        self._running = False

    def _random_event(self) -> LiveEvent:
        roll = random.random()
        user = random.choice(USERS)
        now = time.time()

        if roll < 0.55:
            # 提高重复弹幕概率，方便测聚合
            content = random.choice(CHATS)
            if random.random() < 0.4:
                user = random.choice(USERS[:3])
                content = random.choice(CHATS[:4])
            return LiveEvent(
                type=EventType.CHAT,
                user=user,
                content=content,
                room_id=self.room_id,
                ts=now,
            )
        if roll < 0.75:
            gift_name, gift_value, gift_icon = random.choice(GIFTS)
            count = 1 if gift_value >= 100 else random.randint(1, 3)
            if random.random() < 0.35:
                user = random.choice(USERS[:3])
            return LiveEvent(
                type=EventType.GIFT,
                user=user,
                gift_name=gift_name,
                gift_count=count,
                gift_value=gift_value * count,
                gift_icon=gift_icon,
                content=f"送出 {gift_name} x{count}",
                room_id=self.room_id,
                ts=now,
            )
        if roll < 0.9:
            return LiveEvent(
                type=EventType.ENTER,
                user=user,
                content="来了",
                room_id=self.room_id,
                ts=now,
            )
        return LiveEvent(
            type=EventType.LIKE,
            user=user,
            content="点赞了",
            room_id=self.room_id,
            ts=now,
            extra={"count": random.randint(1, 20)},
        )
