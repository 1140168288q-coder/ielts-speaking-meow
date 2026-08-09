# Android V1.1 验收记录

日期：2026-08-10

## 交付物

- APK：`artifacts/ielts-speaking-meow-v1.1-debug.apk`
- applicationId：`com.ieltsspeakingmeow.app`
- versionName / versionCode：`1.1.0` / `2`
- minSdk / targetSdk / compileSdk：`24` / `36` / `36`
- 大小：48,446,023 bytes
- SHA-256：`6739764b07221b797c6d1cc87a2daa76b204e4e44376d695d45188f1deae4c88`
- 签名：Android Debug RSA 2048，APK Signature Scheme v2 验证通过

## 自动门禁

- TypeScript type check：通过；
- ESLint：通过，0 warning；
- Vitest：29 个测试文件、184 项测试全部通过；
- Vite production build：通过；
- production dependencies audit：0 vulnerability；
- Capacitor Android sync：通过；
- Android `assembleDebug` 与 JVM unit test：通过；
- Android Lint：0 error、15 个模板 / 资源类 warning；
- API 36 `connectedDebugAndroidTest`：2/2 通过；
- 320 × 800 与 860 × 900 浏览器 axe 扫描：0 violation。

## V1.0 覆盖升级

1. 在 V1.0 中完成两次真实 WebView 录音、两份手工转写并保存一个表达；
2. 升级前 IndexedDB v1 含 1 条 session、1 条 expression、2 个 audio Blob；
3. 使用同一 debug 签名执行 `adb install -r` 安装 V1.1；
4. `firstInstallTime` 保持不变，versionCode 从 1 升至 2；
5. IndexedDB 增量迁移到 v2 的 8 个 store；
6. 旧 session / expression 数量不变，两段录音 ID、类型及 35,384 / 216,227 bytes
   大小逐字节保持；
7. 升级后训练记录、转写、表达均可见，两段录音可以回放。

## V1.1 新能力实测

- Android bundled ML Kit OCR 能从本机生成的 PNG 准确识别 Part、Topic 和英文题目；
- PNG 经完整 UI 进入“本机 OCR → 候选题预览 → 人工确认 → 原文件与题目原子保存”；
- force-stop 冷启动后，导入题和 51,095-byte 原 PNG 仍存在；
- SecureSecrets 原生插件完成随机测试密钥 set / get / remove 往返；
- SharedPreferences 仅出现 `v1:` 版本化密文，不出现明文前缀；
- 设置页只配置 Text AI 后，IndexedDB 只有 `text-ai` 非敏感配置且无 `apiKey`
  字段，STT 与 Voice AI 保持未配置；测试配置随后已清理；
- System TTS 正常进入播放状态；播放中开始录音会先停止 TTS，录音中播放按钮锁定；
- V1.1 中新的 MediaRecorder 录音可保存，外部转写不可用时仍保留手工路径；
- 抽查 logcat 未发现 Authorization、测试密钥前缀、个人表达或导入题目文字。

## 已知边界

- 这是便于侧载与后续调试的 Debug APK，不是应用商店 Release 包；
- 本轮运行验收使用 Android 16 / API 36 x86_64 模拟器，没有可连接的实体手机；
- 没有使用真实付费 API Key。三套 Provider 的成功、401、404、429、网络失败、
  非法结构、缓存和 fallback 由 fake transport 自动化覆盖；具体服务商仍需用用户自己的
  endpoint / model / key 做一次连接验证；
- Word 支持现代 `.docx`；旧 `.doc` 需先另存为 `.docx`；
- Android Lint 的 15 个 warning 是 Gradle 小版本、未用模板资源、启动图 / 图标与
  `ExifInterface` 建议项，没有 error 或已知数据安全阻断。

