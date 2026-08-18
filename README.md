# 雅思口语喵

Android-first 的 IELTS Speaking 单题练习应用。V1.5（release）围绕同一条闭环：

> 听题 → 第一次回答 → 一行问题 + 一行建议 → 三个建议版本任选 → 跟读复盘发音 → 第二次回答 → 修改转写 → 收录个人语料

## 当前里程碑

首个可运行里程碑已经完成：

- Part 1 / 2 / 3 基础题库（各 6 题）、浏览与随机抽题；
- Web System TTS 与 Android 原生 System TTS；
- 两次录音、回放、实时 STT 可用时转写、手动修正；
- 时长、近似 WPM、filler、相邻重复词等可解释本地分析；
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
- Text AI → DeepSeek，STT → 火山引擎「流式语音识别 2.0」（WebSocket 直传，无需公网地址，本地即可全链路），TTS → 火山引擎「语音合成 2.0」（默认 `zh_female_vv_uranus_bigtts`；控制台开通英语音色后可切换 `en_female_anna_mars_bigtts` 做考官式英文播报）；
- 第三方密钥只保存在 Backend 环境变量（`backend/.env.example` 提供占位清单），不进入 APK、源码仓库或客户端配置；
- 客户端移除普通用户的第三方 API Key 配置界面；设置页改为云端状态与本机能力测试；
- 录音上传前在本机转为 16kHz WAV（火山流式 STT 要求 PCM16）；云端转写与 AI 语音失败时自动回退手动转写 / 系统 TTS；
- Backend 地址可在 App「设置 → 云端服务」运行时配置；客户端不保存或发送 Backend 访问口令；
- App 启动时自动拉取 `/health` 并缓存，三个 Backend provider 的配置状态由真实健康状态驱动：后端未配置 STT 时恢复本机实时转写，状态未知时云端与本地转写互为兜底；
- 后端跑在家庭电脑上即可（手机与电脑同一 WiFi），部署服务器为可选进阶项；
- `LLMProvider` / `RecordedAudioSTTProvider` / `TTSProvider` 端口保持不变，实现替换为 `Backend*Provider`。

没有云端或云端不可用时，录音、回放、手动转写、本地分析、第二次回答、对比与保存仍可完成。

V1.5 新增（可靠性与状态透明化）：

- 正式构建内置并锁定 HTTPS Backend 地址（`VITE_LOCK_BACKEND_URL=true`），设置页只读；缺少或非 HTTPS 地址时构建直接失败；升级后自动清除旧设备保存的运行时地址；
- `/health` 返回每个供应商的模型、资源 ID、音色与最近一次真实调用结果（verified / unverified / failed + 时间），并提供 `/health/verify` 做 DeepSeek / TTS 的真实小规模验证；设置页不再把“有密钥”显示成“已连接”；
- 云端 TTS 状态未知（Backend 不可达）时立即使用系统 TTS，云端失败后 60 秒熔断；「测试系统朗读」直连 Android 系统 TTS，并检测引擎与英语语音包，缺失时明确提示而不是无声；
- `/v1/tts` 支持 language / rate / pitch（映射火山 speed_ratio / pitch_ratio）；AI TTS 缓存键扩展为 text + provider + model + speaker + language + rate + pitch + voiceConfigVersion，换音色不再命中旧音频，升级时清理一次旧缓存；
- 移除“进步”独立导航与 Dashboard（练习记录与个人语料全部保留，首页推荐与轻复习继续可用）；
- 导入预览中“用 DeepSeek 智能整理”常驻可选，AI 失败或返回空结果时本地候选题不丢失。

V1.6 新增（练习流程重构）：

