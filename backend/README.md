# 雅思口语喵 Backend

自建 Backend，提供云端邮箱账号认证，并托管第三方 API（DeepSeek Text AI /
火山引擎 TTS）。
Android 客户端只调用本服务，**任何第三方密钥只存在于本服务的环境变量中**。

V1.7 起不再提供 STT 能力；客户端直接用手机系统键盘语音输入答案文本。
V2.2.1 的 `/v1/feedback` 接受本地 RAG / 长期 Memory / 用户知识库生成的可选
`tutorContext` / `learnerContext` / `userKnowledgeContext`，并按枚举档位生成自然提升版。
Backend 持久化邮箱账号、邮箱验证状态、
Argon2 密码摘要、可撤销会话、一次性账号 token，以及已登录用户的通用增量同步
实体与变更日志；同时提供 free / pro、feature entitlement、周期 quota、用量事件
与未来支付 webhook 的数据模型基础。本版不接入真实支付。

## 架构

```
Android 客户端
    │  POST /v1/auth/register|login                             → 账号数据库
    │  GET  /v1/auth/session / POST /v1/auth/logout|logout-all  → 会话管理
    │  POST /v1/auth/*email-verification                        → 邮箱验证
    │  POST /v1/auth/password-reset/*                           → 密码找回
    │  GET|PATCH|DELETE /v1/me                                  → 资料/能力/注销
    │  POST /v1/sync/push / GET /v1/sync/pull                   → 用户数据增量同步
    │  POST /v1/feedback(Part + 题目 + 答案文本 + 可选作答时间)  → DeepSeek
    │  POST /v1/tts(文本)                                       → 火山语音合成 2.0
    │  POST /v1/organize(导入材料)                              → DeepSeek(题目整理)
    │  POST /v1/knowledge/organize(知识分块)                    → DeepSeek(知识整理)
    ▼
FastAPI Backend(密钥在环境变量,日志脱敏)
    └── SQLAlchemy 2 Async → SQLite(开发) / PostgreSQL(部署)
```

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/v1/auth/register` | JSON `{email, password}`；创建账号并返回 Bearer token、绝对过期时间和用户信息 |
| POST | `/v1/auth/login` | JSON `{email, password}`；校验后创建一条新的可独立撤销会话 |
| GET | `/v1/auth/session` | `Authorization: Bearer <token>`；恢复当前用户和会话过期时间 |
| POST | `/v1/auth/logout` | `Authorization: Bearer <token>`；仅撤销当前 token，成功返回 204 |
| POST | `/v1/auth/request-email-verification` | 需要 Bearer token；向当前未验证账号发送验证邮件，成功返回 204 |
| POST | `/v1/auth/confirm-email-verification` | 公开；JSON `{token}`；消费一次性 token 并标记邮箱已验证，成功返回 204 |
| POST | `/v1/auth/password-reset/request` | 公开；JSON `{email}`；无论邮箱是否存在、邮件是否配置/成功都统一返回 204 |
| POST | `/v1/auth/logout-all` | 需要 Bearer token；撤销当前用户全部会话，成功返回 204 |
| GET | `/v1/me` | 当前身份、billing 状态和各 feature 的启用原因、周期、用量、剩余额度 |
| PATCH | `/v1/me` | JSON `{displayName}`；更新当前账号昵称 |
| DELETE | `/v1/me` | JSON `{password}`；注销并匿名化账号、撤销会话、清除该用户云端同步数据 |
| POST | `/v1/auth/password-reset/confirm` | 公开；JSON `{token, newPassword}`；修改密码并撤销该用户全部现有 session，成功返回 204 且不自动登录 |
| POST | `/v1/sync/push` | `Authorization: Bearer <token>`；批量幂等提交本地变更 |
| GET | `/v1/sync/pull?cursor=0&limit=200` | `Authorization: Bearer <token>`；按单调 cursor 增量拉取，limit 范围 1–500 |
| GET | `/health` | 存活 + DeepSeek / TTS 详情:密钥是否配置、模型 / 音色、最近一次真实调用的验证状态(verified / unverified / failed + 时间),不含密钥 |
| POST | `/health/verify` | 需要 Bearer token；真实小规模验证 DeepSeek 与 TTS 上游 |
| POST | `/v1/feedback` | 需要已验证邮箱的 Bearer token；JSON `{part, question, answer, answerDurationSeconds?, tutorContext?, learnerContext?, userKnowledgeContext?, naturalUpgradeLevel?, spokenEnglishStyle?}` → 文本分析结构（含来源校验后的 `contextReferences`） |
| POST | `/v1/feedback/second-attempt` | 需要已验证邮箱的 Bearer token；JSON `{part, question, answer}` → 仅包含错误后的完整句修正和可确认的个人信息候选，不读取第一答、RAG 或 Memory |
| POST | `/v1/tts` | 需要 Bearer token；JSON `{text, language?, rate?, pitch?}` → `audio/mpeg` 二进制；rate/pitch 映射火山 speed_ratio / pitch_ratio(0.5–2.0) |
| POST | `/v1/organize` | 需要 Bearer token；JSON `{fileName, extractedText}` → `{questions: [...]}` |
| POST | `/v1/knowledge/organize` | 需要已验证邮箱的 Bearer token；JSON `{fileName, sourceHash, chunks[]}` → `{entries: [...]}`；最多 24 个分块 / 48,000 字符 |

统一错误格式：`{"error": {"code": "...", "message": "..."}}`。主要错误码：
`not-configured`(503) / `provider-error`(502) / `upstream-timeout`(504) /
`invalid-request`(400) / `invalid-account-token`(400) / `rate-limited`(429) /
`quota-exceeded`(429) / `email-not-verified`(403) / `account-inactive`(403) /
`upstream-auth`(502) / `upstream-not-found`(502) /
`email-already-registered`(409) / `invalid-credentials`(401) / `invalid-session`(401)。

注册和登录返回：

```json
{
  "accessToken": "仅在本次响应返回的随机 token",
  "tokenType": "Bearer",
  "expiresAt": "2026-09-20T00:00:00Z",
  "user": {
    "id": "...",
    "email": "learner@example.com",
    "emailVerified": false,
    "displayName": null,
    "status": "active",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

服务端只保存 token 的 SHA-256 摘要，数据库泄漏时不能直接取出可用 token。
每次登录创建独立会话，普通退出只撤销当前会话；`logout-all` 可撤销该账号全部
会话。当前没有滑动续期或 refresh token。

## DeepSeek 超时与重试

反馈和二答分析使用分层预算：连接 10 秒、单次读取最多 75 秒、整个 Backend
请求最多 90 秒，最多两次上游尝试并带 0.25 秒量级的抖动退避。Android/Web
客户端给该请求 105 秒总预算，原生请求的连接超时仍限制在 10 秒；因此客户端
不会在 Backend 已完成上游重试后再叠加一次 90 秒请求。客户端只对带稳定
`X-Idempotency-Key` 的网络级瞬时失败自动重试，401/403/404、额度不足和
服务端已经分类的上游错误交由用户按提示处理。

反馈额度在 DeepSeek 返回、结构校验和内容策略校验全部成功后才结算；超时、
限流、非法 JSON、字段缺失或策略违规不会扣费。日志只保留 request id、延迟、
失败阶段和安全的长度/用量摘要，不保存答案正文、AI 返回、Authorization 或密钥。

## 账号能力、额度与生命周期

`GET /v1/me` 是客户端展示身份和商业能力的唯一真实来源。当前默认 free plan，
并为 feedback、organize、TTS 字符数、provider verify 配置独立周期 quota。
邮箱未验证或账号非 active 时 capability 会返回明确原因，受保护能力不会执行。

同一个 `Idempotency-Key` 的成功请求重试不会重复计费。为避免在 Backend 保存私人
答案或 AI 响应，重试会再次调用上游但只产生一条 `UsageEvent`；客户端必须只在同一
逻辑请求中复用 key。用量由服务端事务写入，不信任客户端计数。pro、entitlement override、
subscription 状态和 webhook 去重/审计表已预留，但本版没有支付入口。

删除账号必须再次校验密码。服务端会撤销全部会话、清除该用户的同步实体、变更日志
与用量数据，并匿名化账号身份；客户端本地离线数据不会被后端远程删除，用户仍可在
本机自行管理。

## 邮箱验证与密码找回

账号操作 token 使用至少 256 bit 安全随机数（当前为 URL-safe 43 字符），数据库
只保存 SHA-256 摘要。`purpose` 严格区分 `verify_email` 和
`reset_password`；同一用户申请同用途的新 token 时，旧 token 立即失效。确认时
由数据库条件原子声明 token，保证只能使用一次，并同时检查绝对过期时间。

邮件正文同时提供：

- 从固定 `APP_ACCOUNT_URL` 生成的 HTTPS 链接；
- 可复制粘贴到 App 的完整原始 token。

链接只使用部署配置，绝不读取或拼接 HTTP `Host` header。原始 token 仅在生成后
短暂存在于进程内和发信内容中，不进入数据库、响应、日志或异常文本。邮箱验证
默认有效 24 小时，密码重置默认有效 1 小时，均可通过环境变量调整。

`EmailSender` 是可替换端口。内置 SMTP 实现支持 STARTTLS 与隐式 SSL，发送在
工作线程执行，不阻塞 FastAPI 事件循环。SMTP 或 `APP_ACCOUNT_URL` 未完整配置时
使用明确的 disabled 实现：认证后的验证邮件请求返回 `not-configured`；公开密码
找回请求仍固定返回 204，避免泄露邮箱是否存在或邮件服务状态。SMTP 日志不记录
token、完整邮箱或上游异常正文。

实现基线遵循 OWASP 的
[Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
与
[Email Validation and Verification Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Email_Validation_and_Verification_Cheat_Sheet.html)：
找回请求先返回统一 204，再在后台查找账号和发信；token 使用 CSPRNG、足够长度、
服务端安全存储、用途绑定、单次使用和绝对过期。

## 云同步协议

同步接口只接受邮箱账号登录得到的 opaque Bearer session。实体归属始终取自当前
session，服务端不会信任客户端提交的用户 ID；`payload` 顶层如果包含
`ownerId` 会在写入前被移除。

支持的 `entityType`：

- `session`：练习记录；
- `expression`：个人语料；
- `personal_material`：个人素材；
- `imported_question`：用户导入题目的结构化题目（不含原始文件）；
- `import_source_metadata`：导入来源元数据（不含完整提取文本和 Blob）；
- `question_exclusion` / `question_bank_exclusion`：题目和整季题库的账号隔离删除状态；
- `knowledge_source` / `knowledge_entry`：已确认的个人知识库来源和条目（不含原始文件）；
- `user_setting`：按云账号同步的生成/显示偏好；客户端仍通过本地 ownerId 隔离。

Push 请求最多包含 100 项：

```json
{
  "items": [
    {
      "operationId": "device-operation-uuid",
      "entityType": "expression",
      "entityId": "expression-uuid",
      "baseVersion": 0,
      "payload": {"text": "It helps me unwind."},
      "deletedAt": null
    }
  ]
}
```

新实体使用 `baseVersion: 0`；更新和删除必须提交客户端最后看到的服务端版本。
应用成功后版本加一，并分配新的 change cursor。删除不是物理删除：客户端提交
`deletedAt` 后，服务端保留带新版本的墓碑，其他设备可通过 pull 删除本地副本。

每项独立返回：

- `applied`：已写入，返回新 `version` 和 `cursor`；
- `conflict`：`baseVersion` 落后，返回 `version-conflict` 和当前服务端实体；
- `rejected`：同一用户把已有 `operationId` 用于不同内容，返回
  `operation-id-reused`。

相同用户用相同 `operationId` 重试同一操作时，服务端返回首次结果并标记
`replayed: true`，不会重复增加版本或写入 change log。同一个批次内的冲突不会
阻止其他合法项应用。同一用户的 push 在数据库事务内串行化，避免 change cursor
因并发提交乱序而被客户端跳过。

Pull 响应示例：

```json
{
  "changes": [
    {
      "cursor": 42,
      "entityType": "expression",
      "entityId": "expression-uuid",
      "version": 2,
      "payload": {},
      "deletedAt": "2026-08-21T10:00:00Z",
      "updatedAt": "2026-08-21T10:00:00Z"
    }
  ],
  "nextCursor": 42,
  "hasMore": false
}
```

客户端应保存 `nextCursor`，持续拉取直到 `hasMore` 为 false，再提交后续本地
outbox。冲突不会由服务端静默覆盖；客户端应先采用 `current` 刷新本地基线，再用
新的 `operationId` 和 `baseVersion` 明确重试。

## DeepSeek 反馈约束

- 角色：友好的 IELTS Speaking Tutor；
- 只分析答案文本：语法、词汇、连贯性、表达自然度、是否切题、内容展开；
- 优先指出最重要的问题，不过度纠错；
- 修改表达时保持用户原本水平和表达习惯，不突然拔高到难以模仿的高级英语；
- 每个答案返回恰好 2 个参考回答：简单优化版 / 自然提升版；简单优化版只基于
  用户原答案，自然提升版才结合当前题相关 RAG、统一 Memory、个人素材和必要的 AI 示例；
- 自然提升版由服务端控制简单 / 中等 / 较难档位和英式 / 美式自然口语规则；Part 1/3 是
  弹性短回答，Part 2 是独立的一到两分钟长回答。`contextReferences` 只能引用请求中实际
  提供且服务端验证过的 ID，AI 示例必须标记为可替换。
- 自然提升版额外返回可添加内容、进阶修改建议和“本题要点”句式框架；
- 第二次回答通过独立接口分析，只返回真实错误的完整句修正和明确个人信息候选，
  客户端必须在用户确认后分别保存到个人语料或统一 Memory；
- 不评价 Pronunciation、语速、停顿、语调；不给出 IELTS Band 分数或水平评分。

## 安全基线

- 日志过滤器屏蔽第三方 API Key 与供应商凭证；
- 密码使用 Argon2，绝不复用客户端本地 PIN 的快速哈希；
- 会话 token 使用 256 bit 安全随机数，服务端只保存 SHA-256 摘要；
- 邮箱验证/密码重置 token 同样使用 256 bit 安全随机数、用途隔离、绝对过期和
  单次消费；
- 会话由服务端校验绝对过期时间并支持立即撤销；
- 密码重置成功后撤销该用户全部现有 session，且不会自动创建新 session；
- `/v1/me`、AI/TTS、provider verify 与同步接口都要求有效 Bearer session；
  云端数据和上游能力还要求邮箱已验证；普通 `/health` 和根连接页保持公开；
- TTS 音频响应只允许当前客户端私有缓存，不允许共享缓存保存用户文本对应音频；
- 所有上游调用带超时；
- 可选内存滑动窗口限流负责突发保护；持久化 feature quota 负责套餐用量控制。

## 本地运行

```bash
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements.lock.txt # 已验证的可复现版本
cp .env.example .env                            # 填入真实密钥(不要提交 .env)
.venv/Scripts/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

开发默认使用 `./data/ielts_cat.db`。应用启动时自动执行 Alembic `upgrade head`；
已有旧数据库会补充缺失字段和表并保留账号数据，内存测试数据库才使用
SQLAlchemy metadata 直接建表。也可在部署前显式执行：

```bash
.venv/Scripts/python -m alembic upgrade head
```

部署到
PostgreSQL 时设置：

```dotenv
DATABASE_URL=postgresql+asyncpg://user:password@host:5432/ielts_cat
AUTH_SESSION_TTL_SECONDS=2592000
EMAIL_VERIFICATION_TOKEN_TTL_SECONDS=86400
PASSWORD_RESET_TOKEN_TTL_SECONDS=3600
APP_ACCOUNT_URL=https://api.example.com
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=mailer-user
SMTP_PASSWORD=replace-with-secret
SMTP_FROM=no-reply@example.com
SMTP_TLS_MODE=starttls
```

也接受托管平台常见的 `postgresql://` / `postgres://`，启动时会自动切换到
`asyncpg`。SMTP 使用 Python 标准库 `smtplib` + `ssl`，无需额外依赖。数据库迁移
已覆盖新库和 V1.8 早期未版本化的账号库；部署前仍应备份生产数据库。

Windows 下也可以直接**双击 `start.bat`** 启动(监听 0.0.0.0，供同一 WiFi 的手机
访问；首次启动防火墙弹窗请点「允许访问」)。

测试：`.venv/Scripts/python -m pytest`（认证使用内存 SQLite，DeepSeek/TTS 用
MockTransport，不需要真实数据库、上游服务或密钥）。

## 家庭 Linux 生产部署

生产环境统一使用仓库根目录的 Docker Compose：PostgreSQL 与 Backend 在私有网络
运行，Backend 默认不映射宿主机端口；公网 App 流量通过 Cloudflare Tunnel 的
outbound-only HTTPS 通道进入，Tailscale 只用于管理员 SSH/维护。不要在路由器上
直接开放数据库或 8000 端口。

完整的首次部署、域名/Tunnel 人工步骤、升级、自动恢复、备份、校验和恢复演练见
[`docs/DEPLOY_HOME_LINUX.md`](../docs/DEPLOY_HOME_LINUX.md)。本机调试可叠加
`compose.local.yaml`，它也只监听 `127.0.0.1:8000`。

## 已知生产限制

- 未实现邮件模板品牌化、HTML 版本、发送队列和退信处理；这些不影响当前纯文本
  SMTP 验证/找回闭环；
- 前端 outbox、cursor、逐实体版本基线和 Android Keystore 会话存储已经实现；
  账户页已通过邮箱验证与逐次勾选接入手动上传/恢复，不做后台自动上传。首次迁移
  会过滤未提交草稿、Memory 快照、原始录音、导入文件、语音缓存和密钥；
  冲突会停止覆盖并保留本机资料，但尚未提供丰富的逐条合并决策界面；
- Memory 仍应从同步后的练习、反馈、个人语料等事实数据派生，不单独同步第二份
  易失真的 Memory 快照；
- 尚未在真实 PostgreSQL 服务上做迁移集成测试；当前自动化覆盖 SQLite 新库与
  未版本化旧库的无损升级；
- 已有账户页同步状态、手动重试和冲突保护；尚未实现逐条合并决策、多设备离线同时
  编辑的端到端验收，以及正式的同步历史审计页。

## TTS 说明

- 未选择预设时沿用 `.env` 中的 `VOLC_TTS_SPEAKER` 与资源配置；
- App 提供 Dave、Corey 两个英式男声，以及 Daisy、Onez、Emily 三个英式女声预设；
  这些预设由 Backend 白名单校验，并按音色切换兼容的资源版本；
- 音色需在控制台开通，未开通会返回上游错误，App 会自动回退系统 TTS；
- 音色配置只写在 Backend `.env`，App 不接触任何密钥。
