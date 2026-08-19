# 雅思口语喵 Backend

自建 Backend，托管第三方 API（DeepSeek Text AI / 火山引擎 TTS）。
Android 客户端只调用本服务，**任何第三方密钥只存在于本服务的环境变量中**。

V1.7 起不再提供 STT 能力；客户端直接用手机系统键盘语音输入答案文本。
V1.8 的 `/v1/feedback` 额外接受本地 RAG/长期记忆生成的可选
`tutorContext` / `learnerContext`，Backend 仍不保存用户数据。

## 架构

```
Android 客户端
    │  POST /v1/feedback(Part + 题目 + 答案文本 + 可选作答时间) → DeepSeek
    │  POST /v1/tts(文本)                                       → 火山语音合成 2.0
    │  POST /v1/organize(导入材料)                              → DeepSeek(题目整理)
    ▼
FastAPI Backend(密钥在环境变量,日志脱敏)
```

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 存活 + DeepSeek / TTS 详情:密钥是否配置、模型 / 音色、最近一次真实调用的验证状态(verified / unverified / failed + 时间),不含密钥 |
| POST | `/health/verify` | 真实小规模验证:DeepSeek 一次 32 token 的小规模补全(推理模型需预留思考 token)、TTS 合成一句 "Hello." |
| POST | `/v1/feedback` | JSON `{part, question, answer, answerDurationSeconds?, tutorContext?, learnerContext?}` → V1.7 文本分析结构(`summary` / `strengths` / `problems` / `grammarSuggestions` / `vocabularySuggestions` / `improvedAnswer` / 恰好 3 个 `referenceAnswers`) |
| POST | `/v1/tts` | JSON `{text, language?, rate?, pitch?}` → `audio/mpeg` 二进制;rate/pitch 映射火山 speed_ratio / pitch_ratio(0.5–2.0) |
| POST | `/v1/organize` | JSON `{fileName, extractedText}` → `{questions: [...]}` |

统一错误格式：`{"error": {"code": "...", "message": "..."}}`。
错误码：`not-configured`(503)/ `provider-error`(502)/ `upstream-timeout`(504)/
`invalid-request`(400)/ `rate-limited`(429)。

## DeepSeek 反馈约束

- 角色：友好的 IELTS Speaking Tutor；
- 只分析答案文本：语法、词汇、连贯性、表达自然度、是否切题、内容展开；
- 优先指出最重要的问题，不过度纠错；
- 修改表达时保持用户原本水平和表达习惯，不突然拔高到难以模仿的高级英语；
- 每个答案返回恰好 3 个参考回答：简单自然版 / 自然提升版 / 另一种表达版，
  都必须是真实口语，不是作文或背诵范文；
- 不评价 Pronunciation、语速、停顿、语调；不给出 IELTS Band 分数或水平评分。

## 安全基线

- 日志过滤器屏蔽第三方 API Key 与供应商凭证；
- 所有上游调用带超时；
- 内存滑动窗口限流(默认关闭,`RATE_LIMIT_ENABLED` 开启)——预留接口。

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

Windows 下也可以直接**双击 `start.bat`** 启动(监听 0.0.0.0，供同一 WiFi 的手机
访问；首次启动防火墙弹窗请点「允许访问」)。

测试：`.venv/Scripts/python -m pytest`（DeepSeek/TTS 用 MockTransport，
不需要真实密钥）。

## 部署到服务器

1. 服务器安装 Python 3.12，拷贝本目录；
2. `pip install -r requirements.lock.txt`，创建 `.env` 并填入密钥；
3. 运行 `uvicorn app.main:app --host 0.0.0.0 --port 8000`(或配 systemd/宝塔面板常驻)；
4. 客户端打包时把 `VITE_BACKEND_URL` 设为服务器地址。

正式对外发布建议给服务器配 HTTPS 域名(如 Caddy 反向代理自动签发证书)；
个人自用可通过私有局域网 IP + HTTP 访问；客户端拒绝公网 HTTP 地址。

## TTS 说明

- 默认音色 `zh_female_vv_uranus_bigtts`(uranus 系列基础音色,实测稳定)；
- 音色需在控制台开通，未开通会返回 `55000000`；
- 为 IELTS 英文播报开通英语音色后，推荐切换 `en_female_anna_mars_bigtts`
  (英语女声 Anna)或 `en_male_jason_conversation_wvae_bigtts`(英语男声)；
- 音色配置只写在 `.env`，App 不接触任何密钥。
