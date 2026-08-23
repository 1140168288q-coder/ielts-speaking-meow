# 雅思口语喵

Android-first 的 IELTS Speaking 单题练习应用。V1.8 的闭环：

> 结构化季度题库 → 听题 → 用系统键盘语音输入或手动输入第一次回答
> （可选手动计时）→ 本地教学 RAG + 长期记忆增强的 DeepSeek 纯文本分析
> （语法 / 词汇 / 连贯性 / 自然度 / 切题 / 内容展开）→
> 简洁重点式反馈 + 试听优化答案与 3 个参考回答 → 复用个人素材完成
> 第二次回答 → 小改后收录个人语料

## 当前重构版

- **新的产品入口与导航**：首页只保留一个清晰的“继续/开始练习”主行动，题库、
  复盘、账号分别拥有稳定入口；练习页按“第一次回答 → 重点反馈 → 第二次回答 →
  可选收录”推进，不再让 AI 请求阻塞第二次作答。
- **统一 Design System**：建立语义化颜色、排版、间距、圆角、按钮、输入、卡片、
  Tabs、导航与状态样式，并支持浅色、深色和跟随系统三种外观。
- **邮箱云账号**：前后端已接通注册、登录、邮箱验证、密码找回、会话恢复和退出；
  Android 使用 Keystore 加密保存会话，Web 预览仅使用当前标签页会话存储。旧本地
  账号保留为本机数据归属与历史兼容层，不再作为正式云身份。
- **三类个性化数据分离**：Learning Memory 是从练习事实派生的学习画像；个人语料
  保存“以后怎么说”的短英语表达；个人素材保存“以后说什么”的人物、地点、经历、
  物品和观点。个人素材默认仅在本机匹配，未经用户确认不发送给 AI。
- **明确确认的手动云同步**：Backend 已实现账号隔离的幂等 push/pull、版本冲突和软删除；
  账户页仅在邮箱已验证且用户逐次确认范围后，才同步已提交练习与已保存的 AI 文本反馈、
  个人语料和个人素材。未提交草稿、Memory 快照、原始录音、导入文件、语音缓存和密钥
  不上传；网络失败会保留本机待同步项目，冲突会停止覆盖。不会后台自动上传。

## V1.8 题库与训练能力

- **2026 年 5-8 月结构化内置题库**：由 `scripts/import-question-bank.mjs`
  自动从新航道 PDF 解析生成，保留 Part 1/2/3、topic、new/old、Part 2
  cue points、Part 2↔Part 3 关联；旧 V1.4 内置题只保留为历史记录解析。
- **题库可维护更新**：换季度只需
  `npm run question-bank:update -- "<新题库.pdf>"`，业务代码不用改。
- **本地数据归属**：昵称 + 可选本地 PIN + 稳定 userId；练习、AI 反馈、
  个人表达和导入题按本机身份隔离；旧数据自动归属“本机用户”。正式登录身份
  使用邮箱云账号，跨设备恢复仅通过账户页的明确手动同步进入。
- **IELTS 教学 RAG（本地词汇检索）**：按 Part 与主题检索教学原则，
  离线可用，并把紧凑上下文随反馈请求发送到自建 Backend。
- **用户长期 Memory**：从真实练习和语料聚合练过次数、反复问题与可复用
  表达，AI 反馈会参考紧凑聚合结论；个人素材保持独立并默认本机使用。
- **AI 反馈 UI 精简**：优先展示最值得改的 2-3 点；语法/词汇/优化答案
  折叠；3 个参考回答改为 tab 切换，减少信息堆积。
- 不评分、不评价发音/语速/停顿/语调、不恢复 STT 的产品方向不变。

## V1.7 变化（历史）

- **彻底移除 STT**：客户端不再有录音转写 UI，Backend 不再提供 `/v1/stt`，
  火山 STT 服务、配置和测试全部删除。用户直接用手机系统键盘的麦克风语音输入，
  或手动输入答案文本。
- **可选计时器**：每道题的答题界面提供开始 / 暂停 / 继续 / 重置，不自动计时，
  不强制结束，不自动提交；时长仅随答案一并提交给 DeepSeek 作为参考。
- **DeepSeek 只分析文本**：提交 Part、题目、答案文本和可选作答时间；
  分析语法、词汇、连贯性、表达自然度、是否切题和内容展开。
  不评价 Pronunciation、语速、停顿、语调；整个软件不给 IELTS Band 分数或水平评分。
- **新 Prompt 与结构化输出**：友好的 IELTS Speaking Tutor，优先最重要问题，
  不过度纠错；优化答案保持用户原本水平和表达习惯；每道题返回 3 个自然口语的
  参考回答（简单自然版 / 自然提升版 / 另一种表达版），不写成作文或背诵范文。
