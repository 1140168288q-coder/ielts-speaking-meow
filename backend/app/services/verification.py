"""上游调用结果的进程内记录,供 /health 展示真实状态。

「有密钥」与「上游已验证」必须分开:只有真实调用(或显式验证探针)成功,
才显示 verified;失败则显示 failed 并附最近一次安全错误文案。
"""
from datetime import datetime, timezone
from typing import Literal


class LastCallRecord:
    def __init__(self) -> None:
        self._ok: bool | None = None
        self._checked_at: str | None = None
        self._latency_ms: int | None = None
        self._message: str | None = None
        self._result: str | None = None
        self._failure_stage: str | None = None
        self._finish_reason: str | None = None
        self._content_length: int | None = None
        self._usage: dict[str, int] | None = None
        self._field_path: str | None = None

    def record(
        self,
        *,
        ok: bool,
        message: str | None = None,
        latency_ms: int | None = None,
        result: str | None = None,
        failure_stage: str | None = None,
        finish_reason: str | None = None,
        content_length: int | None = None,
        usage: dict[str, int] | None = None,
        field_path: str | None = None,
    ) -> None:
        """写入一次真实调用的安全摘要,不保存请求正文。"""
        self._ok = ok
        self._checked_at = datetime.now(timezone.utc).isoformat()
        self._latency_ms = latency_ms
        self._message = message[:200] if message else None
        self._result = result[:120] if result else None
        self._failure_stage = failure_stage
        self._finish_reason = finish_reason
        self._content_length = content_length
        self._usage = usage
        self._field_path = field_path

    def snapshot(
        self,
        *,
        kind: Literal["verification", "request"] = "verification",
    ) -> dict:
        """返回 /health 用的公开快照,绝不包含密钥或请求正文。"""
        if self._ok is None:
            return {
                "status": "unverified" if kind == "verification" else "never",
                "checkedAt": None,
                "latencyMs": None,
                "lastError": None,
                "lastResult": None,
                "failureStage": None,
                "finishReason": None,
                "contentLength": None,
                "usage": None,
                "fieldPath": None,
            }
        return {
            "status": (
                ("verified" if kind == "verification" else "succeeded")
                if self._ok
                else "failed"
            ),
            "checkedAt": self._checked_at,
            "latencyMs": self._latency_ms,
            "lastError": self._message,
            "lastResult": self._result,
            "failureStage": self._failure_stage,
            "finishReason": self._finish_reason,
            "contentLength": self._content_length,
            "usage": self._usage,
            "fieldPath": self._field_path,
        }


class ProviderCallRecords:
    """把显式上游验证与普通业务请求分开保存。"""

    def __init__(self) -> None:
        self.verification = LastCallRecord()
        self.request = LastCallRecord()
