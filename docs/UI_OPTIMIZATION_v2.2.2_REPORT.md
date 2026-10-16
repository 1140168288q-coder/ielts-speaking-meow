# 雅思口语喵 v2.2.2 UI 文字与排版优化报告

日期：2026-09-18

分支：`codex/v2-product-refactor`

实现提交：`947cbb0 feat: refine UI copy and layout for v2.2.2`

## 1. 结果摘要

- 已按 `docs/UI_COPY_LAYOUT_OPTIMIZATION_v2.2.2.md` 完成首页、题库、复盘、账号、设置、AI 服务、本地备份、导入与知识资料等用户界面的文字统一。
- 已完成 8 项排版优化，并修复复盘 tab 换行、空状态被底栏遮挡、题库序号过浅、模式卡片高度及箭头错位、首页主按钮换行等真实问题。
- 用户主界面不再展示 `Backend`、`DeepSeek`、`RAG`、`Memory`、`本机用户` 等工程术语；必要诊断信息仅保留在折叠的“高级连接设置”中。
- 版本已更新为 `2.2.2`，Android 为 `versionCode 21`、`versionName 2.2.2`。
- 全量工程验证、浏览器逐页复核、公网部署和签名 Release APK 均已完成。

## 2. 逐条文案对照清单

状态均为“已落实”。“位置”列给出主要实现文件；同类状态或复用文案也同步到了关联组件与测试。

### 2.1 首页

| 建议项 | 实际处理 | 位置 |
| --- | --- | --- |
| 大标题改为“嗨，今天也开口说一句吧。” | 已按建议替换，并保留用户自定义问候覆盖能力 | `src/features/home/HomeView.tsx`、`src/App.tsx` |
| 副标题加入节奏与温度 | 改为“说一遍，听一听，再说一遍——进步，总是发生在第二次开口的时候。” | `src/features/home/HomeView.tsx` |
| “今日建议”改为“今日一题” | 已替换 | `src/features/home/HomeView.tsx` |
| “Part 1・一道题完成两次回答”精简 | 改为“Part 1 · 一道题，答两次” | `src/features/home/HomeView.tsx` |
| 卡片说明改为允许不完美的鼓励 | 改为“不用完美，先张嘴。节奏比流利更重要。” | `src/features/home/HomeView.tsx`、`src/domain/progress.ts` |
| 主按钮改为“就这题，开练” | 已替换 | `src/features/home/HomeView.tsx` |
| 次按钮改为“我自己挑” | 已替换 | `src/features/home/HomeView.tsx` |
| 三步中的第二步改为“听一听” | 已替换 | `src/features/home/HomeView.tsx` |

说明：建议稿中的“录下来”与产品 V1.7 起彻底移除应用内录音/STT 的真实能力冲突，因此按建议意图采用“听一听”，不制造不存在的录音能力，也不改变核心业务边界。

### 2.2 首页模式选择与学习轨迹

| 建议项 | 实际处理 | 位置 |
| --- | --- | --- |
| `CHOOSE A FOCUS` 保留为弱装饰 | 保留，并通过样式降低字号与透明度 | `src/features/home/HomeView.tsx`、`src/design-system.css` |
| 主标题改为“今天想练哪种？” | 已替换 | `src/features/home/HomeView.tsx` |
| Part 1 副题改为“热个身，随口聊两句” | 已替换 | `src/features/home/HomeView.tsx` |
| Part 2 副题改为“给你一分钟，讲个小故事” | 已替换 | `src/features/home/HomeView.tsx` |
| Part 3 副题改为“抬个杠，说出你的理由” | 已替换 | `src/features/home/HomeView.tsx` |
| `YOUR LEARNING TRAIL` 保留 | 已保留为弱装饰 | `src/features/home/HomeView.tsx`、`src/design-system.css` |
| 轨迹文案补完整并增加温度 | 改为“你说过的每一句话，都在悄悄变成你的。” | `src/features/home/HomeView.tsx` |

### 2.3 题库页

