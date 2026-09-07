# DeepSeek AI 分析可靠性修复执行方案

日期：2026-09-04  
目标版本：建议 `2.1.10`（最终版本号由执行前确认）  
执行目录：`D:\111-Trae_project\雅思喵\雅思口语喵`  
目标读者：接手实现、验证和交付的编码 Agent（Luna）

## 1. 修复目标

本次只修复第一次回答和第二次回答的 AI 分析可靠性，以及本轮审查发现的直接
相关缺陷。完成后必须满足：

1. 第一次回答在 Backend 和 DeepSeek 正常时能够稳定返回结构化分析；
2. 第二次回答能够真实发出请求，失败后重试有效；
3. 第一次分析仍在运行时，第二次分析不会被静默丢弃或覆盖；
4. 暂时性网络、超时、限流和非法模型输出具有明确、有限且可观察的恢复路径；
5. 失败请求不消耗用户反馈额度，同一次逻辑请求的重试最多计费一次；
6. 二答修正句默认选中且可以编辑，最终只保存用户确认后的内容；
7. Backend、Cloudflare Tunnel 和 Android 客户端的超时与部署状态一致；
8. 不丢失第一次或第二次答案，不削弱离线训练能力，不记录答案正文到日志；
9. 不恢复 STT、应用内录音、发音评价、Band Score 或真实支付。

## 2. 已确认基线

执行前先确认以下状态，不要使用 `git reset --hard`、`git checkout --` 或覆盖用户
工作：

- 当前本地分支：`codex/v2-product-refactor`；
- 当前本地 HEAD：`146f718 fix: restore DeepSeek structured feedback`；
- GitHub 远端该分支当前为 `f292039`，本地修复尚未推送；
- 仓库中的 `2.1.9` Debug APK 构建于 2026-09-01，早于 `146f718`；
- 2026-09-04 检查 `https://api.formomentward.com/health` 时返回 Cloudflare
  `530 / Error 1033`，表示 Tunnel 未连接；
- 当前源码基线验证：TypeScript、ESLint、生产构建通过，前端 57 个测试文件
  338 项通过，Backend 76 项通过；
- 测试全绿不代表问题不存在：现有二答流程测试使用无 `this` 依赖的 mock，未覆盖
  页面与真实 `BackendTextProvider` 的组合，也未覆盖 45 秒以上响应、并发分析和
  失败计费。

开始工作时记录但不要泄露：

```text
git status --short
git branch -vv
git log --oneline -5
```

如果工作区出现与本方案无关的用户修改，保留并绕开；存在重叠时先报告，不要覆盖。

## 3. 根因与目标行为

| 编号 | 根因 | 当前表现 | 目标行为 |
| --- | --- | --- | --- |
| R1 | `getSecondAttemptAnalysis` 被取出后以普通函数调用，丢失 Provider 的 `this` | 二答在发出 HTTP 请求前失败，重试必然再次失败 | 始终通过 Provider 实例调用；真实 Provider 集成测试可观察到二答请求 |
| R2 | 客户端文本 AI 超时 45 秒，Backend 上游超时 120 秒 | App 先报超时，Backend 可能仍运行；用户重试形成首败次成 | 建立分层、可配置、内外一致的超时预算 |
| R3 | 已修复的结构化输出逻辑只存在本地提交，未部署 | 生产可能仍默认开启思考、缺少输出上限和完成原因检查 | 部署 `146f718` 或其等价实现，保留严格双端校验 |
| R4 | 所有 AI 分析共用 `aiRequestInFlightRef` | 一答未结束时二答请求被静默丢弃 | 二答明确排队或使用独立状态，任何请求都不能静默消失 |
| R5 | `consume_feature` 在 DeepSeek 调用前提交额度 | 超时、502、非法 JSON 仍扣额度；重试再次扣 | 先授权，成功校验后原子结算；相同逻辑重试只结算一次 |
| R6 | POST 请求没有受控重试，UI 也没有使用 `retryable` | 一次瞬时故障立即失败；不可重试错误仍展示重试 | 只对允许的暂时性错误有限重试，其他错误给出明确下一步 |
| R7 | 二答修正草稿和选中索引初始化为空 | “默认勾选”与实际不符；textarea 编辑不会写入 | 分析到达时初始化草稿和默认选中项，编辑后按用户值保存 |
| R8 | AI 未配置时保存二答仍显示“正在整理” | 离线状态提示矛盾、可能长期停留 | 立即进入明确的本地手动候选模式 |
| R9 | 当前 Cloudflare Tunnel 离线 | 所有公网云端能力失败 | Backend、数据库、Tunnel 均健康，公网 `/health` 稳定返回 200 |

