# 前端重构执行简报集（P0–P2）

> 适用仓库：雅思口语喵 V2.0 前端（React + TS + Vite + Capacitor）。
> 本文档是执行 Agent 的唯一工作依据；每个简报独立成任务，按顺序执行。
> 制定依据：`src/App.tsx`（1235 行）、`src/features/practice/PracticeFlow.tsx`（1237 行）、
> `src/styles.css`（2606 行）+ `src/design-system.css`（1653 行）实测重复选择器 52 个、
> `SettingsController.tsx` / `AccountView.tsx` / `LibraryViews.tsx` 现状结构。

---

## 0. 全局约束（所有简报共用，违反即返工）

1. 一次只执行一个简报；每个简报完成后运行验证链再开始下一个。
2. 验证链（前端任务）：`npm run typecheck && npm run lint && npm test && npm run build`。
   （`npm run verify` 含 backend pytest，纯前端任务可省略 backend 部分。）
3. P0 阶段**禁止改任何测试断言**，只允许改 import 行；P1 允许改渲染结构，
   测试断言语义必须保留（允许断言随组件迁移而搬家）。
4. 不引入 react-router、状态管理库、UI 组件库、CSS 框架等任何新依赖。
5. 不改动 `src/domain/`、`src/ports/`、`src/infrastructure/`、`src/application/` 的接口。
6. 以下逻辑只许搬移、不许改写：
   - TTS 全局单实例（`audioFocus` / `useTtsToggle`）；
   - AI 请求 generation 守卫（`aiRequestGenerationRef` / `mountedRef`）；
   - 练习草稿持久化（`practiceDraftKey` 系列）；
   - 练习退出守卫（`requestSafePracticeExit` / `onExitGuardChange`）。
7. 依赖方向：`features/*` 不接触 runtime（数据与回调走 props）；
   除 `main.tsx` 与测试外，任何文件不得 import `App.tsx`；
   `app/navigation.ts` 不 import 任何组件。
8. 发现简报外的问题只记录（列入 PR 描述"已知异味"），不顺手修。
9. 不做 git commit/push，除非用户明确要求。

---

## P0-1 拆分 App.tsx（符号级）

**目标**：App.tsx ≤ 400 行，仅作组合根；导航纯函数与展示组件各归其位。

### 新文件与符号映射（源行号基于当前 App.tsx）

| 目标文件 | 搬入符号 | 源行号 |
|---|---|---|
| `src/app/navigation.ts` | `AppView`、`SAFE_PRACTICE_BACK_EVENT`、`resetViewScroll`、`AndroidBackAction`、`resolveAndroidBackAction`、`resolveInitialView`、`requestSafePracticeExit` | 87–96, 111, 113–152, 162–180 |
| `src/features/library/QuestionLibrary.tsx`（+`index.ts`） | `QuestionLibrary`、`QuestionRow`、`QuestionStatus`、`EmptyQuestionResult`、`groupQuestions`、`difficultyLabel` | 917–1235 |
| `src/features/review/ReviewCenter.tsx`（+`index.ts`） | `ReviewCenter` | 866–915 |
| `src/app/BottomNavigation.tsx` | `BottomNavigation`（含 846–848 active 归属规则） | 824–864 |
| `src/app/AppFallbacks.tsx` | `LoadingView`、`StartupFailureView` | 798–822 |
| `src/app/AppHeader.tsx` | 抽自 App JSX 590–620：brand + account-chip + api-badge。Props：`accountLabel`、`apiConnected`、`onBrandClick`、`onAccountClick` | 590–620 |
| `src/app/useUserPreferences.ts` | `ThemePreference`、`THEME_STORAGE_KEY`、`readThemePreference`、theme/preferences state、`loadUserPreferences`、`changeUserPreferences`、reduceMotion effect、theme DOM effect | 98–109, 208–232, 297–329 |
| `src/app/useCloudSync.ts` | cloudSession/cloudSyncStatus/cloudSyncMessage state、`handleCloudSessionChange`、`runCloudSync`、`formatSyncDestination` | 154–160, 402–458 + 对应 state |

**留在 App.tsx**：`App`、`QuestionDataModule`、初始化 effect、health 轮询 effect、
`openSession`/`startQuestion`/`handleSessionChange`/`deleteSession`/三个 expression handler、
`handleAccountSwitched`、`navigateSafely` 及 refs、Android backButton 与 SAFE_PRACTICE_BACK_EVENT
两个 effect、`allQuestions`/`questionsForHistory`/`activeQuestion`/`activeMemory`、view-switch JSX。

