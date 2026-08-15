# AGENTS.md

## Project

**Name:** 雅思口语喵  
**Version:** V1.5  
**Platform:** Android  
**Primary mode:** IELTS Speaking single-question practice

雅思口语喵是一款以真实语音练习为核心的 IELTS Speaking 训练软件。

V1.0 的核心训练闭环：

> **听题 → 第一次回答 → 录音/转写/分析 → 获得少量关键反馈 → 第二次回答 → 对比改进 → 保存可复用表达**

所有开发决策优先服务这条主链路。

---

## Product Principles

1. **Speaking first**  
   这是口语训练软件，不是文本改写工具。

2. **Training over generation**  
   AI 应帮助用户自己说得更好，不应替用户完成整段答案。

3. **Second attempt is core**  
   第一次和第二次回答之间的进步是 V1.0 的核心价值。

4. **Actionable feedback**  
   每次优先指出 2–3 个最重要的问题，不要一次给过多反馈。

5. **Speakable English**  
   优先自然、准确、容易说出口的表达，不追求无意义的高级词汇、复杂句或 idioms。

6. **Local-first**  
   题库、录音、训练记录和个人语料默认优先本地保存。

7. **Graceful degradation**  
   没有任何 AI API 时，基础训练仍必须可用。

8. **Keep V1.0 small**  
   不要擅自扩展到模拟考试、云同步或复杂发音评分。

---

## V1.0 Core Features

至少实现：

- IELTS Speaking Part 1 / 2 / 3 基础题库；
- 浏览和随机抽题；
- 题目 TTS 播报；
- 第一次和第二次录音；
- 录音回放；
- STT 转写；
- transcript 手动修正；
- 基础本地语音/流利度分析；
- 可选 Text AI 反馈；
- 可选 AI TTS；
- Android System TTS fallback；
- 两次回答对比；
- 保存个人可复用表达；
- 本地持久化。

核心流程不稳定时，不要优先开发高级功能。

---

# Speech

语音是一级能力。

## Question TTS

题目必须支持语音播报。

至少支持：

- 播放；
- 重播；
- 停止；
- 显示播放状态。

音频播放和录音必须互斥：

- TTS 播放时不能误录；
- 开始录音时停止 TTS；
- 录音中不要自动播放题目。

---

## TTS Providers

TTS 使用可替换 Provider。

至少保留：

```text
TTSProvider
├── Android System TTS   # default / fallback
└── AI TTS               # optional
```

AI TTS 可用于：

- examiner-style 题目播报；
- Natural Version；
- 保存表达的示范朗读。

如果 Provider 支持，可配置：

- voice；
- accent；
- rate；
- pitch；
- style / instruction。

不要假设所有 Provider 支持相同能力。

AI TTS 失败时自动 fallback 到 System TTS。

相同固定文本和相同 Voice 配置可缓存生成音频，避免重复调用 API。

---

## Recording

必须保存原始用户录音。

至少支持：

- start / stop；
- 录音状态；
- 时长；
- 本地保存；
- 第一次和第二次录音回放。

**不要因为 STT 成功就删除原始录音。**

外部服务失败时也不能丢失录音。

---

## STT

STT = Speech-to-Text capability。

底层可以是：

- 专用 STT 模型；
- 多模态 AI；
- 系统语音识别；
- 其他兼容服务。

不要把 STT 写死到某个供应商。

STT 应尽量忠实保留：

- filler words；
- repetition；
- self-correction；
- hesitation。

用户必须可以修改明显错误的 transcript。

STT 失败时：

- 保留录音；
- 可重试；
- 可手动输入。

**Transcript 不能作为 pronunciation ground truth。**

---

## Basic Speech Analysis

V1.0 只做简单、可解释的分析，例如：

- answer duration；
- approximate speech rate / WPM；
- filler words；
- long pauses；
- repeated words；
- simple hesitation indicators。

无法可靠判断时，不要输出高置信度结论。

V1.0 不要求高精度 pronunciation scoring。

可为未来预留：

```text
PronunciationProvider
```

但不要仅凭 transcript 生成“精确发音分”。

---

# AI

## Text AI

Text AI 用于：

- 找出 2–3 个关键问题；
- grammar / vocabulary / coherence feedback；
- 第二次回答提示；
- 两次回答对比；
- 提取个人语料。