- **TTS 优化**：题目、优化答案和 3 个参考回答都可试听；同一按钮第二次点击立即
  停止，播放 A 时点 B 会先停 A 再播 B，全局同时只有一个 TTS 在播放。
- **界面精简**：删除录音、转写重试、跟读和发音复盘等无用按钮与文字，只保留
  一行弱提示说明“可用系统键盘语音输入”。

## 保留能力

- Part 1 / 2 / 3 基础题库、浏览与随机抽题；导入材料整理成候选题；
- 题目 TTS 播报（云端 AI 音色失败自动回退 Android / Web 系统 TTS）；
- 两次文本回答、AI 文本反馈、本地规则降级提示；
- 第二次回答收录个人语料，个人表达可试听、复习、编辑；
- IndexedDB 本地持久化；V1.6 及更早版本的练习、历史录音和旧 AI 反馈可读取，
  旧反馈会自动迁移成 V1.7 文本分析结构。

## 技术方案

- React 19 + TypeScript strict + Vite；
- Capacitor 8，仅生成 Android 平台；
- Zod 校验题库、持久化领域对象和 AI 结构化结果；
- 内置题库为生成式 JSON（`src/data/questionBank.generated.json`），
  更新流水线见 `docs/QUESTION_BANK_UPDATE.md`；
- IndexedDB 本地数据、个人语料、个人素材与同步 outbox；RAG/Memory 为轻量本地词汇检索与聚合，
  不引入向量数据库或 embedding API；
- 季度题库与本地数据库在启动时并行加载；导入工作区、PDF 和 DOCX 解析器仅在进入
  导入流程后加载，主应用包保持在 500 kB 以下；
- React 本地状态 + application service，不引入额外状态框架；
- Vitest + Testing Library + fake IndexedDB；
- Backend：FastAPI + SQLAlchemy Async + Argon2 + httpx + pydantic；开发使用
  SQLite，部署支持 PostgreSQL，pytest 单测使用 mock 上游，详见
  `backend/README.md`。

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
# 换季度题库:自动解析 PDF 并覆盖内置题库
npm run question-bank:update -- "新季度题库.pdf"
```

Windows 下也可以直接双击项目根目录的 `start.bat`：脚本会先结束 5173 端口上的
旧服务进程，再启动 Vite 开发服务器。网页版默认连接本机 `http://127.0.0.1:8000`
后端；若右上角显示「API未连接」，请先双击 `start-backend.bat` 启动后端，再刷新
页面。

当前开发机已安装隔离的 JDK 21、Android SDK 36、Platform Tools 与 API 36
模拟器。以下命令会自动使用这些本地工具，依次运行代码规范、测试、生产构建、
Capacitor 同步、Android 单元测试、Android Lint 和 Debug 打包：

```bash
npm run android:build
```

产出正式签名 Release 包（要求本机存在 `android/keystore.properties`；
Release 必须通过 `-BackendUrl` 锁定云端地址，家庭局域网 HTTP 需加
`-AllowLanHttp`）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/android-build.ps1 -Release -BackendUrl https://your-backend.example.com
```

APK 输出到：

```text
artifacts/ielts-speaking-meow-v1.8.0-debug.apk    # 开发调试
artifacts/ielts-speaking-meow-v1.8.0-release.apk  # 正式签名
```

连接 Android 手机或启动模拟器后，可以额外运行设备端测试：

```bash
npm run android:test:device
```

Android Studio 可以直接打开 `android/`。

## 安装到手机

正式包是 `artifacts/ielts-speaking-meow-v1.8.0-release.apk`。把 APK 复制或
发送到 Android 手机，允许对应文件应用“安装未知应用”后即可安装。通过 USB
调试也可执行：

```bash
adb install artifacts/ielts-speaking-meow-v1.8.0-release.apk
```

**注意**：Release 与早期 Debug 包签名不同，Android 不允许互相覆盖安装；
从旧 Debug 包升级需先卸载（本地数据会清除），此后所有更新都用同一 Release
签名，覆盖安装（`-r`）会保留练习、答案文本、历史录音和表达。卸载 App 会删除
其本地私有数据，这是 `allowBackup=false` 的预期行为。请备份
`artifacts/ielts-speaking-meow-release.keystore` 与签名口令（均不入 git）。

## 目录

```text
src/
  application/       核心训练写入顺序与流程服务
  app/               组合根、设置/导入控制器
  data/              静态题库
  domain/            领域模型、本地文本分析、旧数据迁移
  features/          按功能拆分的 UI(practice 练习流、imports 导入、settings)
  infrastructure/    浏览器/Android 语音、Backend 客户端、IndexedDB
  ports/             LLM、TTS、录音(仅历史兼容)与存储边界
  android/            Capacitor Android 工程与本地 System TTS / OCR 插件
  backend/            自建 FastAPI Backend(托管 DeepSeek / 火山 TTS)
  docs/               历史开发与验收文档
```

项目最高规范见 `AGENTS.md`。
