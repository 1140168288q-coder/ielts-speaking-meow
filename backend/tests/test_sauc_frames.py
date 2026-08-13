"""SAUC 二进制帧构造/解析的逐字节单元测试(对齐官方 SDK protocol/binary.go)。"""
import gzip
import json
import struct

import pytest

from app.services.volcengine_streaming_stt_service import (
    build_audio_frame,
    build_full_client_event_frame,
    build_full_client_frame,
    parse_server_frame,
)


def test_full_client_frame_layout():
    payload = json.dumps({"user": {}, "audio": {}}).encode()
    frame = build_full_client_frame(payload)
    assert frame[:4] == bytes([0x11, 0x10, 0x10, 0x00])
    assert struct.unpack(">I", frame[4:8])[0] == len(payload)
    assert frame[8:] == payload


def test_audio_frame_flags():
    payload = b"\x00\x00" * 1600
    normal = build_audio_frame(payload, is_last=False)
    assert normal[:4] == bytes([0x11, 0x20, 0x00, 0x00])
    last = build_audio_frame(payload, is_last=True)
    assert last[:4] == bytes([0x11, 0x22, 0x00, 0x00])  # flags=2:负序号最终帧
    assert struct.unpack(">I", last[4:8])[0] == len(payload)


def test_event_frame_layout():
    payload = b'{"event":2}'
    frame = build_full_client_event_frame(2, payload)
    assert frame[:4] == bytes([0x11, 0x14, 0x10, 0x00])  # FullClient + WITH_EVENT
    assert struct.unpack(">i", frame[4:8])[0] == 2
    assert struct.unpack(">I", frame[8:12])[0] == len(payload)
    assert frame[12:] == payload


def test_parse_server_frame_with_negative_sequence():
    body = json.dumps({"code": 1000, "result": {"text": "hi"}}).encode()
    header = bytes([0x11, 0x92, 0x10, 0x00])  # FullServer + flags=2
    frame = header + struct.pack(">i", -1) + struct.pack(">I", len(body)) + body
    parsed = parse_server_frame(frame)
    assert parsed["message_type"] == 0x9
    assert parsed["flags"] == 0x2
    assert parsed["sequence"] == -1
    assert json.loads(parsed["payload"])["result"]["text"] == "hi"


def test_parse_server_frame_without_sequence():
    body = json.dumps({"code": 1000}).encode()
    header = bytes([0x11, 0x90, 0x10, 0x00])  # FullServer + flags=0
    frame = header + struct.pack(">I", len(body)) + body
    parsed = parse_server_frame(frame)
    assert parsed["sequence"] is None
    assert parsed["error_code"] is None


def test_parse_server_frame_gzip_payload():
    body = gzip.compress(json.dumps({"code": 1000}).encode())
    header = bytes([0x11, 0x90, 0x11, 0x00])  # JSON + gzip
    frame = header + struct.pack(">I", len(body)) + body
    parsed = parse_server_frame(frame)
    assert json.loads(parsed["payload"])["code"] == 1000


def test_parse_error_frame():
    body = json.dumps({"message": "bad"}).encode()
    header = bytes([0x11, 0xF0, 0x10, 0x00])
    frame = header + struct.pack(">I", 45000151) + struct.pack(">I", len(body)) + body
    parsed = parse_server_frame(frame)
    assert parsed["message_type"] == 0xF
    assert parsed["error_code"] == 45000151


def test_parse_rejects_short_frame():
    with pytest.raises(ValueError):
        parse_server_frame(b"\x11\x90")
