"""弹幕事件基础类型。"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any


class EventType(str, Enum):
    CHAT = "chat"  # 弹幕
    GIFT = "gift"  # 礼物
    ENTER = "enter"  # 进场
    LIKE = "like"  # 点赞
    FOLLOW = "follow"  # 关注
    NOTICE = "notice"  # 系统恭喜：升级 / TOP / 粉丝团等
    STATUS = "status"  # 连接状态
    ROOM = "room"  # 房间统计（在线/点赞总数等）


@dataclass
class LiveEvent:
    type: EventType
    user: str
    content: str = ""
    gift_name: str = ""
    gift_count: int = 0
    gift_value: int = 0  # 抖币约等于价值，Mock 用整数
    gift_icon: str = ""  # 礼物图标 URL
    # 富文本片段：[{type:text|emoji|image, value:...}]
    content_parts: list = field(default_factory=list)
    room_id: str = ""
    ts: float = 0.0
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["type"] = self.type.value
        return data
