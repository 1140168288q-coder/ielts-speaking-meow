# V2.0 产品与技术架构

本文记录 V2.0 的稳定边界、数据所有权和扩展点。它不是愿望清单；“当前实现”和
“未来预留”会明确区分，后续修改应同步更新本文和自动化测试。

系统总图源文件：[v2-architecture.mmd](./assets/v2-architecture.mmd)。

> 图源已通过本地声明、子图与括号平衡检查。当前开发机没有 Mermaid CLI，且出于
> 隐私原因没有把内部拓扑上传到第三方渲染服务，因此仓库暂不提交远程生成的 SVG。

## 1. 稳定产品主链路

```text
结构化季度题库
→ 听题
→ 用户用系统键盘语音输入或手动输入答案文本
→ 可选手动计时
→ 本地规则 + 教学 RAG + 该账号长期 Memory
→ 精简 AI 反馈（优先 2–3 点）
→ 对照、试听简单优化版和自然提升版
→ 插入自己的可复用素材
→ 第二次回答
→ 保存值得再次说出口的表达/素材
```

约束：

- 不恢复 App 内录音、STT、发音评价或 Band Score；
- 没有 Backend、DeepSeek 或 AI TTS 时，题库、输入、计时、本地规则、历史、
  System TTS 和个人素材仍可用；
- 第二次回答不是附加功能，而是训练闭环的核心；
- AI 输出必须保持用户原有水平和表达习惯，不把口语改成作文。

## 2. 分层与依赖方向

| 层 | 当前职责 | 禁止 |
|---|---|---|
| React features | 页面、流程、可访问交互、状态展示 | 直接调用第三方模型 |
| application | 练习、账号、同步、素材、备份等用例 | 依赖具体 vendor 响应 |
| domain | Zod 数据契约、Memory/RAG、纯规则 | 访问浏览器或网络 |
| ports | LocalStorage、BackendClient、LLM/TTS provider | vendor 特有字段 |
| infrastructure | IndexedDB、FastAPI client、TTS provider | 把密钥写入客户端 |
| Backend | Auth、sync、quota、AI/TTS 代理、邮件 | 信任客户端 ownerId |

React 只通过运行时组合得到服务。Backend 是客户端访问 DeepSeek 与火山引擎的唯一
路径；第三方 key 永远不进入 APK。

## 3. 本地账号与云账号

### 本地身份

- 每个本地账号有稳定 `userId`；
- IndexedDB 中练习、表达、个人素材都带 `ownerId`；
- 所有 list/get/update/delete 用例都再次校验当前 owner；
- V1.8 之前没有 owner 的数据只迁移给“本机用户”；
- PIN 只防止误切换，不是加密或云端密码。

### 云端身份

Backend `users` 是云端权威身份：

- 邮箱规范化后唯一；
- Argon2 密码摘要；
- 邮箱验证状态；
- active / suspended / deleted 生命周期；
- opaque 256-bit session token，服务端只保存 SHA-256 摘要；
- 单设备退出、全设备退出；
- 修改昵称；
- 输入当前密码后删除云端账号与个人云数据。

本地账号与云账号通过显式 binding 关联。登录不会自动上传资料；用户必须在账号页
勾选并确认同步。这样能避免“只是登录一下就把整机历史发送到云端”。

### 多用户隔离

```text
请求 Bearer token
→ AuthSession token_hash
→ User.id
→ 所有云端实体按 User.id 查询/写入
→ 客户端 payload 中的 ownerId 被移除
```

Backend 不使用客户端传来的 ownerId 决定数据归属。同步实体的组合身份始终包含
服务端认证用户。

## 4. 本地持久化数据

| 数据 | 默认位置 | owner 隔离 | 进入云同步 |
|---|---|---:|---:|
| 题库生成物 | APK 静态 JSON | 不需要 | 否 |
| 导入题/原始文件 | IndexedDB/本机 | 是 | 当前否 |
| 练习与两次答案 | IndexedDB | 是 | 用户确认后 |
| AI 反馈 | 随练习保存 | 是 | 随练习 |
| 个人表达 | IndexedDB | 是 | 用户确认后 |
| 个人素材 | IndexedDB | 是 | 用户确认后 |
| 偏好设置 | IndexedDB appMeta | 是 | 当前按设备；协议预留 user_setting |
| TTS 缓存 | IndexedDB | 间接 | 否 |
| V1.6 历史录音 | IndexedDB | 是 | 否，只保留兼容读取 |
| Memory 快照 | 不单独存 | 是 | 否，从事实重新派生 |
| 云同步 outbox/cursor | IndexedDB | scope 隔离 | 协议内部 |