## 4. 修改范围

优先检查并仅在需要时修改：

### 客户端

- `src/features/practice/PracticeFlow.tsx`
- `src/features/practice/stages/ReviewFirstStage.tsx`
- `src/features/practice/stages/SubmitCorpusStage.tsx`
- `src/infrastructure/backend/backendTextProvider.ts`
- `src/infrastructure/backend/backendClient.ts`
- `src/infrastructure/ai/providerErrors.ts`
- `src/application/practiceService.ts`（只有验证到并发持久化覆盖时才改）
- `src/ports/ai.ts`（只有需要传递稳定逻辑请求标识时才改）

### Backend

- `backend/app/services/deepseek_service.py`
- `backend/app/services/http_client.py`
- `backend/app/services/feature_authorization.py`
- `backend/app/routers/feedback.py`
- `backend/app/config.py`
- `backend/app/services/verification.py`
- `backend/.env.example`

### 测试与文档

- `src/features/practice/PracticeFlow.text.test.tsx`
- 新建或扩展 PracticeFlow 与真实 Backend Provider 的集成测试
- `src/features/practice/stages/SubmitCorpusStage.test.tsx`（如不存在则新建）
- `src/infrastructure/backend/backendTextProvider.test.ts`
- `src/infrastructure/backend/backendClient.test.ts`
- `src/application/practiceService.test.ts`
- `backend/tests/test_feedback_router.py`
- `backend/tests/test_me_router.py`
- `backend/tests/test_health.py`
- `backend/README.md`
- 对应版本发布记录

不要顺手重构题库、账号、同步、TTS、RAG、Memory 或视觉系统。

## 5. 实施阶段

### 阶段 A：先补失败测试

所有修复先写能在当前代码上失败的测试，再改实现。

#### A1. 二答真实 Provider 调用

新增页面级集成测试：

1. 使用真实 `BackendTextProvider`；
2. 注入 fake `BackendClient` 或 fake fetch，不访问真实网络；
3. 构造已经保存第二次回答的 session；
4. 点击“重试二答分析”；
5. 断言实际调用 `/v1/feedback/second-attempt`；
6. 返回合法结构后，断言分析被保存并渲染。

该测试必须能捕获未绑定实例方法导致的异常。不要继续只用独立 `vi.fn()` 代替
Provider。

#### A2. 一答未完成时提交二答

使用 deferred promise 模拟第一次分析仍在运行：

1. 保存第一次回答并让 AI promise 保持 pending；
2. 进入第二次回答并提交；
3. 断言二答分析显示“等待一答结束”或独立运行状态，而不是静默返回；
4. 结束第一次 promise；
5. 断言二答分析最终自动执行且只执行一次；
6. 断言最终 session 同时保留 `aiFeedback` 和 `secondAttemptAnalysis`。

如果测试证明两个并发 `requireSession -> upsertSession` 会发生最后写入覆盖，优先选择
“二答排队等待一答完成”的简单方案；只有确实需要并行时才为 session 写入增加串行化。

#### A3. 二答修正句交互

覆盖：

- AI 返回两条修正句后默认均选中；
- textarea 默认显示 `item.corrected`；
- 修改任意一条后输入值稳定保留；
- 取消一条勾选后只提交另一条；
- Memory 候选仍保持默认不选，必须由用户确认；
- 分析结果更换或 attempt 改变时，草稿和选中状态正确重置。

#### A4. 错误与重试分类

覆盖以下错误：

| 错误 | 是否自动重试 | UI 是否允许手动重试 |
| --- | --- | --- |
| 网络中断 | 是，最多一次 | 是 |
| Backend/DeepSeek 超时 | 是，最多一次 | 是 |
| HTTP 429 | 是，遵守有限退避 | 是 |
| HTTP 500/502/503/504 | 是，最多一次 | 是 |
| 401/邮箱未验证 | 否 | 否，提示重新登录或验证 |
| 403/能力未开通 | 否 | 否 |
| quota-exceeded | 否 | 否，展示额度说明 |
| DeepSeek key 无效或未配置 | 否 | 否，提示管理员检查配置 |
| AI 字段或内容策略校验失败 | Backend 可做一次受控再生成 | 是 |

测试必须使用 fake timers 或 MockTransport，不能依赖真实等待。

#### A5. 额度结算

Backend 增加以下测试：