- 进入答题界面自动播放题目，可随时重播/停止；
- 第一次回答后只显示一行「问题」+ 一行「建议」（中文）：AI 已连接用 AI 结果，否则自动转用本地规则摘要；
- AI 给出 3 个风格/难度略有差异的回答版本（正常语速约 15–20 秒，过短补充、过长简化），每个可试听，选定后跟读；
- 跟读录音经 STT 转写后与所选版本逐词比对，复盘指出「可能发音不准的词」（语音识别比对，仅供参考），期间可随时重新试听示范或回放自己的跟读；
- 第二次回答前按住按钮可查看所选版本的关键内容/句式提示，录音时禁止查看；
- 第二次回答后显示转写、允许小改，提交即收录个人语料；个人语料每条可试听；
- 原「两次对比」界面已移除；右上角常驻显示 API连接成功 / API未连接；
- 练习页顶部三行文字可自行编辑（可留白），默认「口语目标分：6.0 / 旅途的意义在于旅途本身 / 请输入文本」，保存在本机；
- 网页开发版默认 Backend 地址为 `http://127.0.0.1:8000`（安卓模拟器仍为 `http://10.0.2.2:8000`）；`start.bat` 启动前会结束 5173 端口上的旧服务进程，确保加载最新代码。

AI 未连接时，版本选择、跟读与发音复盘自动跳过：本地反馈后直接进入第二次回答，两次录音与收录流程仍完整可用。

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
# 或使用标准启动命令
npm start
npm run typecheck
npm run lint
npm test
npm run build
npm run android:sync
```

Windows 下也可以直接双击项目根目录的 `start.bat`：脚本会先结束 5173 端口上的
旧服务进程，再启动 Vite 开发服务器（保证加载最新代码），等待服务就绪后自动打开
`http://127.0.0.1:5173/`。关闭新打开的终端窗口即可停止网页服务。网页版默认连接
本机 `http://127.0.0.1:8000` 后端；若右上角显示「API未连接」，请先双击
`start-backend.bat` 启动后端，再刷新页面。

当前开发机已安装隔离的 JDK 21、Android SDK 36、Platform Tools 与 API 36
模拟器。以下命令会自动使用这些本地工具，依次运行代码规范、测试、生产构建、
Capacitor 同步、Android 单元测试、Android Lint 和 Debug 打包：

```bash
npm run android:build
```

产出正式签名 Release 包（要求本机存在 `android/keystore.properties`，见
`docs/android-acceptance-v1.2.md`；Release 必须通过 `-BackendUrl` 锁定云端
地址，家庭局域网 HTTP 需加 `-AllowLanHttp`）：

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/android-build.ps1 -Release -BackendUrl http://192.168.0.26:8000 -AllowLanHttp
```

APK 输出到：

```text
artifacts/ielts-speaking-meow-v1.6.0-debug.apk    # 开发调试
artifacts/ielts-speaking-meow-v1.6.0-release.apk  # 正式签名（v1.6.0 release）
```

连接 Android 手机或启动模拟器后，可以额外运行设备端测试：

```bash
npm run android:test:device
```

Android Studio 可以直接打开 `android/`。

## 安装到手机

正式包是 `artifacts/ielts-speaking-meow-v1.6.0-release.apk`。把 APK 复制或
发送到 Android 手机，允许对应文件应用“安装未知应用”后即可安装。通过 USB
调试也可执行：

```bash
adb install artifacts/ielts-speaking-meow-v1.6.0-release.apk
```

**注意**：Release 与早期 Debug 包签名不同，Android 不允许互相覆盖安装；
从旧 Debug 包升级需先卸载（本地数据会清除），此后所有更新都用同一 Release
签名，覆盖安装（`-r`）会保留练习、录音和表达。卸载 App 会删除其本地私有
数据，这是 `allowBackup=false` 的预期行为。请备份
`artifacts/ielts-speaking-meow-release.keystore` 与签名口令（均不入 git）。

模拟器中的 Web Speech STT 可能因系统服务或网络不可用而失败。V1.0 已按产品
规范保留原录音并提供手动转写；最终仍建议在一台实体 Android 手机上复测真实
麦克风、扬声器音量和系统 TTS 音色。

## 目录

```text
src/
  application/       核心训练写入顺序与流程服务
  app/               组合根、设置/导入控制器
  data/              静态题库
  domain/            领域模型、本地分析、两次对比
  features/          按功能拆分的 UI(practice 练习流、imports 导入、settings)
  infrastructure/    浏览器/Android 语音、Backend 客户端、IndexedDB
  ports/             LLM、TTS、STT、录音与存储边界
android/              Capacitor Android 工程与本地 System TTS / OCR 插件
backend/              自建 FastAPI Backend(托管 DeepSeek / 火山 STT / 火山 TTS)
docs/                 可执行开发计划
```

项目最高规范见 `AGENTS.md`。
