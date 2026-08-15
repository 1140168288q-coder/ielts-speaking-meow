"""上游调用结果的进程内记录,供 /health 展示真实状态。

「有密钥」与「上游已验证」必须分开:只有真实调用(或显式验证探针)成功,
才显示 verified;失败则显示 failed 并附最近一次安全错误文案。
"""
from datetime import datetime, timezone


class LastCallRecord:
    def __init__(self) -> None:
        self._ok: bool | None = None
        self._checked_at: str | None = None
        self._latency_ms: int | None = None
        self._message: str | None = None
        self._result: str | None = None

    def record(
        self,
        *,
        ok: bool,
        message: str | None = None,
        latency_ms: int | None = None,
        result: str | None = None,
    ) -> None:
        """写入最近一次真实调用的结果。message/result 只保留简短安全摘要。"""
        self._ok = ok
        self._checked_at = datetime.now(timezone.utc).isoformat()
        self._latency_ms = latency_ms
        self._message = message[:200] if message else None
        self._result = result[:120] if result else None

    def snapshot(self) -> dict:
        """返回 /health 用的公开快照,绝不包含密钥。"""
        if self._ok is None:
            return {
                "status": "unverified",
                "checkedAt": None,
                "latencyMs": None,
                "lastError": None,
                "lastResult": None,
            }
        return {
            "status": "verified" if self._ok else "failed",
            "checkedAt": self._checked_at,
            "latencyMs": self._latency_ms,
            "lastError": self._message,
            "lastResult": self._result,
        }
