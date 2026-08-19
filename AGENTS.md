# AGENTS.md

## Project

**Name:** 雅思口语喵<br>**Version:** V1.8<br>**Platform:** Android<br>**Primary mode:** IELTS Speaking single-question practice

雅思口语喵是一款 IELTS Speaking 单题练习软件。V1.7 起答案以文本提交：
用户使用手机系统键盘语音输入或手动输入，应用内不再录音、不再调用 STT。

V1.8 核心训练闭环：

> **结构化季度题库 → 听题 → 输入/口述答案文本（可选手动计时）→
> 本地教学 RAG + 用户长期 Memory 增强的 DeepSeek 纯文本分析 →
> 简洁重点式反馈 → 试听优化答案与 3 个参考回答 → 复用个人素材完成
> 第二次回答 → 收录个人语料**

所有开发决策优先服务这条主链路。

---

## Product Principles

1. **Speaking first**  
   这是口语训练软件，不是文本改写工具。

2. **Training over generation**  
   AI 应帮助用户自己说得更好，不应替用户完成整段答案。

3. **Second attempt is core**  
   第一次和第二次回答之间的进步是 V1.0 的核心价值。

4. **Actionable feedback**  
   每次优先指出 2–3 个最重要的问题，不要一次给过多反馈。

5. **Speakable English**  
   优先自然、准确、容易说出口的表达，不追求无意义的高级词汇、复杂句或 idioms。

6. **Local-first**  
   题库、录音、训练记录和个人语料默认优先本地保存。

7. **Graceful degradation**  
   没有任何 AI API 时，基础训练仍必须可用。

8. **Keep V1.0 small**  
   不要擅自扩展到模拟考试、云同步或复杂发音评分。

---

## Historical: V1.0 Core Features

（V1.6 及更早版本的录音/STT/跟读功能已移除；以下仅保留为历史说明。）

至少实现：

- IELTS Speaking Part 1 / 2 / 3 基础题库；
- 浏览和随机抽题；
- 题目 TTS 播报；
- 第一次和第二次录音；
- 录音回放；
- STT 转写；
- transcript 手动修正；
- 基础本地语音/流利度分析；
- 可选 Text AI 反馈；
- 可选 AI TTS；
- Android System TTS fallback；
- 两次回答对比；
- 保存个人可复用表达；
- 本地持久化。

核心流程不稳定时，不要优先开发高级功能。

---

# Speech

V1.7 语音能力只保留 TTS。应用内录音、STT、跟读和发音复盘均已移除。

## Question TTS

题目、AI 优化答案和 3 个参考回答必须支持语音播报。

至少支持：

- 播放；
- 重播；
- 停止；
- 显示播放状态；
- 同一按钮第一次点击播放、第二次点击立即停止；
- 播放 A 时点击 B：先停止 A 再播放 B；
- 全局同时只能有一个 TTS 播放。

---

## TTS Providers

TTS 使用可替换 Provider。

至少保留：

```text
TTSProvider
├── Android System TTS   # default / fallback
└── AI TTS               # optional
```

AI TTS 可用于：

- examiner-style 题目播报；
- Natural Version；
- 保存表达的示范朗读。

如果 Provider 支持，可配置：

- voice；
- accent；
- rate；
- pitch；
- style / instruction。

不要假设所有 Provider 支持相同能力。

AI TTS 失败时自动 fallback 到 System TTS。

相同固定文本和相同 Voice 配置可缓存生成音频，避免重复调用 API。

---

## Historical: Recording

（V1.6 及更早版本的行为；V1.7 不再提供应用内录音。）

必须保存原始用户录音。

至少支持：

- start / stop；
- 录音状态；
- 时长；
- 本地保存；
- 第一次和第二次录音回放。

**不要因为 STT 成功就删除原始录音。**

外部服务失败时也不能丢失录音。

---

## STT（已彻底移除）

V1.7 不再提供任何 STT 能力：

- 客户端不得出现录音转写 UI、STT Provider、STT 配置或重试转写按钮；
- Backend 不得提供 `/v1/stt`、火山 STT 服务、STT 环境变量或相关测试；
- 用户直接用手机系统键盘的语音输入（由系统 IME 完成），或手动输入答案文本；
- 系统键盘语音输入的识别结果属于用户文本，用户可在提交前直接修改；
- 严禁重新引入应用内录音、转写或任何“转写→发音比对”逻辑。

---

## Built-in Question Bank（V1.8）

内置题库是生成产物，不是手写业务数据：

- `scripts/import-question-bank.mjs` 自动解析新航道季度题库 PDF，
  输出 `src/data/questionBank.generated.json`；
- 生成结果必须保留：Part 1/2/3、topic、new/old、Part 2 cue points、
  Part 2↔Part 3 关联、季度元数据；