### Props/导出规则

- `QuestionLibrary({initialPart, questions, bankMeta, onStart, onImport})` 签名不变；
- `ReviewCenter({active, onChange, children})` 签名不变；
- `BottomNavigation({view, onChange})` 签名不变；
- lucide 图标随组件走；
- 搬完后 App.tsx 不再有任何非组件导出，删除多余的
  `react-refresh/only-export-components` eslint-disable 注释。

### 测试影响

- `src/App.navigation.test.ts` 第 1–6 行 import 改为 `from './app/navigation'`，断言不动；
- `src/App.cloudSync.test.tsx` 不动（`App` 仍从 `src/App.tsx` 导出）。

### 执行顺序（每子步验证后再继续）

1. navigation.ts + 测试 import → 跑 `App.navigation.test.ts`；
2. 叶子组件四件（BottomNavigation → AppFallbacks → ReviewCenter → QuestionLibrary）→ 全量测试；
3. AppHeader → 全量测试；
4. `useUserPreferences` → `useCloudSync` → 全量测试 + 验证链。

### 验收

- [ ] App.tsx ≤ 400 行；navigation.ts 无 JSX、无 React import；
- [ ] `grep "from './App'" src` 仅剩 cloudSync 测试中的 `import { App }`；
- [ ] 验证链全绿；
- [ ] 手测 5 页（首页/题库筛选+随机+展开 P3/练习进出/复盘三 Tab/我的），
      导航高亮、Android 返回、保存守卫提示行为与重构前一致。

---

## P0-2 CSS 去重（52 个重复选择器归并）

**背景**：`main.tsx` 先引 `styles.css` 后引 `design-system.css`，
同优先级时 **design-system.css 的定义是当前生效方**。归并时不得改变当前渲染结果。

**重复选择器全量清单（52）**：

```
壳层/原语类（18）：
.account-chip .api-badge .app-header .app-main .app-shell .bottom-nav
.brand .brand-mark .empty-state .eyebrow .filter-toggle .header-tools
.inline-note .page-stack .part-tabs .primary-button .secondary-button
.step-track

功能卡片类（34）：
.account-create-card .account-current-card .account-list .account-list-card
.ai-feedback-card .ai-summary .answer-entry-card .answer-text-card
.completed-card .comparison-stack .expression-list .expression-review-card
.feedback-details .history-list .improved-answer-details .next-attempt-card
.practice-page .priority-issues .prompt-card .question-group
.question-group-heading .question-number .question-row .question-row-wrap
.question-search .reference-answer-card .reference-recap-card
.reusable-material-card .settings-card .sound-button .storage-summary
.submit-corpus-card .summary-feedback-card .tutor-knowledge-card
```

### 归并规则（机械执行）

1. **壳层/原语类** 18 个 → 唯一归 `design-system.css`，删除 `styles.css` 副本；
2. **功能卡片类** 34 个 → 唯一归 `styles.css`，删除 `design-system.css` 副本；
3. 两处定义内容不同时，**保留 design-system.css 的属性值**（当前生效方），
   将其合并到归属文件后删除另一处；media query 内的同名选择器同样处理；
4. 在每个文件顶部补分层注释：
   - design-system.css：`tokens → base/reset → 壳层与全局原语`；
   - styles.css：`页面与功能组件样式`；
5. `ImportWorkspace.module.css` 本阶段不动（见 P2-4）。

### 验收

- [ ] 用与发现时相同的正则复核：52 个选择器各自全站唯一定义；
- [ ] 验证链全绿；
- [ ] 视觉抽查无差异：首页 / 题库 / 练习 4 个 stage / 复盘三 Tab / 我的 / 设置，
      逐页对照重构前截图（重点：bottom-nav、primary-button、practice 卡片组）；
- [ ] 两个 CSS 文件总行数下降 ≥ 300 行。

---

## P0-3 死 CSS 与残留清理

**目标**：删除零引用选择器与注释掉的死代码块。

### 方法

1. 从两个 CSS 文件提取全部 class 选择器（P0-2 同款正则）；
2. 逐个在 `src/**/*.{tsx,ts}` 中 grep（注意模板字符串拼接的类名，
   如 `` `filter-toggle${active ? ' active' : ''}` `` 这类要按词根搜）；
