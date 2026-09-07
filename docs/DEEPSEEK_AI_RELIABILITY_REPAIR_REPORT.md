# DeepSeek AI 可靠性修复交付报告

日期：2026-09-05  
版本：`2.1.10`  
执行目录：`D:\111-Trae_project\雅思喵\雅思口语喵`

## 结论

本轮已在现有项目上完成 R1-R8 代码修复，并在当前可访问的 Windows Docker + Tunnel
环境完成 R9 验证；目标家庭 Linux 主机和物理 Android 真机仍未宣称完成。整个过程没有
执行 reset、覆盖用户文件或另建替代项目。当前本地提交 `146f718` 保留，修改集中在
AI 反馈可靠性、额度结算、二答交互、部署配置和对应测试；没有恢复 STT、应用内录音、
发音评价或 Band Score。

Backend 已用当前工作树重建并运行在 Windows Docker Desktop 的 PostgreSQL + FastAPI
栈中，Cloudflare Tunnel 已连接到 `api.formomentward.com`。公网 `/health` 当前返回
200、版本 `2.1.10`；DeepSeek 和火山 TTS 的真实验证状态均为 `verified`。

## 修改内容

### 客户端

- 二答改为直接调用 `textAi.getSecondAttemptAnalysis(...)`，不再把实例方法取出后丢失
  `this`；真实 `BackendTextProvider` 页面级测试会观察到
  `/v1/feedback/second-attempt` 请求。
- 一答和二答使用独立的运行状态与 promise。二答在一答仍 pending 时进入可见队列，
  一答成功或失败后自动启动；重复点击不会静默丢失，也不会让旧结果覆盖新答案。
- 一答、二答都携带只由 session/attempt/更新时间组成的稳定
  `X-Idempotency-Key`，不包含答案正文；请求状态会区分可重试与不可重试错误。
- 二答修正句收到分析后默认全部勾选，textarea 默认显示 `corrected`，编辑值在无关
  render 后保持；提交时过滤空值并只保存用户选中的修正句。Memory 候选仍默认不选，
  必须逐条确认。
- Text AI 未配置、Provider 不支持、答案为空和不可重试错误均显示明确说明；离线时
  立即进入本地手动候选，不再显示“正在整理”的矛盾状态。
- Web `fetch` 与 CapacitorHttp 共用 105 秒用户可见读预算，移动端连接预算固定最多
  10 秒；客户端自动重试最多一次，且只对网络中断、无 Backend 错误码的超时和限流
  开启。

### Backend / DeepSeek

- `/v1/feedback` 与 `/v1/feedback/second-attempt` 拆为“授权检查 → DeepSeek 执行并
  完成 JSON/schema/内容策略校验 → 成功后原子结算”。上游失败、超时、非法 JSON、
  字段缺失和策略违规均不扣反馈额度。
- 同一 `user + feature + X-Idempotency-Key` 只创建一条 `UsageEvent`；同 key 重试可
  再访问上游但不会再次扣费，不保存答案或 AI 返回作为响应缓存。PostgreSQL 用户行锁、
  唯一约束和单进程互斥锁共同覆盖并发结算；SQLite 测试栈也保持同样结果。
- DeepSeek 继续强制 `thinking: {type: "disabled"}`、JSON mode、`max_tokens=4096`、
  `finish_reason=stop`、Pydantic 校验和内容策略校验；二答 `sourcePart` 明确要求当前
  Part 的数字 1/2/3，避免真实模型把字符串或 0 当作合法值。
- 第一次真实公网二答探针确实捕获过 `memoryCandidates.0.sourcePart` 的非数字返回，
  被严格校验拒绝并且没有扣额度；补强提示后，后续真实一答/二答均通过。
- DeepSeek 瞬时故障最多两次尝试，退避为 0.25 秒附近的有限 jitter；重试受同一个总
  预算约束，不会出现两次各等待完整 90 秒。401/403/404、未配置、未验证、无权限和
  quota-exceeded 不自动重试；日志只保留阶段、状态、耗时、完成原因、长度、用量摘要
  和字段路径。
