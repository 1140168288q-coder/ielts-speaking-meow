# 雅思口语喵 V1.0 开发计划

## 原则与边界

所有工作以两次真实开口的单题训练闭环为优先。V1.0 不做模拟考试、实时 AI 考官、官方分数、精确发音评分、云同步、社交、桌面端或 iOS。

## 阶段

### 1. 工程与离线核心（已完成）

- React + TypeScript + Vite + Capacitor Android 工程；
- 题库、两次录音、回放、可编辑 transcript；
- 本地语音指标、2–3 条反馈、两次对比；
- 原录音、session 与个人表达本地持久化；
- System TTS 与 TTS / 录音 / 回放互斥；
- 关键失败路径自动化测试。

验收门禁：type check、lint、测试、Web production build、Capacitor sync。

### 2. Android 真机硬化（下一步）

- 在 JDK 21 + Android SDK 环境构建 Debug APK；
- 真机验证麦克风权限、来电 / 后台中断、System TTS、录音回放；
- 验证 Android WebView 中 IndexedDB 与录音在进程重启后恢复；
- 必要时把 `AudioStorage` 从 IndexedDB 替换为 app-private Filesystem，接口不变；
- 增加 Activity 重建与持久化 smoke test。

完成标准：AGENTS.md Acceptance Flow 在无任何 API 的 Android 真机上完整通过。

### 3. 可选 AI Provider（核心稳定后）

- Text AI：独立 provider / endpoint / model / secure API key；
- Voice AI：独立 provider / endpoint / model / voice / secure API key；
- STT 保持第三个独立 capability；
- Text AI 仅返回 2–3 个问题、二次提示和有限改写，所有结果经 Zod 校验；
- Voice AI 失败自动回退 Android System TTS；
- 固定文本与 Voice 配置的 AI TTS 缓存。

完成标准：未配置、错误 key、超时、限流、网络失败和非法结构均不阻断练习、不丢本地数据。

### 4. V1.0 发布验收

- 全量 14 步验收流程；
- 关闭并重开 App 后两次录音、转写、比较与表达仍存在；
- secrets、Authorization、录音与 transcript 不进入普通日志；
- 完成 Android release build 与真机回归。
