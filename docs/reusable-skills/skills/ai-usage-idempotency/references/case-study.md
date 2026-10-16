# AI 重试、配额和幂等结算：项目来源与迁移边界

核对基线：e15d7a2；2026-09-20。当前源码检查与历史运行记录分别标注。

## 演进与最终实现

2026-09-05首先将反馈的授权与成功后结算拆开；当时同键重试仍可能再次访问上游。2026-09-07进一步加入请求摘要、短期结果缓存、执行前幂等检查，并扩展到整理和TTS。不要把早期方案描述成最终实现。

## 当前证据

原项目相对路径，仅作溯源。

- backend/app/routers/feedback.py:136-174 — 授权、缓存/已结算检查、执行、结算、缓存。
- backend/app/services/feature_authorization.py:123-165 — PostgreSQL用户行锁跨执行期保留。
- backend/app/services/feature_authorization.py:168-285 — 结算和去重。
- backend/app/services/feature_authorization.py:490-559 — 进程内锁与24小时、256项缓存。
- backend/app/services/feature_authorization.py:600 — 路由加规范化payload摘要。
- backend/tests/test_feedback_router.py:410、445、482 — 失败不扣和瞬时故障有限重试用例。
- docs/COMPETITION_FIX_RESULT.md — 幂等缓存、worker/重启限制。
- backend/alembic/versions/0004_usage_request_hash.py — 请求摘要迁移。

## 迁移边界

24小时、256项、按用户长事务锁都是本项目的实现参数。已提交计量事件但当前worker无结果缓存时，当前路由拒绝重放，不持久化私人响应。它并不解决所有“上游成功但本地提交前崩溃”的不确定性，也不等于真实支付账务系统。本次仅检查源码与历史测试记录，没有再做生产并发或崩溃实验。

