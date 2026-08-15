# 雅思口语喵 Backend

自建 Backend,托管第三方 API(DeepSeek Text AI / 火山引擎 STT / 火山引擎 TTS)。
Android 客户端只调用本服务,**任何第三方密钥只存在于本服务的环境变量中**。

## 架构

```
Android 客户端
    │  POST /v1/stt(multipart WAV)          → 火山 流式语音识别(SAUC bigmodel,
    │                                          WebSocket 直传,无需公网地址)
    │  POST /v1/feedback(转写+题目)          → DeepSeek chat/completions
    │  POST /v1/tts(文本)                    → 火山 语音合成 2.0(seed-tts-2.0,单向流式)
    │  POST /v1/organize(导入材料)           → DeepSeek(题目整理)
    ▼
FastAPI Backend(密钥在环境变量,日志脱敏)
```

STT 使用「流式语音识别」而非「录音文件识别」:流式把音频分帧直接发给火山,
**不需要公网可拉取的音频 URL**,后端跑在局域网内即可完整工作,部署到服务器时
也不需要域名/回调配置。协议按官方文档与官方 SDK 逐字节实现(帧格式、最终帧
标志、响应解析)。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 存活 + 各供应商详情:密钥是否配置、模型 / 资源 ID / 音色、最近一次真实调用的验证状态(verified / unverified / failed + 时间),不含密钥 |
| POST | `/health/verify` | 真实小规模验证:DeepSeek 一次 32 token 的小规模补全(推理模型需预留思考 token)、TTS 合成一句 "Hello.";STT 需要真实音频,只返回最近一次转写结果 |
| POST | `/v1/stt` | multipart 字段 `file`(16kHz/16bit 单声道 WAV)+ 可选 `language`;返回 `{"text": ...}` |
| POST | `/v1/feedback` | JSON `{kind: "first-attempt"\|"comparison", question, transcript, ...}` → 结构化反馈 |
| POST | `/v1/tts` | JSON `{text, language?, rate?, pitch?}` → `audio/mpeg` 二进制;rate/pitch 映射火山 speed_ratio / pitch_ratio(0.5–2.0) |
| POST | `/v1/organize` | JSON `{fileName, extractedText}` → `{questions: [...]}` |

统一错误格式:`{"error": {"code": "...", "message": "..."}}`。
错误码:`not-configured`(503)/ `provider-error`(502)/ `upstream-timeout`(504)/
`invalid-request`(400)/ `payload-too-large`(413)/ `unsupported-media`(415)/
`rate-limited`(429)。

## 安全基线(第一版)

- 上传大小限制(`MAX_UPLOAD_MB`,默认 25MB)、WAV 时长限制(`MAX_STT_DURATION_SECONDS`,默认 300 秒)
- 音频只接受 WAV；应用代码不创建持久文件。multipart 解析器可能使用由框架
  管理的短期 spooled 临时文件，请为生产环境配置受控临时目录与系统级清理策略
- 所有上游调用带超时(流式会话 `STT_STREAM_TIMEOUT_SECONDS`,默认 150 秒);
  日志过滤器屏蔽第三方 API Key 与供应商凭证
- 内存滑动窗口限流(默认关闭,`RATE_LIMIT_ENABLED` 开启)——预留接口

Backend 不提供客户端访问口令鉴权。仅限家庭局域网使用；如部署到公网，请在
反向代理、VPN 或网关层配置认证与访问控制。

## 本地运行

```bash
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements.lock.txt # 已验证的可复现版本
cp .env.example .env                            # 填入真实密钥(不要提交 .env)
.venv/Scripts/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Windows 下也可以直接**双击 `start.bat`** 启动(监听 0.0.0.0,供同一 WiFi 的手机访问;
首次启动防火墙弹窗请点「允许访问」)。

测试:`.venv/Scripts/python -m pytest`(41 个用例;DeepSeek/TTS 用 MockTransport,
流式 STT 用本地假 WebSocket 服务器,不需要真实密钥)。

## 部署到服务器

流式 STT 没有公网回调,部署非常简单:

1. 服务器安装 Python 3.12,拷贝本目录;
2. `pip install -r requirements.lock.txt`,创建 `.env` 并填入密钥;
3. 运行 `uvicorn app.main:app --host 0.0.0.0 --port 8000`(或配 systemd/宝塔面板常驻);
4. 客户端打包时把 `VITE_BACKEND_URL` 设为服务器地址。

正式对外发布建议给服务器配 HTTPS 域名(如 Caddy 反向代理自动签发证书);
个人自用可通过私有局域网 IP + HTTP 访问；客户端拒绝公网 HTTP 地址。

## 重要说明

1. **流式 STT 鉴权**只支持新版控制台 API Key(`X-Api-Key`)。资源 ID 与账号开通
   情况有关:默认使用 2.0 `volc.seedasr.sauc.duration`;若账号未开通 2.0(返回
   403 "resource not granted"),改用 1.0 `volc.bigasr.sauc.duration`(见
   `.env.example` 注释)。
2. **录音格式**:客户端录制为 webm,上传前在手机端转成 16kHz/16bit 单声道 WAV;
   直接调 `/v1/stt` 请传同规格 WAV。
3. 转写请求的 `enable_ddc`(语义顺滑)保持关闭,以忠实保留 filler/重复/自我修正
   (产品要求);`enable_itn`/`enable_punc` 开启。
4. **TTS 音色**:默认 `zh_female_vv_uranus_bigtts`(uranus 系列基础音色,实测
   稳定)。音色需在控制台开通,未开通会返回 `55000000`;若为 IELTS 英文播报
   开通了英语音色,推荐切换 `en_female_anna_mars_bigtts`(英语女声 Anna)或
   `en_male_jason_conversation_wvae_bigtts`(英语男声)。完整列表见官方
   [音色列表](https://docs.volcengine.com/docs/6561/1257544)。
5. 账号/会员/配额等系统第一版不做,限流已预留接口。