- 换季度命令：`npm run question-bank:update -- "<新题库.pdf>"`，
  随后执行 `npm run verify`。若未来 PDF 排版变化，只允许改解析器，
  不允许为某一季度手工维护题库或改 UI/训练业务；
- V1.4 及更早的旧内置题只保留在 `legacyQuestionsById`，用于显示历史
  练习记录，不得重新进入浏览或随机抽题；
- 题库 JSON 与 `questionBankSchema` 在运行时都会被 Zod 校验，解析结果
  不完整时启动直接失败，而不是静默给出残缺题库。

## Local Accounts（V1.8 第一版）

- 简易本地账号：昵称 + 稳定 userId + 可选 4-6 位本地 PIN；
- PIN 只保存 SHA-256 摘要，用途是防止误切换，不是加密，也不提供找回；
- 练习、AI 反馈、个人表达、导入题均写 ownerId，按当前账号隔离；
  V1.8 之前的无 ownerId 数据归“本机用户”所有；
- 不做社交、会员、云端注册。未来云同步以 userId 对齐远端身份即可，
  不要在第一版实现真实同步。

## Teaching RAG and Long-term Memory（V1.8）

- RAG 是本地词汇检索：几十篇自写的 IELTS 教学原则按 Part + 主题匹配，
  不引入向量库/embedding API，离线可用；
- 用户长期 Memory 从真实持久化数据推导（练习历史、AI feedback、
  个人表达），不另建容易不同步的第二份存储；
- `buildTutorContext` / `buildLearnerContext` 把紧凑上下文随
  `/v1/feedback` 发送；不得发送用户完整历史、其他账号数据或密钥；
- 个人表达跨题复用：同题 > 同 topic > 关键词相近，界面可试听并插入
  当前答案，插入后 `reuseCount` 增加。

## Text Analysis（V1.7）

DeepSeek 只分析用户提交的答案文本，维度包括：

- grammar；
- vocabulary；
- coherence；
- naturalness of expression；
- task relevance；
- content development。

明确禁止：

- 评价或虚构 Pronunciation、语速、停顿、语调等语音表现；
- 给用户 IELTS Band 分数、分数段或任何水平评分。

本地无 AI 时只做简单、可解释的文本规则提示（词数、填充词、相邻重复词），
同样不输出任何分数或语音表现结论。

---

# AI

## Text AI

Text AI（DeepSeek）用于分析单次答案文本，必须遵循：

- 角色是友好的 IELTS Speaking Tutor；
- 优先指出 2–3 个最重要的问题，不要过度纠错；summary 和 problems 必须
  短小、动作优先，UI 默认只展开优先级列表，其余折叠；
- 修改表达时保持用户原本水平和表达习惯，不突然提高到难以模仿的高级英语；
- 如果请求带 tutorContext / learnerContext，应自然参考但不长篇复述，
  可复用素材只在适合本题时沿用，不整段背诵；
- 每道题返回恰好 3 个参考回答：简单自然版 / 自然提升版 / 另一种表达版；
- 三个版本都必须是真实口语，不能写成作文或背诵范文；
- 提交内容：Part、题目、用户答案、可选作答时间；
- 使用结构化 JSON：summary / strengths / problems / grammarSuggestions /
  vocabularySuggestions / improvedAnswer / referenceAnswers(3 个)；
- 客户端与 Backend 都要对返回结构做运行时校验；
- 不要生成任何 IELTS Band 分数、水平评分或语音表现评价。

---

## Cloud Backend（V1.7）

Text AI 与 AI 语音全部由自建 Backend 托管第三方 API，客户端不直接调用任何
第三方服务：

- Backend 用 Python + FastAPI 实现，提供 `/health`、`/health/verify`、
  `/v1/feedback`、`/v1/tts`、`/v1/organize`；不再提供 `/v1/stt`；
- DeepSeek（Text AI）与火山引擎语音合成 2.0（TTS）是两个独立 Service 与
  独立环境变量，不共用密钥；
- 第三方密钥只存在于 Backend 环境变量，不进入 APK、源码仓库或客户端配置；
- 普通用户不填写任何 API Key 或访问口令；设置页展示云端连接状态、Backend
  地址配置与本机 TTS 能力测试；
- 客户端保持 `LLMProvider` / `TTSProvider` 边界，实现为 `Backend*Provider`，
  以后更换 Provider 不需要大改；
- 云端不可用时回退：系统 TTS、本地规则提示继续可用。
- Backend 不实现客户端访问口令鉴权；公网部署必须在反向代理、VPN 或网关层提供
  认证与访问控制。
- App 启动时拉取 `/health` 并缓存，各 `Backend*Provider` 的配置状态由真实
  健康状态驱动。
- `/health` 必须区分三个信号：密钥是否配置、Backend 是否可达、上游是否已
  真实验证（verified / unverified / failed 及最近调用时间）；设置页不得把
  “有密钥”显示成“已连接”。
