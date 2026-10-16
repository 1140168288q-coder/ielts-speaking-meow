# 雅思口语喵｜PDF 项目说明书证据清单 (Evidence Manifest)

- **生成日期**：2026-09-19
- **对应文档**：`artifacts/competition-materials/pdf/雅思口语喵-项目说明书.pdf`
- **排版源文件**：`artifacts/competition-materials/pdf/雅思口语喵-项目说明书.html`
- **逐页预览图**：`artifacts/competition-materials/pdf/previews/page-1.png` ~ `page-10.png`
- **项目版本基线**：V2.2.2；当前 APK 元数据为 Android `versionCode 21`、`versionName 2.2.2`。`462cdaf` 是 PDF 引用的历史源码基线，不代表当前工作区没有后续修改。
- **申报高校与团队**：常州工学院 · ONE HARNESS（负责人：夏王恩，成员：沙飞扬）

---

## 1. 关键指标与事实来源

| 序号 | 事实/数据项 | 数值/事实内容 | 来源文件/命令 | 证据级别 | 说明与边界 |
|---|---|---|---|---|---|
| **D01** | 软件名称与版本 | 雅思口语喵 V2.2.2 | `package.json:4`, `android/app/build.gradle` | 源码已实现 | 前端与后端统一版本号为 2.2.2 |
| **D02** | 内置题库规模 | 653 题（Part 1 256 / Part 2 60 / Part 3 337） | `src/data/questionBank.generated.json` | 源码已实现 | 题库季度为 2026 年 5–8 月，为工程规模数据，非提分或效果指标 |
| **D03** | 前端自动化测试记录 | 62 个测试文件，373 项测试通过 | `docs/AI_DIFFICULTY_USER_RAG_QUESTION_MANAGEMENT_RESULT.md:61` | 历史自动化验证 | 2026-09-09 运行记录；测试使用 Fake Provider / Mock，不消耗真实额度 |
| **D04** | 后端自动化测试记录 | 96 项 pytest 测试通过 | 同上行 62 | 历史自动化验证 | 2026-09-09 记录；覆盖 SQLAlchemy/PostgreSQL 迁移与鉴权 |
| **D05** | Android 构建与团队真机实测 | `ielts-speaking-meow-v2.2.2-release.apk`；团队反馈在小米 17 Pro Max、电脑公网服务开启条件下主要功能正常 | `artifacts/` 中安装包及 APK 元数据；2026-09-19 团队说明 | 产物核对＋团队报告 | 安装包元数据为 versionCode 21 / versionName 2.2.2；本次文档 QA 未独立复现逐项真机测试，断网与其他机型仍待验证 |
| **D06** | 架构与密钥边界 | 第三方 Key 由 FastAPI 后端托管，客户端不配置第三方 Key | `backend/app/main.py`, `AGENTS.md` | 源码已实现 | 本地规则不依赖云端；系统 TTS 可用性取决于设备语音服务 |
| **D07** | 豆包 TTS 接入与预设音色 | 火山语音合成 2.0 与预设音色、可选缓存和系统语音回退 | `backend/app/services/volcengine_tts_service.py`, `src/infrastructure/speech/fallbackTtsProvider.ts` | 源码已实现 | 实际回退时延与真机音频效果未在本次 PDF QA 中测量 |
| **D08** | DeepSeek 全场景垂直赋能 | 双参考版本、知识/素材结构化导入提取、换季题库解析、长期 Memory 沉淀 | `backend/app/services/deepseek_service.py`, `src/domain/memory.ts`, `src/domain/rag.ts` | 源码已实现 | 统一提示词契约与 Zod 强校验，严禁大模型打分或虚构语音表现 |
| **D09** | 弃用应用内 STT 的交互决策 | 不引入应用内录音转写，采用系统自带键盘语音输入 (IME) + 用户提交前修改 | `AGENTS.md` (STT 章节) | 产品架构决策 | 不声称已经完成跨设备输入体验比较或完全消除录音隐私风险 |
| **D10** | 家庭电脑穿透部署路径 | Cloudflare HTTPS Tunnel，无需公网 IP/路由器端口映射 | `DEPLOY_WINDOWS_PUBLIC.md` | 部署设计与历史运维记录 | 远程可用性取决于主机、网络、隧道和上游服务；Linux 迁移仍需单独验收 |

---

## 2. 关键代码选材核对

说明书含 6 段与所在页面主题直接相关的真实源码节选，均配有通俗设计解释：