- DeepSeek 成功并通过 Pydantic/策略校验：额度增加 1；
- 上游超时、401、429、500：额度不变；
- 返回空内容、截断 JSON、字段缺失、策略违规：额度不变；
- 相同逻辑请求标识重试两次且最终成功：额度只增加 1；
- 两个不同逻辑请求各成功一次：额度增加 2；
- 并发相同逻辑请求不能越过唯一性和额度限制；
- 不在 UsageEvent、日志或错误消息中保存答案正文、Authorization 或密钥。

### 阶段 B：修复二答必现错误

在 `PracticeFlow.tsx` 中直接通过 `textAi.getSecondAttemptAnalysis(...)` 调用，或在
读取时显式绑定 `textAi`。优先直接通过实例调用，不新增无必要 abstraction。

同时处理提前返回：

- AI 未配置：设置明确的离线说明，显示手动候选；
- Provider 不支持二答：设置明确说明；
- 答案为空或状态不正确：只在理论上不应发生时返回，并保留诊断信息；
- 请求正在运行：显示正在运行或排队，不允许静默丢弃。

### 阶段 C：修复一答与二答的请求状态

推荐实现“单独状态 + 明确排队”：

- 一答和二答分别维护 generation、busy、note 和当前 promise；
- 允许用户在一答分析后台运行时继续练习；
- 二答提交时若一答仍 pending，二答进入 queued 状态；
- 一答无论成功或失败，settled 后自动启动排队的二答；
- 同一个 attempt 的重复点击只合并为一个逻辑请求；
- session 或答案文本改变后，旧结果不得覆盖新答案；
- 组件卸载后不更新 React 状态，但已保存的答案不得删除。

不推荐简单删除共享锁后让两个结果无约束并发写入，因为当前两个 apply 方法都采用
读取 session 后整体 upsert，可能产生最后写入覆盖。若选择真正并行，必须先写出能
复现覆盖的测试，再实现按 session 串行写入或原子字段合并。

### 阶段 D：统一超时预算

不要继续使用客户端 45 秒、Backend 120 秒的倒挂配置。建议先引入可配置的分层
预算，再根据真实请求数据确定最终值：

```text
DeepSeek connect timeout   < 单次 read timeout
单次 DeepSeek timeout      < Backend 总请求预算
Backend 总请求预算         < Android/Web 客户端 read timeout
公网代理/Tunnel timeout    > Android/Web 客户端 read timeout
```

可作为初始验证值而非永久硬编码：

```text
connect: 10 秒
单次 DeepSeek read: 60-75 秒
Backend 总预算: 90 秒
客户端 read: 100-105 秒
```

要求：

- DeepSeek 与 TTS 使用独立超时设置，不因本次修改改变 TTS 行为；
- Android `connectTimeout` 和 `readTimeout` 分开，不把连接超时也放大到 100 秒；
- 浏览器 fetch 与 CapacitorHttp 的用户可见行为一致；
- 超时错误保留 `retryable=true`；
- UI 持续显示明确进行状态，不能像卡死；
- 自动重试必须计入 Backend 总预算，不能出现两次各等 120 秒；
- 在 `/health` 的 request 诊断中保留安全的 latency、failureStage、finishReason、
  contentLength 和 usage，不记录正文。

### 阶段 E：DeepSeek 受控重试与结构化输出

保留 `146f718` 已完成的行为：

- `thinking: {type: "disabled"}`；
- `response_format: {type: "json_object"}`；
- `max_tokens: 4096` 或经实际结果证明足够的值；
- `finish_reason` 必须是完整成功状态；
- Pydantic 校验、内容策略校验和客户端 Zod 校验全部保留；
- 仍固定返回“简单优化版 / 自然提升版”两个版本；
- 严禁 Band Score 和任何语音表现评价。

只做一次有上限的 Backend 内部重试。推荐可重试范围：

- 网络连接错误；
- httpx timeout；
- 429；
- 500/502/503/504；
- `finish_reason=length`、空 content、JSON 解析失败、字段校验失败；
- 内容策略违规可使用一次带更强约束的重新生成。

不可重试：

- 401/403/404；
- 未配置密钥；
- 用户未验证、未登录、无 entitlement、额度已用完；
- 客户端输入无效。

退避必须短、带少量 jitter，并受总预算控制。不要引入无限循环，也不要降低 schema
严格度作为“修复”。如果第一次失败已明确来自上游，不得让客户端和 Backend 各自
重复两次，造成四次调用；重试责任优先放在 Backend，客户端只处理网络到 Backend
这一层的瞬时失败。

### 阶段 F：额度改为成功后结算

将反馈请求拆成三个阶段：

1. **授权检查**：校验账号、套餐和剩余额度，但不增加计数；
2. **执行与校验**：调用 DeepSeek，完成 schema 与内容策略校验；
3. **原子结算**：只有得到可返回给客户端的合法结果后，增加额度并写 UsageEvent。