- 正式构建（`VITE_LOCK_BACKEND_URL=true`）内置 Backend 地址且设置页
  只读，构建时缺少地址必须失败；默认强制 HTTPS，家庭 Backend 的私有
  局域网 HTTP 例外需显式开启 `-AllowLanHttp`；升级后清除旧设备保存的
  运行时地址。

---

## Provider Boundaries

至少保持以下边界：

```text
LLMProvider
TTSProvider
LocalStorage
AudioStorage             # 仅读取/维护 V1.6 及更早的历史录音
BackendClient            # 客户端访问自建 Backend 的唯一入口
```

不得重新引入：

```text
RecordedAudioSTTProvider
STTProvider
PronunciationProvider
```

避免：

- React 页面直接调用模型 API（只允许经 BackendClient 调用自建 Backend）；
- UI 中硬编码模型名称；
- vendor-specific response 扩散到整个项目；
- 客户端持有任何第三方 API Key（密钥只在 Backend）。

具体目录、状态管理、数据库和组件结构由 Codex 根据仓库自行选择。

不要为了架构漂亮创建无实际用途的 abstraction。

---

# Local Offline Mode

没有 API 时仍应完成基本训练。

本地能力包括：

- System TTS；
- 题库；
- 可选计时器；
- 词数、filler words、相邻重复词等少量高置信度文本规则；
- 本地记录；
- 个人语料。

不要在 V1.7 中用大量正则构建完整英语语法检查器，也不要给用户分数。

---

# Personal Language Memory

用户可以保存：

- 自己认可的表达；
- 修正后的句子；
- 对应题目/topic；
- 来源练习；
- 创建时间。

重点是保存用户未来真正可能再次说出来的语言，而不是收藏大量完整范文。

---

# Android-first

V1.0 只要求 Android 正常交付。

如果仓库尚未确定技术栈，可优先考虑：

- React；
- TypeScript；
- Vite；
- Capacitor。

不要为了 V1.0 同时维护桌面端和 iOS。

具体实现由 Codex 根据当前代码选择最简单、可靠、可维护的方案。

---

# Privacy and Secrets

第三方 API Key（DeepSeek、火山引擎等）只允许保存在 Backend 环境变量中。

必须：

- 不写入 APK、源码仓库或客户端配置；
- 不提交 Git（仓库只保留 `.env.example` 占位文件）；
- 不进入测试 fixture；
- 不输出到 Backend 日志（日志过滤器强制脱敏）；
- 客户端不接触任何第三方密钥。

答案文本、训练记录和个人语料默认视为私有数据，保存在本机。

V1.7 不再上传任何录音到 Backend；答案文本仅在用户点击分析时发送到自建
Backend 用于 Text AI 分析。

日志中不得包含 API key、Access Token、Authorization header 或其他 secrets。

---

# Failure Handling

以下都属于正常失败场景：

- 未配置 API；
- key 错误；
- endpoint 错误；
- model 不存在；
- timeout；
- network failure；
- rate limit；
- invalid response。

失败时优先：

- retry；
- fallback；
- continue without AI；
- manual edit；
- local save。

任何外部服务失败都不得轻易导致：

- 当前答案文本丢失；
- 当前训练记录丢失；
- App 崩溃。

---

# Non-goals

V1.0 不主动实现：

- 完整 IELTS 模拟考试；
- AI 实时考官多轮对话；
- 官方级 IELTS 自动评分；
- 高精度或单词级 pronunciation scoring；
- 复杂声学图表；
- 云端账号系统与真实云同步（V1.8 只做本地账号 + userId 预留）；
- 社交和排行榜；
- 完整 Anki / PDF 导出；
- 复杂学习日历；
- 完整间隔重复系统；
- 桌面端；
- iOS；
- 自建 AI 后端；
- 大型离线语言模型；
- 自训练语音模型。

---

# Engineering Harness

项目应提供等价于以下能力的统一命令：

- dev；
- lint；
- type check；
- tests；
- production build。

遵循仓库已有工具和 package manager。

完成有意义修改时，尽可能执行：

1. type check；
2. lint；
3. relevant tests；
4. build。

如果无法执行，在最终说明中明确原因。

AI / TTS 自动化测试默认使用 fake provider 或 mock，不依赖真实付费 API。

至少验证：

- 无 Text AI 时仍可训练；
- 无 Voice AI 时 System TTS 可播题；
- Voice AI 失败可 fallback；
- AI 返回非法结构不会导致崩溃；
- AI 输出中不允许出现 IELTS 分数或语音表现评价；
- 网络失败不会丢失训练记录；
- 计时器不自动启动，且不会强制结束或自动提交；
- TTS 同键二次点击停止，切换内容时先停旧再播新；
- 本地数据重新打开 App 后仍存在，V1.6 历史记录可迁移读取。