### C01：训练小计划的行动编排
- **位置**：`src/domain/trainingPlan.ts:102-109`（函数 `buildTrainingPlan`）
- **选材代码**：
  ```ts
  const actions = [
    shorten(feedbackAction ?? defaultFirstAction(question), 240),
    material !== undefined
      ? shorten(`用「${material.material.title}」中的一个真实细节，用自己的话回答。`, 240)
      : expression !== undefined
        ? shorten(`尝试复用一个短表达：「${expression.expression.text}」。`, 240)
        : '再完整回答一次：先直接回应题目，再补一个原因、细节或例子。',
  ]
  ```
- **配文解释**：系统把本次反馈与已有素材整理为下一次回答的具体动作。
- **边界说明**：证明训练计划由**应用规则编排**，而非模型自主多步规划；确保训练动作稳定、可控且贴合口语实际。
- **出现在**：PDF 第 6 页（智能体赛道关联）。

### C02：严格拦截未提供的知识来源
- **位置**：`src/infrastructure/backend/backendTextProvider.ts:100-110`（函数 `getFeedback` 来源校验分支）
- **选材代码**：
  ```ts
  if (!feedbackContextReferencesAreValid(validated, [
    request.tutorContext,
    request.learnerContext,
    request.userKnowledgeContext,
  ])) {
    throw new ApiProviderError(
      'invalid-response',
      'Text AI 返回了未提供的来源,已保留本地结果。',
      true,
    )
  }
  ```
- **配文解释**：AI 返回的知识来源必须能精确匹配本次提供的上下文；检测到越界引用时立即拦截并保留本地结果。
- **边界说明**：证明系统具备对 AI 幻觉和未授权外部引用的本地工程拦截兜底机制。
- **出现在**：PDF 第 8 页（工程实现与验证）。

### C03：异步 AI 反馈的答案快照保护
- **位置**：`src/application/practiceService.ts:186-191`。
- **机制**：反馈返回时比较回答 ID、状态、文本和更新时间；旧反馈不得覆盖用户已修改的答案。
- **出现在**：PDF 第 3 页（训练主链路）。

### C04：二答 Memory 候选的来源核验
- **位置**：`src/application/practiceService.ts:346-348`。
- **机制**：限定同一 Part，并检查候选来源句是否见于第二答文本；随后仍由用户显式确认。
- **出现在**：PDF 第 5 页（知识与 Memory）。

### C05：运行时服务装配与语音回退
- **位置**：`src/app/runtime.ts:65-73`（中间省略语音 Provider 构造，PDF 已明示）。
- **机制**：文本 AI 经 BackendClient 装配，AI TTS 与系统 TTS 组成失败回退链路。
- **出现在**：PDF 第 10 页（整体编程架构）。

### C06：后端接入 DeepSeek 结构化文本 API
- **位置**：`backend/app/services/deepseek_service.py:733-751`。
- **机制**：由后端发起 `/chat/completions` 请求，密钥从服务端配置读取，请求指定 JSON 输出、模型及超时；后续处理上游错误与返回结构。
- **出现在**：PDF 第 7 页（AI 大模型结合）。

---

## 3. 截图素材来源与属性

所有截图均基于真实应用环境/真实 Web 预览生成，禁止绘制虚假功能界面：

| 编号 | 最终文件路径 | 原始采集源文件 | 采集环境 | 数据性质 | 裁切与处理说明 | 在说明书中位置 |
|---|---|---|---|---|---|---|
| **S01** | `assets/S01-first-answer-crop.png` | `artifacts/audit-baseline/14-first-answer-v2.png` | Web 预览 (V2.2.2) | 演示题目数据 | 裁切顶部导航栏冗余，校准为 V2.2.2 陶土暖橙播放题目按钮与进度条，特写一答入口 | P2（用户问题） |
| **S02** | `assets/S02-feedback-orange-web-preview.png` | `artifacts/audit-baseline/15-review-ai-background-v2.png` | 应用 Web 预览 | 演示作答与反馈 | 采用现有暖白橙色界面截图，原图未改色，仅在 PDF 版面裁切以突出重点诊断 | P3（完整训练） |
| **S04** | `assets/S04-materials-crop.png` | `runtime/ui-v2.2.2-qa/03-review.png` | 真实 V2.2.2 产物 | 个人素材与复盘中心 | 采撷真实 V2.2.2 复盘页，展示暖白羊皮纸底色、4 个分类 tab 与学习轨迹入口 | P5（知识与Memory） |
| **S05** | `assets/S05-confirmation-crop.png` | `artifacts/audit-baseline/18-harvest-optional-v2.png` | Web 预览 (V2.2.2) | 真实练习确认阶段 | 裁切表达确认候选，主操作按钮校准为 V2.2.2 陶土暖橙 (`#B7441E`) 并配以矢量星芒 | P1 封面、P5 |
| **S06** | `assets/S06-corpus-crop.png` | `artifacts/audit-final/50-personal-corpus-final.png` | Web 预览 (V2.2.2) | 真实复盘中心 | 裁切展示个人语料沉淀中心与管理规范 | 备用素材库 |
| **S07** | `assets/S07-settings-crop.png` | 采集自系统设置页与真实 QA 产物 | Web 预览 (V2.2.2) | 真实设置界面 | 裁切保留 Smart Services，桃橙云图标、“唤醒一下 AI”暖橙按钮与“服务正常”连接状态 | P7（AI大模型成果） |
| **S08** | `assets/S08-import-crop.png` | 采集自题库导入页 | Web 预览 (V2.2.2) | 真实导入解析界面 | 裁切展示上传文本后 DeepSeek 结构化解析候选题目，柔和蜜桃底卡片与暖橙勾选框 | P7（AI大模型成果） |

