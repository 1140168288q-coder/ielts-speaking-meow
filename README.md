# 雅思口语喵

Android-first 的 IELTS Speaking 单题练习应用。V1.2 继续围绕同一条闭环开发：

> 听题 → 第一次回答 → 录音 / 转写 / 本地分析 → 少量关键反馈 → 第二次回答 → 对比 → 保存表达

## 当前里程碑

首个可运行里程碑已经完成：

- Part 1 / 2 / 3 基础题库（各 6 题）、浏览与随机抽题；
- Web System TTS 与 Android 原生 System TTS；
- 两次录音、回放、实时 STT 可用时转写、手动修正；
- 时长、近似 WPM、filler、相邻重复词等可解释本地分析；
- 最多 3 条反馈、二次回答目标与两次指标对比；
- IndexedDB 本地保存训练记录、原始录音和个人表达；
- Text AI / Voice AI / STT / 存储的独立边界；
- Android Capacitor 工程、麦克风权限和私有数据备份排除规则。

V1.1 新增：

- TXT、MD、DOCX、PDF、JPG、PNG 本地材料导入，所有候选题先人工确认；
- PDF 文本层提取，以及扫描页、JPG、PNG 的 Android 本地离线 OCR；
- 导入源文件、提取文字和题目在同一 IndexedDB 事务中保存；
- Text AI、独立文件 STT、Voice AI 三套 OpenAI-compatible 配置；
- 三套 API Key 使用 Android Keystore 加密存储，互不复用；
- Voice AI 失败自动回退系统 TTS；远程 STT 始终在原录音本地保存后调用。

Android 16 / API 36 模拟器验收已经完成：除原有两次回答闭环外，V1.1 已实走
本机图片 OCR、导入确认与重启恢复、Android Keystore 密钥往返，以及从 V1.0
覆盖升级后保留两段录音、训练记录和表达。详见 `docs/android-acceptance-v1.1.md`。

V1.2 新增（云端 Backend 化）：

- 新增自建 Backend（Python + FastAPI，见 `backend/`），Android 客户端只调用自己的 Backend；
- Text AI → DeepSeek，STT → 火山引擎「流式语音识别」（WebSocket 直传，无需公网地址，本地即可全链路），TTS → 火山引擎「语音合成 2.0」；
- 第三方密钥只保存在 Backend 环境变量（`backend/.env.example` 提供占位清单），不进入 APK、源码仓库或客户端配置；
- 客户端移除普通用户的第三方 API Key 配置界面，设置页改为云端连接状态与本机能力测试；
- 录音上传前在本机转为 16kHz WAV（火山流式 STT 要求 PCM16）；云端转写与 AI 语音失败时自动回退手动转写 / 系统 TTS；
- 后端跑在家庭电脑上即可（手机与电脑同一 WiFi），部署服务器为可选进阶项；
- `LLMProvider` / `RecordedAudioSTTProvider` / `TTSProvider` 端口保持不变，实现替换为 `Backend*Provider`。

没有云端或云端不可用时，录音、回放、手动转写、本地分析、第二次回答、对比与保存仍可完成。

## 技术方案

- React 19 + TypeScript strict + Vite；
- Capacitor 8，仅生成 Android 平台；
- Zod 校验题库、持久化领域对象和 AI 结构化结果；
- React 本地状态 + application service，不引入额外状态框架；
- Vitest + Testing Library + fake IndexedDB；
- Backend：FastAPI + httpx + pydantic，pytest 单测（mock 上游），部署见 `backend/README.md`。

核心端口位于 `src/ports`。React 页面不直接调用模型服务；客户端访问 AI 能力
只能通过 `BackendClient` 调用自建 Backend，任何第三方密钥不得出现在客户端。

## 开发命令

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npm run android:sync
```

当前开发机已安装隔离的 JDK 21、Android SDK 36、Platform Tools 与 API 36
模拟器。以下命令会自动使用这些本地工具，依次运行代码规范、测试、生产构建、
Capacitor 同步、Android 单元测试、Android Lint 和 Debug 打包：

```bash
npm run android:build
```

APK 输出到：

```text
artifacts/ielts-speaking-meow-v1.2-debug.apk
```

连接 Android 手机或启动模拟器后，可以额外运行设备端测试：

```bash
npm run android:test:device
```

Android Studio 可以直接打开 `android/`。

## 安装到手机

这是便于当前开发和后续能力接入的 Debug APK。把 APK 复制或发送到 Android
手机，允许对应文件应用“安装未知应用”后即可安装。通过 USB 调试也可执行：

```bash
adb install -r artifacts/ielts-speaking-meow-v1.2-debug.apk
```

同一开发机生成且签名一致时，`-r` 会保留本地练习和录音。卸载 App 会删除其
本地私有数据，这是 `allowBackup=false` 的预期行为。正式分发前仍需配置独立的
Release 签名；不要把 Debug APK 当作应用商店发布包。

模拟器中的 Web Speech STT 可能因系统服务或网络不可用而失败。V1.0 已按产品
规范保留原录音并提供手动转写；最终仍建议在一台实体 Android 手机上复测真实
麦克风、扬声器音量和系统 TTS 音色。

## 目录

```text
src/
  application/       核心训练写入顺序与流程服务
  data/              静态题库
  domain/            领域模型、本地分析、两次对比
  infrastructure/    浏览器/Android 语音、Backend 客户端、IndexedDB
  ports/             LLM、TTS、STT、录音与存储边界
android/              Capacitor Android 工程与本地 System TTS / OCR 插件
backend/              自建 FastAPI Backend(托管 DeepSeek / 火山 STT / 火山 TTS)
docs/                 可执行开发计划
```

项目最高规范见 `AGENTS.md`。