- 上游 401/403/404 映射为不可重试的 `upstream-auth` / `upstream-not-found`；429、
  5xx 和超时保持可分类的重试路径。

### 超时预算

| 层级 | 当前预算 |
| --- | ---: |
| DeepSeek connect | 10 秒 |
| DeepSeek read（单次） | 75 秒 |
| DeepSeek write / pool | 10 / 10 秒 |
| DeepSeek 总预算（含一次重试和退避） | 90 秒 |
| Backend 通用 HTTP 客户端上限 | 120 秒（TTS 兼容上限，不覆盖 DeepSeek 的 90 秒总预算） |
| Web / Android Text AI read | 105 秒 |
| Android / Capacitor connect | 最多 10 秒 |
| Cloudflare Proxy Read Timeout | 当前默认 125 秒，长于客户端 105 秒（见 [官方说明](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/)） |

公网健康脚本的 12 秒超时只用于快速存活探针，不是 AI 请求预算。

## 根因、复现测试与修复结果

| 根因 | 修复前可复现的失败路径 | 修复与回归结果 |
| --- | --- | --- |
| R1：二答 Provider 方法丢失 `this` | 页面使用真实 `BackendTextProvider` 提交二答时，在发 HTTP 前抛错 | 页面级测试断言真实二答 endpoint 被调用并解析合法结果 |
| R2：客户端 45 秒早于 Backend 120 秒 | 客户端先超时，Backend 仍可能继续运行，随后重试形成首败次成 | 10/75/90/105 秒分层预算，连接与读取分离，自动重试计入总预算 |
| R3：结构化输出修复未部署 | 生产可能仍开启 thinking、接受截断或未校验 envelope | Backend 镜像按当前工作树重建；严格 JSON、finish reason、schema、策略校验保留 |
| R4：共享 in-flight 静默丢二答 | 一答 pending 时二答直接 return | deferred 测试确认二答先显示等待，再自动执行且只执行一次，两份结果都应用 |
| R5：调用前 consume 扣额 | 502、超时、非法输出也产生 UsageEvent | authorize/settle 分离；失败额度不变，成功只结算一次 |
| R6：无分类重试 | 瞬时网络失败立即结束，或对 401/额度错误无效重试 | Backend 最多两次；客户端最多一次且仅限网络级瞬时错误；UI 隐藏不可重试按钮 |
| R7：二答草稿/选中为空 | 默认勾选显示与实际状态不一致，textarea 无法稳定写入 | corrected 初始化、全部修正句默认选中、编辑和取消选择测试通过 |
| R8：离线文案错误 | 未配置 AI 仍显示“正在整理” | 立即显示本地手动候选，仍可完成练习 |
| R9：Tunnel 离线 | 公网返回 Cloudflare 530/1033 | Docker Backend/PostgreSQL healthy，Tunnel 注册 4 条连接，公网 `/health` 200 |

## 自动化验证

已执行：

- `npm run verify`：类型检查通过；ESLint `--max-warnings=0` 通过；前端 57 个测试
  文件、349 项通过；Backend 86 项通过；Vite production build 通过。
- `npm run android:build`：再次执行 lint、前端测试、Backend 测试、生产构建、Capacitor
  sync、Gradle `assembleDebug`、`testDebugUnitTest` 和 `lintDebug`，全部通过。
- Android API 36 模拟器 instrumentation：`connectedDebugAndroidTest` 2/2 通过。
- 新增/覆盖：真实 Provider 二答绑定、首答 pending 时二答排队、不可重试错误、离线
  fallback、二答修正句默认选中与编辑、客户端稳定幂等头、Backend 429/5xx/timeout/
  非法结构、失败不扣额、并发同 key 只结算一次、日志不含答案或 Authorization。

