# 参赛修复执行结果

项目：`D:/111-Trae_project/雅思喵/雅思口语喵`  
执行日期：2026-09-07  
基线：`f12f456` / V2.1.10  
发布版本：`2.2.0` / Android `versionCode 19`  
范围：按 `docs/COMPETITION_FIX_PLAN.md` 执行 P0 → P1 → P2；保留既有改动。

修复集中在双答训练闭环的数据可靠性、AI 成本闸门、完成后复盘和最小训练计划，没有引入 STT、录音转写、评分、支付、完整模拟考或新依赖。随后按发布请求完成了版本升级、Release APK 构建和现有 Windows Docker/Cloudflare 公网栈更新；未提交任何密钥或部署环境文件。

## 已完成

### P0

- **会话写入原子化**：`PracticeService` 的答案、AI 反馈、二答分析、完成状态和 Memory 修改统一走原子更新；IndexedDB 使用 read/write transaction，其他存储使用按会话串行队列兜底。答案快照校验会拒绝迟到 AI 结果覆盖新答案。
- **备份可恢复性**：备份格式升级为 V2，增加本地账号/当前账号、个人素材、导入来源、导入题和原始导入文件；仍兼容 V1 备份。导入前先校验录音、文件大小、题目来源和账号身份，并按时间戳跳过较新的本地记录，避免旧备份覆盖新答案。
- **AI/TTS 幂等和计量**：反馈、二答反馈、整理、素材建议和 TTS 均按用户 + 路由 + 请求摘要绑定幂等键；同键不同内容拒绝，同键同内容在途请求/短期重放不会重复上游或扣费；授权先检查、上游成功后才结算。新增 `usage_events.request_hash` 迁移，并用 PostgreSQL 用户行锁覆盖多 worker 的同键竞争。

### P1

- **失败路径与隐私边界**：TTS、整理、素材建议上游失败均不计量；关闭 Memory 时不发送 learner context 或个人素材；二答 Memory 候选必须与真实二答来源句有足够文本依据，伪造来源会被过滤。Memory 支持单条重新归类和删除。
- **等待、失败、离开保护**：AI 等待时显示明确等待态并禁用完成/离开；失败仍保留本地答案并可重试；二答分析和确认语料写入均做当前答案校验和去重，避免迟到结果回退或重复收录。
- **完成后只读复盘**：完成阶段现在展示第一答、第二答、重点反馈、本地离线反馈、参考答案/TTS、二答修正和已确认语料；刷新后仍从会话记录恢复，无 AI 时也能复盘，不增加任何分数或语音判断。
- **最小训练计划**：新增固定、可解释的 `TrainingPlan` 编排：目标 → 现有相关材料/教学依据 → 1–2 项行动 → 二答成果。结果经过 Zod 校验并支持离线回退；它复用现有本地 RAG、Memory 和训练结果，不自动代答、不写入 Memory，也不宣称模型自主调用未存在的工具。
- **题目快照与主题匹配的部分修复**：新建会话保存题目快照，历史记录优先使用快照；个人素材只有题目关联或 topic/tag 证据重合时才命中，同 Part 本身不再构成匹配依据。

### P2

- **健康探针**：DeepSeek `/health/verify` 只接受严格的 `{"ok": true}` JSON，非法或 `ok:false` 不会误报为已验证。

## 尚未完成

规划表中保留未勾选的同步项：目前已完成题目快照和主题证据匹配，但没有新增云端冲突解决 UI/继续拉取入口，避免在本轮扩大同步范围。

进程内幂等缓存只保留 24 小时且最多 256 条；如果请求在另一个 Backend worker 或进程重启后重放，数据库仍会阻止再次上游调用和扣费，但因不持久化私人 AI/TTS 响应，会返回“结果已过期/不可用”，需要客户端重新生成幂等键。这是隐私与可靠计量之间的明确限制，后续可在已有云同步基础上设计受控的结果恢复方案。

## 验证结果

以下命令均在项目目录执行并通过：

