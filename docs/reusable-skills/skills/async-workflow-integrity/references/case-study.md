# 保护多阶段 AI 流程的异步状态与用户输入：项目来源与迁移边界

核对基线：e15d7a2；2026-09-20。当前源码检查与历史运行记录分别标注。

## 演进

2026-09-05 修复一答/二答共用忙碌状态导致后续调用静默消失，以及分析到达后修正草稿未正确初始化的问题。2026-09-07 加强会话原子更新、答案快照检查和完成后的只读复盘。

## 当前证据

路径相对于原项目，仅供溯源，复制技能后无需原仓库。

- src/application/practiceService.ts:176-215 — 一答/二答反馈写入时检查 attempt、正文、更新时间。
- src/application/practiceService.ts:552 — updateSessionAtomically 与回退队列。
- src/features/practice/PracticeFlow.text.test.tsx:523 — 前序 pending 时排队。
- src/application/practiceService.test.ts:218 — 输入变更后拒绝旧反馈。
- docs/DEEPSEEK_AI_RELIABILITY_REPAIR_REPORT.md — R1/R4/R7修复。
- docs/COMPETITION_FIX_RESULT.md — 会话并发与原子更新的历史交付记录。

## 限制

当前 practiceService 的语料逐条写入在后续 session 更新之前；不能宣称语料加 Memory 的完整确认过程具有跨实体事务。迁移项目若要求全有或全无，必须明确新的事务或恢复方案。

两次回答是原产品流程；可以迁移到“提取→确认→生成”“草稿→审核→发布”，无需保留两答概念。禁用离开操作并非所有产品的最优交互；核心要求是成果不丢失且状态可理解。