---

## 4. 贯穿案例数据核对

第 4 页现增加“提示词如何区分两版”，逐字节选 `backend/app/services/deepseek_service.py` 的 `rules` / `contextRules`，并标明共用 system 规则位于 `backend/app/services/ielts_speaking_skill.py`。这是同一次 DeepSeek 请求的两条参考回答规则，不是两个独立模型调用；实际请求还带入题目、用户答案、上下文与自然提升版的难度/风格档位。

- **题目**：`Do you have any hobbies?`（现有 ID：`p1-do-you-have-any-hobbies-001`，Part 1 / Hobby）
- **第一答文本（演示案例）**：
  > "I like play badminton. I play it with my roommate on Sunday. It make me relaxed."
  - *分析诊断*：存在动词短语搭配 `like play` 错误，主谓时态 `make me` 错误，内容缺乏场景支撑。
- **AI 双参考版本（不同职责）**：
  - *简单优化版*（严格纠错保原意）：`"I like playing badminton. I play it with my roommate on Sundays. It helps me relax."`
  - *自然提升版*（中等口语·美式自然风格）：`"Yes, I really enjoy playing badminton. My roommate and I usually head to the campus gym every Sunday for a quick match. It's a great way to unwind after a busy week."`
- **第二答文本（演示案例中重新组织的作答）**：
  > "Yes, I enjoy playing badminton. My roommate and I usually play on Sundays. Last weekend, we played for an hour at the campus gym. It helps me relax after studying."
  - *可观察变化*：时态动词错误完全纠正，自主添加打球地点与时间细节，口语自然度提升。
- **最终确认收录成果**：
  - 个人语料表达：`"It helps me relax after studying."`
  - 写入 Memory 事实：`"plays badminton with roommate on Sundays"`（经 Grounding 来源句核对并由用户点击确认）。

---

## 5. 比赛赛道与评分项对标核验

- **大赛官网**：https://aichallenge.msup.com.cn/tracks
- **申报赛道**：AI+超级智能体赛道（高校组 · 常州工学院）
- **参赛团队**：常州工学院 · 夏王恩（负责人）、沙飞扬
- **初赛 5 大评分维度（各 20 分，合计 100 分）对标**：
  1. **AI大模型结合（20分）**：**重点展示于第 7 页**。DeepSeek 纯文本重点诊断与口语提升、题库与知识解析、长期记忆提取；豆包语音大模型考官音色生态；深入剖析弃用 STT 转向键盘语音输入的交互考量；展示家庭轻量穿透上云架构。
  2. **技术可行性（20分）**：**重点展示于第 8、10 页**。Local-First 架构、离线降级、V2.2.2 Release 安装包、历史自动化测试与编程模块数据流；另有团队报告的小米 17 Pro Max 公网服务开启条件下真机实测。断网与其他机型待扩展验收。
  3. **市场可行性（20分）**：**重点展示于第 2、9 页**。明确独自备考者的训练场景，以基础训练免费、云端按量探索、订阅备选为商业假设；真实试用和付费意愿待验证。
  4. **综合创新性（20分）**：**重点展示于第 4、5 页**。双参考版本职责隔离与三档口语难度控制，受控 Grounding 个人知识与长期记忆机制。
  5. **赛道专业维度（20分）**：**重点展示于第 3、6 页**。任务理解、训练小计划编排、系统环境交互与可验收双答进步成果交付闭环。
