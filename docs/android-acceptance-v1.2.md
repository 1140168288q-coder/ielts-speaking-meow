# Android V1.2 Release 验收记录

日期：2026-08-14

## 交付物

| 产物 | 路径 | 大小 | SHA-256 |
|---|---|---|---|
| **Release APK（正式签名）** | `artifacts/ielts-speaking-meow-v1.2-release.apk` | 47,172,745 bytes | `c05b0c8a5d6f6212f9baeb156fa9cc96886735fe19c6622ea5fa8fe423ddc8ea` |
| Debug APK（开发调试） | `artifacts/ielts-speaking-meow-v1.2-debug.apk` | 48,718,480 bytes | `c75bf027675d2af49513a6aecfe0a2a68ce1981fd630e55693e1146db221ffc0` |

- applicationId：`com.ieltsspeakingmeow.app`
- versionName / versionCode：`1.2.0` / `3`
- minSdk / targetSdk / compileSdk：`24` / `36` / `36`
- Release 签名：RSA 2048，证书 CN=`IELTS Speaking Meow`，
  证书 SHA-256：`dce1710195f3d24533ec7008ae0459587746423577ecd328d77feeb58cb5f260`
  （APK Signature Scheme v2 验证通过；密钥库 `artifacts/ielts-speaking-meow-release.keystore`
  与 `android/keystore.properties` 均被 git 忽略，需妥善备份）
- Debug 签名：Android Debug RSA 2048（开发调试用）

## 自动门禁

- TypeScript type check：通过；
- ESLint：通过，0 warning；
- Vitest：29 个测试文件、180 项测试全部通过；
- Vite production build：通过；
- Capacitor Android sync：通过；
- Android `assembleDebug` / `assembleRelease` / JVM unit test / Lint：全部通过，0 error；
- API 36 `connectedDebugAndroidTest`：2/2 通过（模拟器实测）；
- Backend pytest：41 项全部通过（DeepSeek/TTS MockTransport、流式 STT 假 WebSocket 服务器）。

## 真机与模拟器实测（2026-08-14）

### 云端（真实凭证）

- `/health` → 200，三供应商均已配置；
- `/v1/tts` 真实合成 → 200，30,957 bytes mp3（`zh_female_vv_uranus_bigtts`）；
- `/v1/stt` 真实转写 → `{"text":"Do you like reading?"}`（STT 2.0 资源 ID）；
- `/v1/feedback` 真实 DeepSeek 反馈 → 结构完整、质量符合产品要求。
- 音色实测结论：本账号仅 uranus 系列音色可用；`en_female_anna_mars_bigtts`
  等英语音色返回 55000000，需在控制台开通后切换（见 `.env.example` 注释）。

### Web 版（agent-browser 走查）

- 题库浏览 / 分页 tab / 进入练习 / 返回导航正常；
- 设置页填写地址 → 保存 → 真实云端连接正常，三供应商状态与检查时间正确显示；
- 题目播报经云端 TTS 真实合成并播放；
- 无麦克风环境 → 录音启动给出"麦克风权限未开启"可操作提示（降级路径正确）；
- TXT 导入 → 本机提取 3 道候选题 → 人工确认 → 导入成功 → 刷新后仍在题库；

### Android 模拟器（API 36 + 虚拟麦克风 + CDP 驱动）

- 覆盖安装：V1.0/V1.1 的会话、录音、表达全部保留（IndexedDB 跨版本兼容）；
- 设置页真实云端连接成功（10.0.2.2 → 主机 Backend）；
- 完整闭环：选题 → 云端 TTS 播题 → 第一次真实录音（16 秒）→ 云端 STT 调用
  （虚拟麦克风静音 → 优雅降级：原录音保留、可重试/手输）→ 手动转写 → 本地
  分析（66 WPM、语速反馈）→ 真实 DeepSeek 反馈（2 条可执行建议 + Natural
  Version）→ 第二次真实录音（7 秒）→ 对比（WPM 66→176 +110）→ 保存表达
  （云端朗读示范）→ 记录/表达库正确展示；
- force-stop 后冷启动：会话、录音、表达、Backend 配置与云端状态全部恢复；
- Release APK 安装启动正常，无崩溃（证书与安装包一致）。

### 用户真机

- 用户已实测：手机 App 功能总体正常。

## 安装与升级说明

- **首次使用**：直接安装 `ielts-speaking-meow-v1.2-release.apk`，
  在「设置 → 云端服务」填入电脑局域网地址。
- **从旧 Debug 包升级**：Debug 与 Release 签名不同，Android 不允许覆盖安装；
  需先卸载旧包（本地练习数据会随卸载清除），再安装 Release 包。
  之后所有更新都用同一 Release 签名，`adb install -r` 或直接覆盖安装即可保留数据。
- 每次更新只需执行：`npm run android:release`（自动跑 lint/测试/构建/打包，
  输出到 `artifacts/`）。

## 已知边界

- 网络策略允许明文 HTTP（家庭局域网自用）；后端部署公网请使用 HTTPS；
- 英语音色需在火山控制台开通后于 `.env` 切换 `VOLC_TTS_SPEAKER`；
- Release 密钥库与 `keystore.properties` 不在 git 内：**请备份
  `artifacts/ielts-speaking-meow-release.keystore` 与口令**，丢失后无法再发布
  可覆盖安装的更新；
- 卸载 App 会删除本地私有训练数据；同签名覆盖安装保留数据。
