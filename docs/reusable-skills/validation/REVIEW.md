# 三组原始场景输出

这是便于人工核对的原始对照入口。每组使用相同题设，一份读取对应技能，一份按一般能力直接作答。两份都是设计推演，未运行目标产品。

| 场景 | 题设及断言 | 使用技能 | 未使用技能 |
|---|---|---|---|
| 模型字段格式漂移与超时 | [题设](iteration-1/contract-drift/eval_metadata.json) | [方案](iteration-1/contract-drift/with_skill/outputs/response.md) | [基线](iteration-1/contract-drift/without_skill/outputs/response.md) |
| 模板经历误入个人Memory | [题设](iteration-1/memory-provenance/eval_metadata.json) | [方案](iteration-1/memory-provenance/with_skill/outputs/response.md) | [基线](iteration-1/memory-provenance/without_skill/outputs/response.md) |
| 多worker计量与崩溃重放 | [题设](iteration-1/quota-crash-replay/eval_metadata.json) | [方案](iteration-1/quota-crash-replay/with_skill/outputs/response.md) | [基线](iteration-1/quota-crash-replay/without_skill/outputs/response.md) |

阅读时可检查：是否找到最早失败层、是否保留用户数据、是否把某个项目特例强加给新项目、是否准确区分“保证”与“局限”。不能因为方案用了相同术语就认定已经解决问题。