| 验证 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过，`--max-warnings=0` |
| `npm test` | 58 个测试文件、358 项测试通过 |
| `npm run test:backend` | 91 项测试通过 |
| `npm run build` | 通过，Vite 转换 2015 modules 并生成 `dist/` |
| `npm run verify` | 上述类型检查、Lint、前后端测试和生产构建全部通过 |
| 后端 Python 语法检查 | 通过 |

新增回归覆盖：会话并发合并、V1/V2 备份恢复与较新数据保护、账号/素材/导入题恢复、同键异内容、并发幂等和额度耗尽、上游失败零扣费、健康探针非法结构、来源句校验、Memory 删除、完成页复盘和训练计划离线回退。

## 2.2.0 发布与公网验证

- `package.json`、`package-lock.json`、Backend FastAPI 版本和 Android `versionName` 已统一为 `2.2.0`；Android `versionCode` 从 18 升至 19。
- 公网栈已用新 Backend 镜像重建并重启：PostgreSQL、Backend、Cloudflare Tunnel 均为运行状态；`https://api.formomentward.com/health` 返回 HTTP 200，`version` 为 `2.2.0`。当前 DeepSeek/TTS 配置存在，但健康探针仍显示 `unverified`，没有把配置状态冒充真实上游验证。
- Release APK：`artifacts/ielts-speaking-meow-v2.2.0-release.apk`；包名 `com.ieltsspeakingmeow.app`，`versionCode=19`，`versionName=2.2.0`，签名校验通过，SHA-256：`3cc8388b9a5f7b9283d3a7218bd44861cc9f4313bf8e05dc56058b74cfd28585`。
- Debug APK 使用同一锁定公网地址进行 Android WebView 测试：模拟器中首页显示“云端可用”，WebView 内直接 `fetch('https://api.formomentward.com/health')` 返回 HTTP 200 / `version=2.2.0`；第一答输入和本地保存流程可用。随后安装 Release APK，包版本正确、`MainActivity` 正常恢复且进程存活。
- Web 端使用同一份锁定公网地址的生产 `dist` 启动本地预览，页面显示“云端可用”，题目首页和未完成练习可正常加载。项目没有单独配置公网静态 Web 托管，本次公网部署范围是现有 Backend + Cloudflare Tunnel。

## 未验收环境

- 已用 Android API 36 模拟器验收启动、首页、公共健康请求和第一答保存；真实 Android 手机上的系统键盘输入、TTS 实际音频、返回键/退出保护、重启恢复和弱网交互仍待现场验收。
- 公网健康检查确认 Backend 可达，但没有真实已验证的云端邮箱账号可用于完整登录、反馈和 TTS 付费路径；DeepSeek/火山 TTS 当前健康状态为 `unverified`，不能把本次结果写成真实上游业务成功。
- 本机 Windows Docker/Cloudflare 栈已部署并验证公网健康；目标 Linux 主机的 Compose、备份恢复和 HTTPS Tunnel 迁移仍未验收。
- 没有两台已登录设备，云端双设备恢复与冲突解决仍待人工验收；也没有真实用户效果或比赛演示数据，不能虚构指标。

## 关键文件

- `src/application/practiceService.ts`
- `src/application/storageBackupService.ts`
- `src/infrastructure/storage/indexedDbStorage.ts`
- `src/features/practice/PracticeFlow.tsx`
- `src/features/practice/components/TrainingPlanCard.tsx`
- `src/domain/trainingPlan.ts`
- `backend/app/services/feature_authorization.py`
- `backend/app/routers/feedback.py`
- `backend/app/routers/tts.py`
- `backend/app/services/deepseek_service.py`
- `backend/alembic/versions/0004_usage_request_hash.py`
- `docs/COMPETITION_FIX_PLAN.md`

从比赛评分角度，本轮直接增强了“可持续使用的双答闭环、AI 调用安全与结果交付、失败可恢复、可解释训练行动”这些可在现场演示中验证的部分；模型自主工具选择、云端冲突解决和真机/真实上游证据仍应作为后续验收工作，而不是用静态页面或测试替代。