不要默认生成完整高分范文。

如需要改写，优先：

- **Minimal Fix**
- **Natural Version**
- **Stretch Version**

程序依赖模型返回结果时，使用结构化输出并进行运行时校验。

---

## Cloud Backend（V1.2+）

Text AI、远程 STT、AI 语音全部由自建 Backend 托管第三方 API，客户端不直接
调用任何第三方服务：

- Backend 用 Python + FastAPI 实现，提供 `/health`、`/v1/stt`、`/v1/feedback`、
  `/v1/tts`、`/v1/organize`；
- DeepSeek（Text AI）、火山引擎流式语音识别（STT，WebSocket 直传，不需要公网
  音频地址）、火山引擎语音合成 2.0（TTS）保持三个独立 Service 与独立环境变量，
  不共用密钥；
- 第三方密钥只存在于 Backend 环境变量，不进入 APK、源码仓库或客户端配置；
- 普通用户不再填写任何 API Key 或访问口令；设置页展示云端连接状态、Backend
  地址配置与本机能力测试；
- 客户端保持 `LLMProvider` / `TTSProvider` / `RecordedAudioSTTProvider` 边界，
  实现为 `Backend*Provider`，以后更换 Provider 不需要大改；
- 云端不可用时回退：系统 TTS、手动转写、本地分析继续可用。
- Backend 不实现客户端访问口令鉴权；公网部署必须在反向代理、VPN 或网关层提供
  认证与访问控制。
- App 启动时拉取 `/health` 并缓存，三个 `Backend*Provider` 的配置状态由真实
  健康状态驱动；云端 STT 状态未知或不可用时保留本机实时转写作为兜底。
- `/health` 必须区分三个信号：密钥是否配置、Backend 是否可达、上游是否已
  真实验证（verified / unverified / failed 及最近调用时间）；设置页不得把
  “有密钥”显示成“已连接”。
- 正式构建（`VITE_LOCK_BACKEND_URL=true`）内置 Backend 地址且设置页
  只读，构建时缺少地址必须失败；默认强制 HTTPS，家庭 Backend 的私有
  局域网 HTTP 例外需显式开启 `-AllowLanHttp`；升级后清除旧设备保存的
  运行时地址。

---

## Provider Boundaries

至少保持以下边界：

```text
LLMProvider
TTSProvider
RecordedAudioSTTProvider
STTProvider             # 本地实时转写（降级路径）
PronunciationProvider   # future
LocalStorage
AudioStorage
BackendClient           # 客户端访问自建 Backend 的唯一入口
```

避免：

- React 页面直接调用模型 API（只允许经 BackendClient 调用自建 Backend）；
- UI 中硬编码模型名称；
- vendor-specific response 扩散到整个项目；
- 客户端持有任何第三方 API Key（密钥只在 Backend）。

具体目录、状态管理、数据库和组件结构由 Codex 根据仓库自行选择。

不要为了架构漂亮创建无实际用途的 abstraction。

---

# Local Offline Mode

没有 API 时仍应完成基本训练。

本地能力可以包括：

- 录音；
- 回放；
- System TTS；
- 题库；
- 时长；
- 语速；
- filler words；
- 停顿；
- 重复词；
- 少量高置信度规则；
- 本地记录；
- 个人语料。

不要在 V1.0 中用大量正则构建完整英语语法检查器。

---

# Personal Language Memory

用户可以保存：

- 自己认可的表达；
- 修正后的句子；
- 对应题目/topic；
- 来源练习；
- 创建时间。

重点是保存用户未来真正可能再次说出来的语言，而不是收藏大量完整范文。

---

# Android-first

V1.0 只要求 Android 正常交付。

如果仓库尚未确定技术栈，可优先考虑：

- React；
- TypeScript；
- Vite；
- Capacitor。

不要为了 V1.0 同时维护桌面端和 iOS。

具体实现由 Codex 根据当前代码选择最简单、可靠、可维护的方案。

---

# Privacy and Secrets

第三方 API Key（DeepSeek、火山引擎等）只允许保存在 Backend 环境变量中。

必须：

- 不写入 APK、源码仓库或客户端配置；
- 不提交 Git（仓库只保留 `.env.example` 占位文件）；
- 不进入测试 fixture；
- 不输出到 Backend 日志（日志过滤器强制脱敏）；
- 客户端不接触任何第三方密钥。