---

# Acceptance Flow

V1.8 最重要的验收流程：

1. 打开 Android App，自动进入“本机用户”账号；
2. 在 2026-05 季度题库中搜索/筛选 new/old 题，选择一道题；
3. 播放题目；Part 2 可展开查看对应 Part 3；
4. 第一次回答：系统键盘语音输入或手动输入答案文本；
5. 可选：手动开始/暂停/继续/重置计时器；
6. 提交答案（不强制结束，不自动提交）；
7. 查看本地规则提示；如配置 Text AI，查看优先 2-3 点的文本分析；
8. 试听优化答案和 3 个参考回答（tab 切换）；同键再点停止，
   换内容时先停旧再播新；
9. 第二次回答：可把“你的长期素材”插入答案框；
10. 小改后收录一个表达；
11. 到“我的”创建/切换账号，确认两边练习与表达互不可见；
12. 关闭并重新打开 App；
13. 之前的练习、答案文本、历史录音、表达和账号状态仍然存在。

这条链路不可靠时，不要优先开发高级功能。

---

# Coding Agent Rules

处理本仓库任务时：

1. 先阅读本文件和现有代码。
2. 优先延续已有模式。
3. 一次修改解决一个明确问题。
4. 避免无关的大规模重构。
5. 不要擅自扩大 V1.0 scope。
6. 新依赖必须有明确价值。
7. 永远校验 AI 输出。
8. 永远为外部服务设计 failure path。
9. 不要重新引入 STT、应用内录音转写或 pronunciation scoring。
10. 不要让 Voice AI 成为唯一 TTS 实现。
11. 不要默认 Text AI 和 Voice AI 共用 credentials。
12. 多种实现都合理时，选择最简单、最可靠、最符合核心训练闭环的方案。
13. 修改完成后说明：
    - 做了什么；
    - 如何验证；
    - 已知限制。

---

# Self-Rescue Protocol（防卡死协议）

处理本仓库时如果感觉“卡住”，先按下面的顺序自检，不要原地重试同一方法：

1. **工具调用超时/无输出**
   - 不要反复调用同一个后台命令或同一套浏览器验证方式；
   - 先 `job_list` 看后台任务；如果 job 列表为空但进程仍在监听端口，
     不要依赖 job 控制，直接清理进程并换一次性验证方式；
   - 长任务优先用“前台 + 明确超时”或“后台 job + 主动 poll + 完成后 kill”。

2. **浏览器/UI 验证**
   - 默认用 Vitest/Testing Library 做功能验证，不要为了“看起来更真”去启动
     常驻 headless Chrome；
   - 确实需要真浏览器时，必须使用**同一个 shell 内一次性启动 → CDP/命令读取
     → 自动 kill** 的脚本，绝不使用不退出、只输出设备错误的常驻进程；
   - 若 CDP/Playwright 依赖/工具链本身不工作，停止折腾工具链，改用
     `--dump-dom`、单测或人工可复现步骤验证，并记录已知限制。

3. **无法继续执行某一步**
   - 如果某一步连续失败 2 次，停止；记录失败原因、已尝试方法、下一步替代方案；
   - 优先找一个更简单、更可靠、更小的路径完成同一目标；
   - 如果确实需要用户提供真实凭证/地址/决策，不要装作完成，明确暂停并询问。

4. **后台/长驻进程清理**
   - 每次浏览器、预览服务器、模拟器等验证完成后必须清理进程；
   - 使用 Windows 时可检查 `netstat -ano | grep <port>` 与 `tasklist | grep <name>`
     确认没有遗留进程，避免污染后续步骤。

5. **进度可见**
   - 多步任务使用 `todo_write` 保持可见；
   - 每完成一个里程碑就更新状态，不要在一个不可见的子任务里无限消耗。

---

# Decision Priority

发生取舍时按以下顺序：

1. 用户数据和 secrets 安全；
2. 核心训练流程可靠；
3. 录音和语音数据可靠；
4. Android 实际可用；
5. 学习价值；
6. 简单、可维护；
7. 可扩展性；
8. 功能数量。

---

# Success Criterion

V1.8 成功意味着：

> 用户能在 Android 手机上浏览最新结构化季度题库，用系统键盘语音输入或
> 手动输入完成两次文本回答，获得不包含任何分数的精简文本分析（优先 2-3 点，
> 参考回答按 tab 浏览），复用自己历史素材，并把值得再次使用的个人语料
> 保存在自己的本地账号下。

即使没有配置 Text AI 或 Voice AI：

- 题目仍能播报；
- 用户仍能提交和保存答案文本；
- 手动计时器仍可用；
- 本地规则提示仍可用；
- 两次回答仍可完成；
- 数据仍能正常保存。