3. 零引用 → 删除；仅被测试引用 → 保留并在 PR 说明；
4. 顺带删除被注释掉的整段 CSS 与空 media query 块。

### 验收

- [ ] 每个删除的选择器在 PR 描述中列出并附"零引用"证据（grep 命令+结果）；
- [ ] 验证链全绿；视觉抽查同 P0-2 清单无差异；
- [ ] 误删恢复成本为零：本任务单独可还原（不与其他改动混杂）。

---

## P1-1 PracticeFlow 按 stage 拆文件（符号级）

**目标**：PracticeFlow.tsx ≤ 400 行；`deriveStage` 保持唯一事实源；行为零变化。

### 目标结构（符号 → 文件，源行号基于当前 PracticeFlow.tsx）

```
src/features/practice/
├── PracticeFlow.tsx        # Stage/deriveStage/STAGE_STEP(33–57) + 主编排(59–486 保留核心)
│                           # 保留：全部 ref 守卫、useTtsToggle、submit/analyze 处理器、stage 分派
├── stages/
│   ├── AnswerEntryStage.tsx      # 711–818（第一次/第二次回答共用，现已是组件，纯搬移）
│   ├── ReviewFirstStage.tsx      # 新：抽出现有 389–427 内联 JSX，组合 feedback/* 组件
│   └── SubmitCorpusStage.tsx     # 1126–1205（纯搬移）
├── components/
│   ├── QuestionCard.tsx          # 488–536
│   ├── TutorKnowledgeCard.tsx    # 537–559
│   ├── ReusableMaterialCard.tsx  # 560–611（语料卡，P1-6 再改文案）
│   ├── PersonalMaterialIdeasCard.tsx # 613–647（素材卡，P1-6 再改动作）
│   ├── AnswerTextCard.tsx        # 819–836
│   ├── TtsPlayButton.tsx         # 1066–1088
│   └── feedback/
│       ├── LocalFeedbackCard.tsx # 837–872
│       ├── AiFeedbackCard.tsx    # 873–1011（含 pickTopIssues 989–1011）
│       └── ReferenceAnswers.tsx  # TtsSection(1012–1039)+ReferenceAnswerCard(1040–1065)
│                                 # +ReferenceRecap(1089–1125)，三者本已耦合，合并一文件
├── hooks/
│   └── useManualTimer.ts         # 649–709（TimerStatus 一并搬）
└── practiceDraft.ts              # 1206–1237：practiceDraftKey/clearPracticeDraft/
                                  # readPracticeDraft/suggestReusableSnippet/formatTimer
```

### 硬规则

- `deriveStage`、`STAGE_STEP`、stage 条件分派（375/389/428/464/473）留在 PracticeFlow.tsx；
- TTS 状态（`useTtsToggle` 返回值）由 PracticeFlow 持有，以 props 下发，禁止子组件各自再调；
- `aiBusy`/`aiNote`/`message`/`busy` 状态留在主组件；ReviewFirstStage 通过 props 接收；
- `features/practice/index.ts` 只追加导出，不删除现有导出；
- `format.ts`、`questionSpeech.ts`、`TtsPlaybackBar.tsx`、`useTtsToggle.ts` 不动。

### 验收

- [ ] PracticeFlow.tsx ≤ 400 行；单文件不超过 400 行的组件占多数；
- [ ] `PracticeFlow.text.test.tsx`、`LibraryViews.test.tsx` 等不改断言语义全绿
      （允许改 import 行）；
- [ ] 手测完整闭环：听题→一答（草稿刷新恢复）→反馈（本地+AI 折叠顺序不变）→
      试听优化答案/三参考回答 Tab→二答（插入语料 reuseCount 不变）→完成页对比→收录语料；
- [ ] TTS 专项：同键二次点击停止、切换内容先停后播、离开练习自动停止，三项全过。

---

## P1-2 练习页沉浸顶栏

**目标**：练习页隐藏全局 AppHeader，换练习专用顶栏。

### 改动点

1. App.tsx：`view !== 'practice'` 时才渲染 `AppHeader`（与 BottomNavigation 同规则）；
2. PracticeFlow 新增 `PracticeTopBar`（放 `components/`）：
   - 左：返回按钮（走现有 `onBack`，即 navigateSafely 守卫，不新增逻辑）；
   - 中：`Part N` 标签 + 现有 step-track（348–354）+ step-count 上移入内；
   - 右：云端状态不显示（练习页不分散注意）；
3. step-track 从正文流移除，样式类名保留复用，只调整布局上下文。

