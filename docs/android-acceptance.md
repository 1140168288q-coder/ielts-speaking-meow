# Android V1.0 验收记录

日期：2026-08-09

## 交付物

- APK：`artifacts/ielts-speaking-meow-v1.0-debug.apk`
- applicationId：`com.ieltsspeakingmeow.app`
- versionName / versionCode：`1.0` / `1`
- minSdk / targetSdk / compileSdk：`24` / `36` / `36`
- SHA-256：`888b93c805196eef746589be7b0847ecc5d33c3e94e8a444f0a91b3b07b25961`
- 签名：Android Debug RSA 2048，APK Signature Scheme v2 验证通过

## Android 环境

- Temurin JDK 21.0.12；
- Android SDK Platform 36、Build Tools 36.0.0、Platform Tools 37.0.1；
- Android Emulator 37.1.11，WHPX 硬件加速可用；
- Pixel 7 类 API 36 x86_64 AVD；
- Android 16，1080 × 2400，420 dpi；
- Android System WebView 133.0.6943.137；
- Google System TTS，`en-US` 题目与表达播报成功。

## 自动门禁

- TypeScript type check：通过；
- ESLint：通过，0 warning；
- Vitest：13 个测试文件、64 项测试全部通过；
- Vite production build：通过；
- Capacitor Android sync：通过；
- Android `assembleDebug`：通过；
- Android JVM unit test：通过；
- Android Lint：通过，0 error；
- API 36 `connectedDebugAndroidTest`：2/2 通过。

## 核心链路实测

1. 冷启动成功，无崩溃；
2. Part 1 题目进入练习并由 Android System TTS 播报；
3. TTS 播放中开始录音会先停止播报；录音中播报按钮禁用；
4. 麦克风拒绝后不创建空录音，界面提供系统设置恢复路径；
5. 录音中点品牌、返回按钮或 Android 系统 Back 均不会丢弃当前录音；
6. 第一次和第二次 MediaRecorder 录音均写入 IndexedDB Blob 并可回放；
7. 模拟器 Web Speech STT 返回 network failure 时，两段原录音均保留，可手动输入转写；
8. 手动修正转写后，本地 WPM、filler 和相邻重复词会重新分析；
9. 第二次回答开始前计时正确归零；
10. 任一转写为空时，对比指标显示不可用，不再给出虚假“改善”；
11. 两份转写完整时显示方向性对比，不生成 IELTS 官方分数；
12. 表达可由 System TTS 播报并保存；
13. force-stop 后冷启动，训练记录、两份录音、转写和表达均恢复；
14. `adb install -r` 覆盖安装后，首次安装时间不变，本地训练数据与录音仍存在；
15. 竖屏、横屏、状态栏、手势导航区和固定底栏均未发现遮挡；
16. Capacitor 日志已关闭，题目和私人表达不会进入普通 logcat。

## 已知边界

- 当前是 Debug APK，适合侧载调试，不是应用商店 Release 包；正式分发需要单独的安全签名；
- 本轮 Android 运行验收使用 API 36 模拟器，没有连接实体 USB 手机；真实麦克风音质、扬声器音量、厂商 WebView 差异和系统 TTS 音色仍需在目标手机上复测；
- 模拟器 Web Speech STT 不可用属于已覆盖的正常降级路径，不能据此证明所有真机都支持系统在线转写；
- 卸载 App 会删除本地私有训练数据；覆盖安装会保留数据。
