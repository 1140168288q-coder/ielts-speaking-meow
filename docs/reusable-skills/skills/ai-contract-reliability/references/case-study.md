# AI 结构化输出与真实请求排障：项目来源与迁移边界

核对基线：e15d7a2；2026-09-20。当前源码检查与历史运行记录分别标注。

## 历史案例

2026-09-05 的修复报告记录：二答页面把 Provider 实例方法取出后调用，丢失 this，在发请求之前失败；另有客户端预算早于服务端结束的问题。页面级真实 Provider 测试比 vi.fn 替身更能暴露这个错误。

2026-09-18 提交 544e3c9 修复另一类问题：模型已返回，但 sourcePart 偶发为 "Part 1"，服务端字段校验拒绝响应。最终增加明确等价表示的归一化，仍拒绝未知内容；一答和二答 finally 均刷新健康缓存。

## 当前实现与证据

以下路径相对于原项目根，仅作溯源；技能执行不依赖该仓库。

- backend/app/services/deepseek_service.py:145 — normalize_source_part。
- backend/app/services/deepseek_service.py:651 — 总预算内的有限重试。
- backend/app/services/deepseek_service.py:874 — 完成原因检查。
- src/infrastructure/backend/backendTextProvider.ts:113、151 — finally 刷新。
- src/features/practice/PracticeFlow.text.test.tsx:414 — 真实 Provider 二答调用用例。
- backend/tests/test_feedback_router.py:114、133 — 等价格式与非法值用例。
- docs/DEEPSEEK_AI_RELIABILITY_REPAIR_REPORT.md — 2026-09-05 历史验证与限制。

## 迁移边界

项目的数字 Part、双参考答案、禁止评分是雅思业务约束，不属于所有 AI 应用。10/75/90/105 秒是当时链路预算，不是默认配置。合法格式归一化不等于容许虚构业务内容。历史公网成功属于当时证据，本次提炼未重新调用生产 API。