| 建议项 | 实际处理 | 位置 |
| --- | --- | --- |
| 标题改为“挑一道顺眼的，开练” | 已替换 | `src/features/library/QuestionLibrary.tsx` |
| 说明改为用户可感知的“不眼花” | 已替换 | `src/features/library/QuestionLibrary.tsx` |
| “导入”改为“导入题库” | 已替换 | `src/features/library/QuestionLibrary.tsx` |
| “导入并换季”改为“换季更新” | 已按建议文案替换 | `src/features/library/QuestionLibrary.tsx` |
| Part 标签副题保留 | 已保留现有题数摘要 | `src/features/library/QuestionLibrary.tsx` |
| PLACE / PEOPLE / OBJECTS / EVENTS 中文化 | 显示为“地点 / 人物 / 物品 / 事件” | `src/features/library/QuestionLibrary.tsx` |
| 状态改为“全部 / 还没练 / 练过了” | 已替换 | `src/features/library/QuestionLibrary.tsx` |
| “只看新题”保留 | 已保留 | `src/features/library/QuestionLibrary.tsx` |
| “随机一题”改为“随机抽一道” | 已替换 | `src/features/library/QuestionLibrary.tsx` |
| 卡片元信息去掉“保留题”并统一分隔 | 用户可见元信息仅保留主题、练习状态与难度 | `src/features/library/QuestionLibrary.tsx` |
| “标为已做”改为“打个勾” | 已替换，并为反向操作提供“取消勾选” | `src/features/library/QuestionLibrary.tsx` |
| 底部操作改为“开始练这道” | 已替换 | `src/features/library/QuestionLibrary.tsx` |

### 2.4 复盘中心

| 建议项 | 实际处理 | 位置 |
| --- | --- | --- |
| 副标题改为“说过的话不会白白流走……” | 已替换 | `src/features/review/ReviewCenter.tsx` |
| “我的知识库”改为“我的语料库” | 已替换；相关资料入口也统一采用用户语言 | `src/features/review/ReviewCenter.tsx`、`src/features/knowledge/KnowledgeLibrary.tsx` |
| 金句改为“今天说出口的别扭……” | 已替换 | `src/features/review/ReviewCenter.tsx` |
| 轨迹入口改为“点开，看看自己走了多远” | 已替换并更新测试 | `src/features/practice/LibraryViews.tsx` |
| 空状态标题改为“这里还安安静静的” | 已替换 | `src/features/practice/LibraryViews.tsx` |
| 空状态副文增加共情 | 已替换为“第一句哪怕磕磕巴巴也没关系” | `src/features/practice/LibraryViews.tsx` |

### 2.5 账号与同步

| 建议项 | 实际处理 | 位置 |
| --- | --- | --- |
| 副标题直说换设备与离线保存 | 已替换 | `src/features/accounts/AccountView.tsx` |
| “当前本机资料”改为“本机练习” | 已替换 | `src/features/accounts/AccountView.tsx` |
| “本机用户”改为“本机游客” | 仅改变展示名，底层稳定账号标识与数据兼容逻辑不变 | `src/App.tsx`、`src/features/accounts/AccountView.tsx` |
| 本机说明说明“只存在这台手机” | 已替换 | `src/features/accounts/AccountView.tsx` |
| 登录有效期与同步说明口语化 | 使用“不会偷偷上传”的建议文案 | `src/features/accounts/CloudAccountPanel.tsx` |

### 2.6 设置、AI 服务与本地备份

| 建议项 | 实际处理 | 位置 |
| --- | --- | --- |
| 删除顶部开发者导航说明 | 已删除 | `src/app/SettingsController.tsx` |
| 外观说明改为“跟着系统走……” | 已替换 | `src/app/SettingsController.tsx` |
| 训练说明改为本机进度各自保存 | 已替换 | `src/app/SettingsController.tsx` |
| “AI 反馈需检查”拟人化 | 改为“AI 还没睡醒，点一下检查” | `src/app/SettingsController.tsx` |
| 技术列表收成两行友好状态 | 主卡只显示“服务状态 / 模型”；详细 Backend、DeepSeek 信息移入高级连接设置 | `src/app/SettingsController.tsx` |
| “重新检查连接”改为“唤醒一下 AI” | 已替换 | `src/app/SettingsController.tsx` |
| 云端试听按钮去掉 Backend | 改为“试听一下云端声音” | `src/app/SettingsController.tsx`、`src/domain/ttsPresets.ts` |
| 备份长段落拆成三段 | 按“本机保存 → 信封比喻 → 合并规则”拆分 | `src/features/storage/StorageManager.tsx` |
| “导出完整本地备份”改为“导出备份” | 已替换 | `src/features/storage/StorageManager.tsx` |
| “清理 AI 语音缓存”改为“清掉 AI 缓存” | 已替换 | `src/features/storage/StorageManager.tsx` |

