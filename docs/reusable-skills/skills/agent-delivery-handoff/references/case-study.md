# 可恢复、可交接的 AI 协作开发：来源与迁移边界

核对基线：e15d7a2；2026-09-20。

## 历史证据

仓库从V1.0计划、V1.1/V1.2方案，到V2重构、P0/P1/P2修复、AI可靠性方案/交付报告，形成“计划→实现→证据”的可交接记录。
2026-08-19提交cd99a0f增加自救协议，针对无输出任务、常驻浏览器、重复失败和遗留进程。
2026-09-09在v2.2.1修改前有checkpoint提交17a7fdd；2026-09-18 UI改动前有dea899e。检查点不能代替私有数据备份。

## 依据

相对原仓库路径，复制技能后不需要原仓库。

- AGENTS.md — Self-Rescue Protocol、Coding Agent Rules、Acceptance Flow。
- docs/DEEPSEEK_AI_RELIABILITY_REPAIR_PLAN.md — 可交给执行者的修复方案。
- docs/DEEPSEEK_AI_RELIABILITY_REPAIR_REPORT.md — 根因、实现、验证与限制。
- docs/COMPETITION_FIX_PLAN.md、docs/COMPETITION_FIX_RESULT.md — 分级范围与交付。
- git cd99a0f、17a7fdd、dea899e — 自救规则和阶段检查点。

## 迁移边界

原项目有“先给方案/提示词审阅”等具体轮次请求，不应写成所有未来任务都必须再次审批。保留已授权范围内自主执行。Windows、特定命令和“两次失败后换路径”是可调整操作策略，不是跨平台API合同。用户未要求新分支、安装、发消息或上线时，技能不会从经验推导额外授权。