### 验收

- [ ] 练习四 stage 均无全局 header；退出守卫、Android 返回、TTS 单实例行为不变；
- [ ] 用户在一级页↔练习页往返时 scroll reset 正常（`resetViewScroll` 已按 view 触发）；
- [ ] 验证链全绿；练习页截图对照（新增顶栏、旧 header 消失）。

---

## P1-3 「我的」页四分区 + Memory/隐私迁移

**目标**：Memory 与隐私控制从设置页迁入「我的」；设置页只留技术配置。

### 改动点

1. 把 SettingsController 中「长期了解与隐私」整段（当前 363–389：
   `memoryEnabled`、`sharePersonalMaterialsWithAi` 两个 switch + `preferenceFeedback`）
   抽为新组件 `features/accounts/MemoryPrivacyCard.tsx`；
2. `AccountView` 新增可选 props：`preferences`、`onPreferencesChange`，
   由 App.tsx 透传（复用现有 `preferences` / `changeUserPreferences`）；
3. 「我的」页最终分区顺序：
   ① 当前本机资料卡 → ② 云账号面板 → ③ 手动同步卡 → ④ **记忆与隐私** →
   ⑤ 本机账号（切换身份）→ ⑥ 新账号 → ⑦ 设置入口按钮；
4. SettingsController 保留：外观 / 训练与反馈 / AI 反馈与自然音色 / 系统朗读 / 数据维护；
   删除迁出的 memory 段落与不再使用的代码；
5. `savePreference` 的本地 feedback 提示机制随迁（`preferenceFeedback` state 移到新组件）。

### 测试迁移

- SettingsController.test.tsx 中 memory/privacy 相关断言**原样搬到** AccountView.test.tsx
  （语义不变，只换宿主）；SettingsController 剩余断言不动。

### 验收

- [ ] 「我的」页 3 次点击内可关闭 Memory 分享；`sharePersonalMaterialsWithAi`
      在 `memoryEnabled` 关闭时仍为 disabled；
- [ ] 设置页不再出现 Memory/隐私区块；两个页面的测试全绿；
- [ ] 偏好读写仍走 `runtime.storage.saveUserPreferences` 单一路径（App 层 handler 不复制逻辑）。

---

## P1-4 复盘中心减负 + 记录卡双入口

**目标**：记录列表为主；Memory 摘要默认折叠；记录卡区分「查看 / 再练一次」。

### 改动点

1. `LearnerMemoryPanel`（LibraryViews.tsx 16–42）包进 `<details>` 折叠块，
   默认关闭，摘要文案「你的长期记忆摘要」，位置保持在 HistoryView 上方；
2. HistoryView 记录卡增加双动作：
   - 「查看记录」→ 现有 `onOpen(session)`（行为不变，completed 进对比页）；
   - 「再练一次」→ 新增 prop `onPractice(questionId)`，App.tsx 复用现有
     `startQuestion`（与 ExpressionLibrary 708–715 同款逻辑，含原题缺失兜底文案）；
3. ReviewCenter 三 Tab 不动。

### 验收

- [ ] 从记录卡「再练一次」2 次点击内创建新 session 进入练习；
- [ ] 原题（含 legacy）缺失时按现有模式给出提示且不崩溃；
- [ ] LibraryViews.test.tsx 断言语义保留全绿（新增按钮允许补断言）；
- [ ] 验证链全绿。

---

## P1-5 三态组件统一（EmptyState / Loading / Notice）

**目标**：全站空态、加载态、顶部通知条各只有一个实现。

### 改动点

1. 新建 `src/app/components/`：
   - `EmptyState.tsx`：提升 `LibraryViews.tsx` 中的 `EmptyState`（281 行起），
     props 扩为 `{icon?, title, body, action?}`；
   - `Notice.tsx`：统一 `storageError` 与 `navigationNotice` 两条内联通知
     （App.tsx 622–638），props：`{tone: 'error'|'info', text, onDismiss}`；
   - `LoadingView` 留在 `app/AppFallbacks.tsx`，全站复用；
2. 替换点：`EmptyQuestionResult`、`StartupFailureView` 改用 `EmptyState`；
   `LibraryViews` 内 `EmptyState` 改为 re-export（不破坏现有 import）；
3. **CSS 类名一律保留**（`.empty-state`、`.notice` 等），本任务只合并结构不碰样式。

### 验收