### 2.7 全局风格与术语收口

| 建议意图 | 实际处理 | 位置 |
| --- | --- | --- |
| 前台不出现工程师术语 | 导入、知识资料、练习、语料、同步与状态提示统一采用“AI / 资料 / 长期记忆 / 云端服务”等用户语言 | `src/app/ImportController.tsx`、`src/features/imports/ImportWorkspace.tsx`、`src/features/knowledge/KnowledgeLibrary.tsx`、`src/features/practice/**`、`src/features/accounts/**` |
| 技术诊断只在高级设置出现 | `Backend`、`DeepSeek`、供应商验证和服务地址保留在折叠的“高级连接设置” | `src/app/SettingsController.tsx` |
| 不改变核心业务 | 仅改展示文案、布局样式和展示名映射；账号 ID、持久化、AI 协议、训练流程均未改变 | 上述 UI 文件及既有全量回归测试 |

## 3. 八项排版建议对照

| # | 建议 | 状态与实现 | 位置 |
| --- | --- | --- | --- |
| 1 | 强化标题层级、说明最多两行、弱化英文装饰 | 已落实：主标题放大加粗，说明两行截断，英文 eyebrow 缩小并降至约 60% 视觉强度 | `src/design-system.css` |
| 2 | 首页橙色卡片突出题目、弱化说明、拉开按钮主次 | 已落实：题目增大加粗，说明 72% 白，按钮间距增大；主按钮白底、次按钮描边，并修复窄屏主按钮换行 | `src/design-system.css` |
| 3 | 三张模式卡等高、圆形图标、箭头对齐 | 已落实：最小高度 120px、统一圆形图标底与三列网格；截图复核后额外修正箭头列 | `src/design-system.css` |
| 4 | 题库操作紧凑、主题横滚、筛选分两行、序号加深 | 已落实：顶部小字图标按钮、主题 chips 横滚、状态与动作分行、序号使用更深橙色 | `src/features/library/QuestionLibrary.tsx`、`src/design-system.css` |
| 5 | 复盘四 tab 一行居中、空状态不被底栏遮挡 | 已落实：固定四列、图文垂直居中、缩小字号；空状态加高及底部安全间距，图标放大 | `src/design-system.css` |
| 6 | 账号两卡对齐、已验证绿点 | 已落实：统一顶部、圆角、内外边距与最小高度；已验证标签增加绿点 | `src/features/accounts/CloudAccountPanel.tsx`、`src/design-system.css` |
| 7 | 设置英文标签弱化、中文标题突出、设置项分割线 | 已落实 | `src/design-system.css` |
| 8 | 底部 tab 选中圆角缩小、颜色统一 | 已落实：选中深橙、未选中中灰、选中背景改为小圆角 | `src/design-system.css` |

## 4. 自查与视觉复核

使用 390 × 844 手机视口检查生产构建预览，并检查浏览器 console/error；未发现运行时错误。

| 页面 | 截图 | 复核结果 |
| --- | --- | --- |
| 首页 | `runtime/ui-v2.2.2-qa/01-home-refined.png` | 标题、橙色主卡、按钮主次、三张等高模式卡正常 |
| 题库 | `runtime/ui-v2.2.2-qa/02-library.png` | 顶部操作收紧、筛选分行、横向 chips 与深色序号正常 |
| 复盘 | `runtime/ui-v2.2.2-qa/03-review.png` | 四 tab 单行居中，空状态正文未被底部导航遮挡 |
| 我的 | `runtime/ui-v2.2.2-qa/04-account.png` | 本机/云端卡片对齐、圆角与层级一致 |
| 设置 | `runtime/ui-v2.2.2-qa/05-settings.png` | 英文标签弱化、中文标题突出、主卡不暴露工程术语 |

截图为本地 QA 证据，位于忽略提交的 `runtime/` 目录，不进入发行源码提交。