删除练习、表达和素材会保留 tombstone，确保其他设备可以应用删除；相同删除时间的
重试幂等，不会无意义增加版本。

## 5. 教学 RAG

当前 RAG 是小型、本地、可版本化语料，不使用 embedding API 或向量数据库。

`TUTOR_KNOWLEDGE_VERSION = 2026.08-v2`，条目包含：

- Part 1/2/3 结构策略；
- 时态、冠词、主谓一致、连接与自然修正；
- 词汇释义、搭配、具体动词；
- 科技、环境、工作学习、交通、文化媒体、健康等高频主题；
- `product-authored` / `official-guidance` 来源类型；
- 官方来源 URL（只用于审计，不在运行时请求）；
- `reviewedAt`。

检索规则：

1. 过滤到当前 Part 或通用条目；
2. Part 匹配提供基础分；
3. topic / prompt / category 与 keywords、tags、正文词汇重叠加权；
4. 确定性排序并只取最多 3 条；
5. 发送给 Backend 的 tutorContext 保持紧凑，不包含题库全文或用户历史。

题库更新和教学知识更新相互独立：换季度只运行题库导入器；改变教学原则才升级
RAG version。

## 6. 长期 Memory 与个人素材

Memory 不另存一份容易失真的“用户画像”，而是每次从当前账号的事实数据派生：

- 完成练习数与同主题练习数；
- AI feedback 中反复出现的问题；
- 用户保存并复用过的表达；
- 用户确认的个人素材；
- 最近相关练习；
- reuseCount 等真实行为。

复用排序：

```text
同一题关联 > 同 topic/tag > 题目关键词相近 > 通用可复用
```

隐私偏好：

- `memoryEnabled=false`：训练页不构建长期 Memory；
- `autoMatchPersonalMaterialsWithAi=true`（默认）：AI 分析时自动匹配当前题最相关的
  个人素材；用户关闭后仍可在本地查看和手动插入素材；
- 统一 Memory 作为个性化大脑：优先当前 Part/主题，其他 Part 只有确认适用、相关且
  不冲突时才加入上下文；UI、保存和云同步仍保留每条数据的 sourcePart；
- 从不发送其他账号、完整历史、原始导入文件、历史录音、TTS 缓存或密钥；
- learnerContext 有明确长度预算，避免提示词膨胀和隐私过度收集。

用户把素材插入第二次答案时，系统增加 reuseCount；Memory 因真实使用自然更新。

## 7. AI 反馈契约

客户端与 Backend 都用运行时 Schema 校验：

- `summary`；
- `strengths`；
- `problems`（2–3 个最值得改的点）；
- `grammarSuggestions`；
- `vocabularySuggestions`；
- 恰好两个 `referenceAnswers`，标签顺序固定为：简单优化版 / 自然提升版；
- `naturalUpgradeSuggestions`（可添加内容、进阶修改建议）和 `answerFramework`；
- 第二次回答使用独立分析契约，只返回真实错误的完整句修正和待确认 Memory 候选。

服务端还会做内容策略校验：

- 拒绝 Band / score / 水平评级；
- 拒绝针对文本虚构发音、语速、停顿、语调等结论；
- 拒绝错误标签、版本数和非法结构。

UI 的 focused 模式默认优先展示 2–3 点，其余内容折叠；expanded 模式由用户设置。

## 8. TTS 与全局音频焦点

```text
AudioCoordinator
├─ natural-first：Backend AI TTS → 失败时 System TTS
└─ system：直接 Android System TTS
```

- 全局同时只有一个播放；
- 播放 B 前停止 A；
- 同一按钮再次点击立即停止；
- 长音频支持 loading / playing / paused / stopped；
- AI 音频提供真实总时长、当前时间、进度、暂停、继续和 seek；
- System TTS 能力不支持真实 duration/seek 时，界面按 capability 降级；
- 语速偏好写入实际 TTS request；
- 固定文本按 provider/voice/rate/config version 缓存；
- Backend TTS 响应禁止共享缓存。

