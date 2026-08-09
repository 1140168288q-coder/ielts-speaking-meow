# 雅思口语喵

Android-first 的 IELTS Speaking 单题练习应用。V1.0 围绕一条闭环开发：

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

Android 16 / API 36 模拟器验收已经完成：System TTS、两次真实 WebView
录音、原始录音回放、STT 失败后的手动转写、本地分析、两次对比、保存表达、
进程重启恢复和 APK 覆盖安装恢复均已走通。设备端配置测试为 2/2 通过。

没有 Text AI、Voice AI 或可用 STT 时，录音、回放、手动转写、本地分析、第二次回答、对比与保存仍可完成。

## 技术方案

- React 19 + TypeScript strict + Vite；
- Capacitor 8，仅生成 Android 平台；
- Zod 校验题库、持久化领域对象和 AI 结构化结果；
- React 本地状态 + application service，不引入额外状态框架；
- Vitest + Testing Library + fake IndexedDB。

核心端口位于 `src/ports`。React 页面不直接调用模型服务；敏感凭据只能通过 `SecureSecretStorage` 边界接入，不能进入 IndexedDB 或日志。

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
artifacts/ielts-speaking-meow-v1.0-debug.apk
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
adb install -r artifacts/ielts-speaking-meow-v1.0-debug.apk
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
  infrastructure/    浏览器/Android 语音、AI 校验、IndexedDB
  ports/             LLM、TTS、STT、录音、存储与安全凭据边界
android/              Capacitor Android 工程与本地 System TTS 插件
docs/                 可执行开发计划
```

项目最高规范见 `AGENTS.md`。