幂等约束：

- 客户端为一次逻辑分析生成稳定的 `X-Idempotency-Key`；
- 同一答案的自动重试和用户立即重试复用该 key；答案发生变化时生成新 key；
- 相同 user + feature + key 最多生成一条 UsageEvent；
- 重试可以重新调用上游，但不能再次消耗用户额度；
- 不为了幂等把答案、AI 反馈或个人 Memory 持久化到 Backend；
- 如果沿用现有 UsageEvent 唯一约束，可把 `consume` 拆为 authorize/settle，并在
  settle 中原子判断相同 key 是否已经结算；
- 处理并发唯一键冲突时返回已有结算状态或视为本次无需再次计费，不要抛出当前
  `idempotency-key-replayed` 让用户陷入无效重试；
- 保持 PostgreSQL 与测试 SQLite 行为一致。

如果无法在不持久化私人内容的前提下安全实现响应重放，则不要缓存响应；允许相同 key
重新调用上游，但用户额度仍只能结算一次。文档中明确这会增加极少量上游成本，但保护
用户隐私和额度。

### 阶段 G：修复二答确认 UI

`SubmitCorpusStage` 在收到 analysis 时初始化：

- `correctionDrafts = correctedSentences.map(item => item.corrected)`；
- `selectedCorrections = correctedSentences` 的全部索引；
- `selectedMemory = []`，Memory 继续逐条人工确认；
- attempt 或 analysis 身份变化时重新初始化；普通输入期间不能被无关 render 重置；
- textarea 更新时能写入尚不存在的索引，不得对空数组只执行 `map`；
- 提交时使用用户编辑后的文本，并过滤空字符串；
- AI 不可用时保留现有手动候选 fallback，但状态文案立即切换到离线模式。

不要自动把 Memory 候选加入长期 Memory。

### 阶段 H：恢复和验证部署

代码修复不能代替部署修复。按现有部署文档和脚本执行：

1. 确认实际生产主机是 Windows 公网栈还是目标 Linux 主机；
2. 确认 Docker/容器运行；
3. 确认 Backend 容器健康；
4. 确认 cloudflared 已读取正确 token 且 Tunnel 为 connected；
5. 公网访问 `/health` 必须返回 200，而不是 530/1033；
6. 使用已验证账号调用 `/health/verify`，确认 DeepSeek request/verification 状态分离；
7. 从 Android 真机确认 App 实际 Backend URL，与部署域名完全一致；
8. 不在命令输出、截图、日志或提交中暴露 `.env`、token、API key、SMTP 密码；
9. 若有数据库改动，先备份再迁移，并完成一次可重复恢复演练；没有必要则不要新增迁移。

部署顺序：

1. 先部署向后兼容的新 Backend；
2. 验证公网健康和真实 DeepSeek；
3. 再发布包含客户端修复的新 APK；
4. 保留上一 Backend 镜像/提交与 APK 作为回滚点；
5. 观察失败阶段、延迟和 5xx，但不得观察或记录用户答案正文。

## 6. 自动化测试矩阵

### 客户端必须新增或更新

- 一答成功、失败、手动重试；
- 一答暂时性错误自动恢复且请求次数有上限；
- 一答不可重试错误不展示无效重试；
- 二答真实 Provider 绑定回归；
- 二答失败后重试真实发出第二个请求；
- 一答 pending 时二答排队并最终执行；
- 两份 AI 结果均保存在同一 session；
- 答案变化后旧结果不落盘；
- 组件卸载后不更新 UI；
- AI 未配置时立即展示本地候选；
- 修正句默认选择、编辑、取消选择、最终保存；
- Memory 候选默认不选；
- Web fetch 和 CapacitorHttp 超时映射一致；
- 稳定幂等键在同一逻辑重试复用，答案变化后更新。

### Backend 必须新增或更新

- thinking 被关闭、JSON mode 和 max_tokens 正确；
- 结构完整结果成功；
- 空 content、无 finish_reason、length、非法 JSON、缺字段、策略违规；
- 401/403/404/429/5xx/timeout 分类；
- 可重试错误最多调用两次，不可重试错误只调用一次；
- 总时间预算不会因重试无限翻倍；
- 失败不扣额度；
- 成功扣一次；
- 相同幂等键并发/串行重试只扣一次；
- 不同幂等键按成功次数计费；
- `/health` 同时展示 verification 与最近 request 状态；
- 日志脱敏测试继续通过。

### 现有回归必须保持