## 9. 云同步协议

支持实体：`session`、`expression`、`personal_material`、预留
`user_setting`。

Push：

- 每个本地操作有稳定 operationId；
- 新实体 `baseVersion=0`；
- 更新/删除提交最后看到的云端 version；
- 相同 operationId + 相同内容重试返回 replay；
- 相同 operationId + 不同内容被拒绝；
- 版本落后返回 conflict 和 current，不静默覆盖。

Pull：

- 单调 cursor；
- 分页拉取直到 `hasMore=false`；
- 冲突时本地内容和 outbox 保留；
- 只有远端版本可安全应用时才更新本地基线；
- 下载实体重新绑定到当前本地 ownerId。

当前同步是账号页手动触发；没有后台自动上传。偏好对应的 `user_setting` 协议已经
预留，但 V2 当前仍以“每台设备可独立选择隐私和外观”为准，不假装已跨设备同步。

## 10. 商业化预留

Backend 已有独立商业模型，不把付费状态塞进 users 表：

- `AccountBillingState`：plan、subscription status、周期；
- `EntitlementOverride`：按 feature 临时开启/关闭、无限或自定义额度；
- `UsageCounter`：用户 + feature + 周期聚合；
- `UsageEvent`：request ID、idempotency key、units；
- `WebhookEvent`：未来支付 webhook 的幂等入口。

Feature keys：

- sync；
- feedback；
- organize；
- tts（按字符）；
- provider_verify。

free plan 额度来自环境变量；pro 默认可扩展为不限量。所有受控调用先检查邮箱验证、
账号状态、entitlement 和剩余额度，再调用上游。客户端 `/v1/me` 只展示服务端计算
后的 capability，不自行猜测 plan 权限。

本次没有支付、购买页、真实订阅或 webhook provider。未来接入支付时应只新增：

1. provider checkout / portal；
2. 签名 webhook adapter；
3. 写入 billing state / entitlement；
4. UI 购买入口。

不需要重构 Auth、User、quota 或业务 API。

## 11. 家庭部署边界

正式部署使用：

- FastAPI 非 root、read-only 容器；
- PostgreSQL 独立持久 volume；
- DB 只在 Docker private network；
- Backend 不发布宿主机端口；
- cloudflared 用只读 secret 文件；
- Backend 与 cloudflared 仅因调用第三方服务连接 egress 网络；
- restart policy + healthcheck；
- PostgreSQL custom-format 备份和显式确认恢复；
- Cloudflare Tunnel 公网访问；
- Tailscale 维护。

完整操作见 [DEPLOY_HOME_LINUX.md](./DEPLOY_HOME_LINUX.md)。

## 12. 低成本更新点

### 换季度题库

```bash
npm run question-bank:update -- "/path/to/new-quarter.pdf"
npm run verify
```

只修改解析器适配版式，不在 UI 手填季度题。

### 换 AI / TTS provider

保持 `LLMProvider`、`TTSProvider` 和 Backend response contract；vendor 字段只留在
对应 infrastructure/service 内。

### 换服务器/IP

保留 HTTPS 域名和 Tunnel route，恢复数据库与环境文件即可。Android 只配置统一
Backend base URL，不依赖家庭 IP。

### 增加支付

沿用 billing/entitlement/usage/webhook 模型，不改变本地 ownerId 或云同步协议。

## 13. 明确未完成或不做

- 不做完整 IELTS 模拟考试、实时 AI 考官和官方评分；
- 不上传或分析录音；
- 不做后台自动同步；
- 不做支付；
- 不把 Memory 变成不可解释的长期摘要黑盒；
- Android App Links 仍需要实际域名、release 证书指纹和
  `assetlinks.json` 后才能安全启用；当前邮箱凭证复制粘贴流程可用；
- Docker Compose 已做 YAML 静态解析，但当前 Windows 开发机没有 Docker/Bash，
  必须在目标 Linux 上执行 `docker compose config`、镜像构建与备份恢复演练。