录音、transcript、训练记录和个人语料默认视为私有数据，保存在本机。

上传到 Backend 的录音仅用于本次转写，识别完成后即删除，不做持久化。

日志中不得包含 API key、Access Token、Authorization header 或其他 secrets。

---

# Failure Handling

以下都属于正常失败场景：

- 未配置 API；
- key 错误；
- endpoint 错误；
- model 不存在；
- timeout；
- network failure；
- rate limit；
- invalid response；
- microphone / permission failure。

失败时优先：

- retry；
- fallback；
- continue without AI；
- manual edit；
- local save。

任何外部服务失败都不得轻易导致：

- 原始录音丢失；
- transcript 丢失；
- 当前训练记录丢失；
- App 崩溃。

---

# Non-goals

V1.0 不主动实现：

- 完整 IELTS 模拟考试；
- AI 实时考官多轮对话；
- 官方级 IELTS 自动评分；
- 高精度或单词级 pronunciation scoring；
- 复杂声学图表；
- 云账号 / 云同步；
- 社交和排行榜；
- 完整 Anki / PDF 导出；
- 复杂学习日历；
- 完整间隔重复系统；
- 桌面端；
- iOS；
- 自建 AI 后端；
- 大型离线语言模型；
- 自训练语音模型。

---

# Engineering Harness

项目应提供等价于以下能力的统一命令：

- dev；
- lint；
- type check；
- tests；
- production build。

遵循仓库已有工具和 package manager。

完成有意义修改时，尽可能执行：

1. type check；
2. lint；
3. relevant tests；
4. build。

如果无法执行，在最终说明中明确原因。

AI / TTS / STT 自动化测试默认使用 fake provider 或 mock，不依赖真实付费 API。

至少验证：

- 无 Text AI 时仍可训练；
- 无 Voice AI 时 System TTS 可播题；
- Voice AI 失败可 fallback；
- STT 失败不会删除录音；
- AI 返回非法结构不会导致崩溃；
- 网络失败不会丢失训练记录；
- 本地数据重新打开 App 后仍存在。

---

# Acceptance Flow

V1.0 最重要的验收流程：

1. 打开 Android App；
2. 选择一道题；
3. 播放题目；
4. 第一次录音；
5. 回放录音；
6. 获得或修正 transcript；
7. 查看本地反馈；
8. 如配置 Text AI，查看 AI 反馈；
9. 通过 System TTS 或 Voice AI 听推荐表达；
10. 第二次录音；
11. 回放并比较两次回答；
12. 保存一个表达；
13. 关闭并重新打开 App；
14. 之前的练习、录音和保存内容仍然存在。

这条链路不可靠时，不要优先开发高级功能。

---

# Coding Agent Rules

处理本仓库任务时：

1. 先阅读本文件和现有代码。
2. 优先延续已有模式。
3. 一次修改解决一个明确问题。
4. 避免无关的大规模重构。
5. 不要擅自扩大 V1.0 scope。
6. 新依赖必须有明确价值。
7. 永远校验 AI 输出。
8. 永远为外部服务设计 failure path。
9. 不要把 STT 结果当作 pronunciation ground truth。
10. 不要让 Voice AI 成为唯一 TTS 实现。
11. 不要默认 Text AI 和 Voice AI 共用 credentials。
12. 多种实现都合理时，选择最简单、最可靠、最符合核心训练闭环的方案。
13. 修改完成后说明：
    - 做了什么；
    - 如何验证；
    - 已知限制。

---

# Decision Priority

发生取舍时按以下顺序：

1. 用户数据和 secrets 安全；
2. 核心训练流程可靠；
3. 录音和语音数据可靠；
4. Android 实际可用；
5. 学习价值；
6. 简单、可维护；
7. 可扩展性；
8. 功能数量。

---

# Success Criterion

V1.0 成功意味着：

> 用户能在 Android 手机上听题，完成两次真实口语回答，保留并回放录音，获得少量有用的语音与语言反馈，听参考表达，并保存值得再次使用的个人语料。

即使没有配置 Text AI 或 Voice AI：

- 题目仍能播报；
- 用户仍能录音和回放；
- 基础本地分析仍可用；
- 两次回答仍可完成；
- 数据仍能正常保存。
