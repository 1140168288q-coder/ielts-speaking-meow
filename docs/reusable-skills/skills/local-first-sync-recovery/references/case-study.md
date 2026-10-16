# 案例：离线口语训练向账号、同步和可恢复导入演进

## 历史演进

早期版本保存练习、录音与个人表达；后续移除应用内录音和 STT，但仍需维护历史录音。
本地账号加入后，旧无拥有者记录归本机用户，新数据按账号隔离。
云端账号引入的是用户主动同步，不替代本地训练；知识库与季度题库管理又增加结构化导入、删除和安全替换。
历史数据因此同时跨越产品能力、实体结构与账号模型变化，不能简单清库重建。
范围来源见 `AGENTS.md` 的 Local Accounts、Cloud Backend、Privacy and Secrets、Acceptance Flow；安全换季与保留快照的计划见 `docs/AI_DIFFICULTY_USER_RAG_QUESTION_MANAGEMENT_PLAN.md:433-471`。
本文路径均为原项目溯源，不是独立技能的运行依赖。

## 当前实现与可迁移经验

### 写入可靠性与迁移

`src/infrastructure/storage/indexedDbStorage.ts:186-222` 在同一个 IndexedDB 事务内读取并更新练习记录。
`src/infrastructure/storage/indexedDbStorage.test.ts:160` 检查并发更新合并；`:186`、`:209`、`:241` 覆盖原录音保存及替换/读取失败时不误删已有录音。
`src/application/practiceService.test.ts:218` 检查反馈仅在原回答未变化时应用；`:508` 检查账号隔离。
`src/infrastructure/storage/indexedDbStorage.v2.test.ts:61` 检查增加存储不重写旧练习/表达/录音；`:145` 和 `:188` 检查损坏元数据隔离而不销毁原始记录。

### 导入与换季使用真实事务

`src/application/imports/importMaterialService.test.ts:73` 要求预览阶段不持久化私有原材料；`:102` 检查确认后原件与题目一起提交；`:241` 禁止失败后报告成功。
`src/infrastructure/storage/indexedDbStorage.ts:985` 为普通导入，`:1021` 为导入加旧题库替换，`:1151` 为知识库来源、条目与原件事务。
`src/infrastructure/storage/indexedDbStorage.v2.test.ts:237` 注入中止并验证整个导入回滚；`:305` 验证依赖不一致时先拒绝；`:336` 检查换季中止仍保留旧题库状态。
`src/application/practiceService.ts:79-87` 允许保存题目快照；`src/App.tsx:723-728` 将历史快照用于历史题目解析。

### 同步不是一次上传请求

`src/application/cloudSyncService.ts:69-82` 从已同步实体版本构建持久化操作。
`:95-120` 校验回包后仅移除 applied 操作；`:145-160` 先应用变更再保存游标和实体状态。
`src/application/cloudSyncService.test.ts:17`、`:94`、`:114`、`:161` 分别覆盖部分成功、网络重试复用 ID、缺项响应、应用失败不跳游标。
`src/infrastructure/storage/indexedDbStorage.cloudSync.test.ts:42`、`:83`、`:102` 覆盖重启队列持久化、同 ID 内容变更拒绝及账号隔离。
服务端 `backend/app/routers/sync.py:34-37`、`:54` 使用已认证用户 ID；`backend/app/services/sync_service.py:29` 丢弃 payload 的 ownerId，`:102-104` 为每个用户串行化同步事务，`:141` 检测基准版本冲突。
`backend/tests/test_sync_router.py:169` 验证服务端身份隔离；`:214` 验证删除保留带版本墓碑；`:256` 验证分页游标递增。

### 同步与完整备份有不同边界

`src/application/accountCloudSyncService.ts:759-769` 移除练习中的本地 ownerId 与录音引用，知识来源和条目作为结构化实体同步。
`src/application/accountCloudSyncService.test.ts:35` 验证当前账号范围和录音排除；`:74` 验证未提交草稿不入队；`:207` 验证并发修改不覆盖本地内容；`:289` 验证远端墓碑应用。
`backend/README.md:314-317` 说明原件、缓存、密钥和派生 Memory 快照不属于同步内容；结构化练习和确认事实仍可同步。
`src/application/storageBackupService.ts:200-222` 先检查大小、格式和依赖录音；`:255-263` 先检查账号身份冲突。
`src/application/storageBackupService.test.ts:270` 验证备份往返；`:299` 验证缺引用录音时不写元数据；`:319` 验证旧备份不覆盖较新练习；`:349` 验证账号素材和导入依赖恢复。

## 失败教训与当前局限

- 硬删除没有墓碑，会让另一台设备的旧值复活。排除规则自身的 deletedAt 又有特殊语义，不能把所有删除机械地变成同一种空 payload。
- 网络成功不意味着整批数据成功。服务端可能逐项应用、冲突或拒绝；客户端只能清理明确成功的操作。
- `cloudSyncService.ts:146-147` 的变更应用与游标提交先后执行，不是统一跨层事务。正确性依赖变更可重放，不能声称天然 exactly-once。
- `docs/COMPETITION_FIX_PLAN.md:24` 明确云端冲突解决入口仍未实现；当前“不覆盖、保留冲突”不等于完整冲突解决体验。
- `storageBackupService.ts:200` 之后的恢复包含分阶段写入，并非整个备份一把全局事务。前置校验降低风险，仍需交代中途失败和重试语义。
- `practiceService.ts:338-340` 的语料写入与 `:365-389` 的练习/Memory 更新也不是跨实体统一事务。不能把某处原子更新概括成全应用原子性。

## 不可照搬的参数与验证状态

原项目选用 IndexedDB 与 FastAPI/PostgreSQL，目标项目可映射到 SQLite、文件数据库、服务端关系库或其他存储。
上传每批 100、拉取默认 200、备份上限 300MB，以及英语练习的历史录音需求是具体约束，不是通用建议。
服务端账号行锁适合该项目同步规模；高并发协作需重新评估竞争、冲突模型和删除保留策略。
本次提炼静态核对了源码、测试定义和文档，未重新运行上述业务测试；不能把这些引用当作本次真机、多设备或灾难恢复测试证据。