## 5. 自动化验证

### 5.1 全量统一验证

命令：

```text
npm run verify
```

结果：

- TypeScript：通过。
- ESLint：通过，`--max-warnings=0`。
- Vitest：62 个测试文件、373 项测试全部通过。
- Backend pytest：96 项测试全部通过。
- Vite production build：通过，2021 个模块完成转换。

核心训练流程由 `src/features/practice/PracticeFlow.text.test.tsx` 的 12 项回归覆盖，包括手动计时、第一次/第二次回答、AI 失败本地降级、TTS 切换、二答分析及个人语料确认；本次全部通过。

### 5.2 Release 构建内再次验证

命令：

```text
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/android-build.ps1 -Release -BackendUrl https://api.formomentward.com
```

脚本再次完成 ESLint、373 项前端测试、96 项后端测试、锁定 URL 的生产构建、Capacitor sync、Android lint、debug APK 与 release APK 构建，Gradle 两阶段均为 `BUILD SUCCESSFUL`。

已知非阻断警告：

- 合成 PDF 测试有 pdf.js `standardFontDataUrl` 与损坏 PDF 索引提示，测试均通过。
- `SettingsController` 既有异步状态测试有 React `act(...)` 提示，测试均通过。
- Android 构建报告 `flatDir`、SDK XML 版本差异及 Gradle 9 兼容性预告；Android lint 与当前 Gradle 构建均通过。

## 6. 公网部署

部署前公网版本：`2.2.1`。

### 6.1 数据库备份

仓库 `scripts/backend-backup.sh` 在当前 Windows 上因 WSL 不存在 `/bin/bash` 无法执行；随后按脚本等价流程，在 PostgreSQL 容器内执行 custom-format、compression 9、no-owner、no-acl 的 `pg_dump`，再复制到仓库备份目录并删除容器临时文件。

- 路径：`backups/v2.2.2-predeploy/ielts-meow-20260918T100920Z.dump`
- 大小：69,746 bytes
- SHA256：`D52B21C004E46653E0E907D9BB84F3E47A40737AC62A1F2A9E64659B18BCC1EE`

### 6.2 重建与健康检查

命令：

```text
docker compose --env-file .env.deploy -f compose.yaml -f compose.cloudflare.yaml up -d --build
```

结果：Backend 镜像重建，Backend 容器重新创建并达到 `healthy`；PostgreSQL 为 `healthy`，Cloudflare Tunnel 为 `Up`。

分层验证：

- 容器内 `http://127.0.0.1:8000/health`：`status=ok, version=2.2.2`。
- Tunnel 日志存在已注册的 NRT QUIC 连接。
- 公网 `https://api.formomentward.com/health`：`status=ok, version=2.2.2`。
- 公网 provider 配置状态：文本 AI 与云端 TTS 均为 `configured=true`；本次发布未主动消耗付费上游调用做 verify。

Tunnel 日志中另一个 edge 地址仍有间歇性 QUIC 重试警告，但已有连接正常注册，且本次公网 HTTPS 健康检查真实成功。

## 7. Release APK

- 路径：`artifacts/ielts-speaking-meow-v2.2.2-release.apk`
- 大小：47,294,220 bytes（45.10 MiB）
- SHA256：`098722CD95563C3F4984A044B3057B00E2D7CE34311E18D833B2D3ACBF11DAB4`
- Application ID：`com.ieltsspeakingmeow.app`
- `versionCode`：21
- `versionName`：2.2.2
- 固定服务地址：`https://api.formomentward.com`
- 签名：APK Signature Scheme v2 验证通过，1 个 RSA 2048 signer
- signer certificate SHA256：`DCE1710195F3D24533EC7008AE0459587746423577ECD328D77FEEB58CB5F260`

## 8. 遗留项

- 未在本次流程中连接实体 Android 手机做人工触控验收；已完成 390 × 844 浏览器手机视口逐页检查、Android lint、签名验证和完整自动化回归。
- Tunnel 的单路 edge 重试警告可继续由现有 watchdog 观察；当前另一路已注册且公网 v2.2.2 健康检查正常。
- 用户提供的 `.txt` 转换副本与任务说明保留为未跟踪文件，没有擅自纳入产品提交；正式依据 Markdown 已纳入提交。
