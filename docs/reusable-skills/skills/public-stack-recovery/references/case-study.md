# 公网 AI 服务分层诊断与整栈恢复：项目来源与迁移边界

核对基线：e15d7a2；2026-09-20。当前源码检查与历史运行记录分别标注。

## 历史案例

2026-09-07/08解决Windows监控随交互控制台退出的问题。2026-09-19的e15d7a2解决Docker仍在运行、业务容器却退出时只重启Tunnel的问题：先检查postgres/backend/cloudflared，缺失则完整compose up；计划任务取消默认运行时限。

同次历史诊断区分了Cloudflare API的443连通和Tunnel 7844数据通道失败；VPN虚拟DNS/路由是该现场的环境因素，不能泛化为所有公网故障的根因。

## 当前证据

原项目相对路径，仅供溯源。

- scripts/windows-public-stack.ps1:118 — Ensure-PublicStack。
- scripts/windows-public-stack.ps1:128 — 枚举三项必要服务。
- scripts/windows-public-stack.ps1:175 — 隐藏窗口、独立计划任务、运行时限。
- scripts/windows-public-stack.ps1:214 — 监控循环与恢复/冷却。
- git e15d7a2、daaaf2c — 两次守护修复。
- docs/DEPLOY_WINDOWS_PUBLIC.md — 既有运行方式；该文档仍侧重早期Tunnel重启行为，最终逻辑以源码为准。
- docs/VERSION_SYNC_REPORT.md — 历史数据库dump、镜像与公网版本对照。

## 限制与迁移

当前计划任务以交互用户登录触发，不能称为无人登录也可靠运行的服务器服务。源码的常规健康探针检查HTTP成功及status，未完整验证版本/上游；技能要求的分层验收是提炼后的工作方法，不是声称现有脚本已全部实现。

端口、服务名、轮询间隔和系统任务格式仅适用于原部署。其他平台应采用其服务管理器和实际网络配置。本次没有停止生产容器、切换网络或重新验证公网可用性。

