# 按证据完成构建、部署与交付：来源与迁移边界

核对基线：e15d7a2；2026-09-20。

## 历史证据

2026-09-05 v2.1.10记录自动化、真实公网一答/二答和Debug APK，但目标家庭Linux和物理Android设备未验收。
2026-09-07 v2.2.0记录Release APK、模拟器与公网健康；同轮真实付费业务路径未验收。
2026-09-09 v2.2.1已完成代码/Debug APK，Docker环境当时阻塞公网部署。
2026-09-18版本同步报告发现源代码/客户端为2.2.1，但运行后端仍为2.2.0；备份数据库后重新构建部署。

这些记录不是矛盾的“永远成功/永远失败”，而是各轮交付环境不同。

## 当前实现依据

路径相对于原项目，不是技能运行依赖。

- package.json — verify统一入口。
- scripts/android-build.ps1:32-36 — 正式签名与地址前置检查。
- scripts/android-build.ps1:220-235 — Release产物签名检查和hash。
- docs/DEEPSEEK_AI_RELIABILITY_REPAIR_REPORT.md — 2.1.10及限制。
- docs/COMPETITION_FIX_RESULT.md — 2.2.0交付与未验收环境。
- docs/AI_DIFFICULTY_USER_RAG_QUESTION_MANAGEMENT_RESULT.md — 2.2.1实现、APK、环境阻塞。
- docs/VERSION_SYNC_REPORT.md — 数据库备份、镜像与公网对照。
- docs/UI_OPTIMIZATION_v2.2.2_REPORT.md — UI版本变更及历史验收。

## 迁移边界

Android的versionCode、APK签名不是Web或桌面项目的硬性要求，替换为目标平台的真实标识和验证工具。旧测试数、hash及域名不可复制进新报告。本次技能提炼未构建APK或重新发布，只将历史记录与当前脚本交叉核对。