测试中的非阻断既有告警：PDF 测试的标准字体/损坏 PDF 警告，以及 SettingsController
测试的 React `act` 警告；均未导致失败，也未通过放宽超时掩盖错误。

## 真实服务与额度验收

所有真实调用均使用临时合成账号和短测试文本，命令输出未打印账号、token、答案或
AI 返回；测试账号在每次验收结束后删除。

- 公网 `POST /health/verify`：HTTP 200；DeepSeek `verified`，TTS `verified`。
- 公网一答：HTTP 200，返回恰好 2 个参考回答。
- 同一一答幂等 key 重放：HTTP 200，仍返回合法结构；没有新增额度事件。
- 公网二答：HTTP 200，返回合法 `correctedSentences` / `memoryCandidates` 结构。
- 反馈额度：验收前 `0`，一答成功 + 同 key 重放 + 二答成功后为 `2`，增量为 `2`，
  证明重放没有重复扣费。
- Backend 日志安全扫描：未发现测试答案、`Authorization`/`Bearer`、API key 形态或
  上游鉴权头；只保留安全诊断摘要。

## Backend / Tunnel 实际状态

当前运行的是本机 Windows Docker Desktop，不是目标家庭 Linux 主机。容器状态：

- `ielts-speaking-meow-postgres-1`：healthy；
- `ielts-speaking-meow-backend-1`：healthy，镜像按本次工作树重建；
- `ielts-speaking-meow-cloudflared-1`：running，Tunnel ingress 为
  `api.formomentward.com → http://backend:8000`，日志显示 4 条已注册连接。

公网 `https://api.formomentward.com/health` 当前返回 `status=ok`、`version=2.1.10`，
DeepSeek 最近业务请求为 `succeeded`，DeepSeek/TTS verification 均为 `verified`。

## APK 交付物

- 路径：[ielts-speaking-meow-v2.1.10-debug.apk](<D:\111-Trae_project\雅思喵\雅思口语喵\artifacts\ielts-speaking-meow-v2.1.10-debug.apk>)
- 包名：`com.ieltsspeakingmeow.app`
- `versionCode`：`18`
- `versionName`：`2.1.10`
- 大小：`48,555,763` bytes
- SHA-256：`0c13caaf54ff3eb4a4869be2bf93c1167a419977be2c87c9489950bccbf78a16`
- 签名：Android Debug；APK Signature Scheme v2 `true`
- 签名证书 SHA-256：`036321a5e330c02eb745553610e25cab26d1f92a93ecf4aa068676c4bf9789eb`

本次交付的是 Debug APK；没有创建 Release APK，因为仓库没有可用的正式签名配置，
不会用 Debug 证书冒充正式包。

## 尚未完成与原因

1. 没有真实 Android 物理设备可用，因此无法宣称移动网络/真机 UI 的最终验收；已完成
   API 36 模拟器 instrumentation 2/2，真实公网 API 则通过独立 HTTP E2E 验证。一次
   后续模拟器启动轮询未返回设备状态，未计入通过数，也未产生测试失败。
2. 未在目标家庭 Linux 主机执行迁移、备份恢复演练或 Tailscale 验证；当前可访问的
   部署权限仅覆盖本机 Windows Docker Desktop + 现有 Tunnel。Linux 运维文档和 Compose
   配置保留，但不能把本机验证冒充 Linux 生产验收。
3. `organize` 与 `materials/suggest` 仍沿用原有调用前额度语义；本轮成功后结算范围
   是用户明确要求的第一次/第二次反馈链路，未扩大到无关功能。
4. Cloudflare Tunnel 的 token、DeepSeek/TTS/SMTP 凭证从未写入报告、代码或日志；没有
   凭证就不能执行第三方账号或新主机的权限性操作。
5. Android 构建仍会输出仓库原有的 `flatDir`、实验性 `android.overridePathCheck`、
   SDK XML 版本和 Gradle 9 deprecation 警告；本次构建没有因此失败，也未修改无关构建
   链路。