- 无 Text AI 时仍可完成两次回答；
- System TTS 仍可播题；
- AI TTS 失败仍 fallback；
- 不出现 Band Score 或语音表现评价；
- 网络失败不丢答案或训练记录；
- 二答题目 TTS 可重播；
- 本地账号数据隔离；
- 历史 session 与旧 feedback 迁移仍可读取。

## 7. 验证命令与质量门槛

完成实现后按顺序运行：

```text
npm run typecheck
npm run lint
npm test
npm run test:backend
npm run build
```

随后运行 Android 构建脚本，并确保 Gradle 单元测试、lint 和 APK 构建全部通过。

质量门槛：

- 0 个 TypeScript 错误；
- ESLint 0 warning；
- 前后端全部测试通过；
- 不接受通过增加全局测试超时掩盖失败；
- 不接受删除或放宽 AI schema/策略测试；
- 不接受只验证 mock Provider 而不验证真实 Provider 绑定；
- 不接受仅凭 `/health configured=true` 宣称 DeepSeek 可用；
- 工作区没有意外生成物或秘密文件进入暂存区。

## 8. 真机与真实服务验收

自动化通过后，在不记录真实答案内容的前提下执行：

1. 公网 `/health` 连续检查稳定返回 200；
2. 已验证账号登录，DeepSeek 真实验证成功；
3. 连续完成至少 5 次第一次回答分析，记录成功/失败、总耗时和失败阶段；
4. 至少一次让一答保持 pending 时进入二答，确认二答最终自动执行；
5. 二答故意制造一次可重试失败，确认重试有效；
6. 检查额度：失败不扣、同一次逻辑重试只扣一次、成功扣一次；
7. 编辑 AI 修正句，取消其中一条，只保存确认后的内容；
8. 关闭并重开 App，确认答案、AI 结果和个人语料仍存在；
9. 断开云端后再次练习，确认本地规则、保存和两次回答仍可用；
10. 检查 Backend 日志只有 request id、状态、延迟和安全摘要，没有答案或凭证。

真实调用使用短测试答案并控制次数。没有可用凭证或部署权限时，明确报告为未完成项，
不要假装完成端到端验收。

## 9. 发布与交付

建议以 patch 版本发布：

- `package.json` / `package-lock.json`：`2.1.10`；
- Backend 版本同步；
- Android `versionName=2.1.10`；
- Android `versionCode` 从 17 增加到 18；
- 新增发布记录，列出修复、验证、部署状态和已知限制；
- 生成 Debug APK 供验收；只有用户明确要求并且签名环境可用时再交付 Release APK；
- 核对包名、版本、签名、SHA-256；
- 提交前检查 staged files，确保 `.env`、token、keystore、数据库备份和 APK 不进入 Git；
- 推送时若 SSH 22 端口失败，使用已有的 HTTPS 安全流程；
- 不覆盖远端未知提交，推送前先只读比较远端 HEAD。

推荐拆分为小提交：

1. `test: reproduce AI feedback reliability failures`
2. `fix: make first and second feedback requests reliable`
3. `fix: settle feedback quota only after success`
4. `fix: preserve editable second-attempt corrections`
5. `docs: record AI reliability verification and release`

提交边界可按实际依赖微调，但不要把无关格式化或重构混入。

## 10. 明确禁止

- 不恢复录音、STT、发音评分、语速/停顿/语调评价；
- 不输出 IELTS Band Score 或水平评级；
- 不让客户端接触 DeepSeek key；
- 不把答案、AI 反馈、Authorization 或密钥写入日志；
- 不把用户答案或 AI 响应长期保存在 Backend 作为幂等缓存；
- 不移除前后端运行时校验；
- 不通过无限重试或超长超时掩盖故障；
- 不让重试重复消耗用户额度；
- 不让 AI 失败阻止本地保存和第二次回答；
- 不扩大到支付、社交、完整模拟考试或其它 V2.0 非目标；
- 不删除或覆盖当前本地 `146f718` 及用户未提交修改。

## 11. 完成定义

只有同时满足以下条件才能标记完成：

- R1-R9 均有对应修复或可验证的部署处置；
- 新增测试在修复前能复现问题，修复后稳定通过；
- 全量前后端验证和 Android 构建通过；
- 公网 Backend 与 Tunnel 健康；
- 真实 DeepSeek 一答、二答和重试流程在 Android 真机通过；
- 失败不扣额度，相同逻辑重试不重复扣额度；
- 修正句可编辑、默认选中，Memory 仍需单独确认；
- 本地离线训练和历史数据兼容没有回归；
- 交付报告清楚列出做了什么、如何验证、部署到哪里、仍有哪些限制；
- 没有秘密、答案正文或无关修改进入提交。