- [ ] 全站无第二份空态/通知条内联实现（grep `.empty-state` 的使用点均经共享组件）；
- [ ] `role="alert"` / `role="status"` 语义与原实现一致；
- [ ] 验证链全绿；空题库搜索、启动失败、存储错误三场景手测表现不变。

---

## P1-6 语料 / 素材双功能差异化（产品已定稿：保持独立）

**定位轴**：个人语料 = **怎么说**（语言碎片，逐字复用）；
个人素材 = **说什么**（经历/观点/例子，思路提示）。

### 改动点

1. 复盘中心两个 Tab 保持独立，各加一行定义文案：
   - 语料 Tab：「下次可以直接说出口的句子和表达」；
   - 素材 Tab：「你的经历、观点和例子，用来支撑答案内容」；
2. 练习页两卡动作分层：
   - `ReusableMaterialCard`（语料）：保持「试听 + 插入答案」不变；
   - `PersonalMaterialIdeasCard`（素材）：主按钮改为「用作思路」，
     插入内容为标题级提示文本（非整段正文）。
     **默认按此执行（方案 A）；如产品在开工前要求保留整段插入（方案 B），
     则整段插入降级为折叠次要按钮，主按钮仍为「用作思路」。**
3. 管理页不合并：`ExpressionLibrary` 与 `PersonalMaterialLibrary` 组件各自独立，
   样式类可共享，React 组件与字段禁止互相渗透；
4. 领域守护：语料挂 `questionId/topic/reuseCount`；素材挂 `kind/tags/archived`；
   不得为"统一"在任一模型上补对方字段。

### 验收

- [ ] 练习页同时命中两卡时，按钮文案无歧义（不存在两个相同的「插入答案」主按钮）；
- [ ] 方案 A 下素材 `onUse` 插入文本为提示语，相关测试断言允许更新；
- [ ] 语料/素材各自的测试、云同步、ownerId 隔离行为不变（既有测试全绿）；
- [ ] 新用户仅凭 Tab 名+定义行可区分两者（5 秒自测：语料=句子，素材=经历）。

---

## P2 简报（轻量，P1 全部完成后逐项启动）

### P2-1 首页去重与点击区

- 评审 practice-mode-grid（Part 1/2/3 入口）与题库 Tab 的重复：
  保留则强化差异化文案（按状态推荐），或替换为「最近练过的 topic」；
- learning-snapshot 整卡可点击区域扩大，统计数字加 aria-label；
- 验收：首屏唯一 primary CTA；改版前后首页→练习的点击数不增加。

### P2-2 可访问性审计

- 暗色模式对比度（WCAG AA）全页面扫；触控目标 ≥44px；
- icon-only 按钮 aria-label 补全复查；
- 验收：审计清单逐条过；不引入自动化新依赖，人工+浏览器 DevTools 即可。

### P2-3 过渡与骨架屏

- view 切换淡入（受 `reduceMotion` 偏好约束，开启时禁用）；
- 题库列表/复盘列表骨架屏替换 LoadingView 全屏等待；
- 验收：`reduceMotion=true` 时零动画；感知性能主观提升，无布局抖动。

### P2-4 imports 样式方案统一

- 决策：`ImportWorkspace.module.css` 收敛进全局 CSS，或全站逐步迁 CSS Module（二选一，
  建议前者，改动小）；决策后一次性迁移该文件；
- 验收：ImportWorkspace 视觉无差异；全站样式方案唯一。

---

## 附：执行顺序与依赖

```
P0-1 → P0-2 → P0-3 → P1-1 → P1-2 → P1-3 → P1-4 → P1-5 → P1-6 → P2-1~P2-4
```

- P1-2 依赖 P1-1（顶栏抽组件更稳）；P1-5 依赖 P0-1（AppFallbacks 已存在）；
- P1-6 依赖 P1-1（语料/素材卡已各自成文件）；
- 其余严格顺序执行，不并行。

## 附：执行方式与已定稿决策

- **执行方式**：按上述顺序连续推进全部简报，中途不停下等待确认；
  每个简报完成后必须跑验证链并逐条核对验收清单，全部通过后立即开始下一个；
  任一简报验证失败：修复后重验，连续失败 2 次则记录原因、跳过该简报、继续下一个，
  并在最终报告中标注；全部完成后统一汇报（每简报：做了什么/验证结果/已知限制）。
- **已定稿**：P1-6 按方案 A 执行（素材只插入标题级提示）；
  P1-4 保留「再练一次」新增按钮。
