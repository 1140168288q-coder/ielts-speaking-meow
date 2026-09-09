# V2.2.1 本轮实施结果

实施目录：`D:\111-Trae_project\雅思喵\雅思口语喵`

实施日期：2026-09-09
版本：Web/Backend `2.2.1`；Android `versionCode 20`、`versionName 2.2.1`

## 交付内容

### 阶段 A–B：AI 生成档位与契约

- 新增自然提升版“简单 / 中等 / 较难”和“英式 / 美式自然口语”稳定 profile；设置页保存默认值，
  练习页可按题覆盖，练习记录保存当次 profile 快照。
- Part 1/3 使用弹性短回答预算，Part 2 使用独立一到两分钟长回答预算；档位只影响自然提升版，
  简单优化版仍只修正原回答事实。
- DeepSeek system prompt、Backend Pydantic、客户端 Zod 均校验枚举、双版本顺序、来源引用和
  AI 示例 `replaceable=true`；非法来源在额度结算前拒绝。
- 保留现有稳定幂等键、网络重试、成功后结算额度、二次回答确认 Memory、无评分和无语音评价边界。

### 阶段 C：个人知识库

- 复用本机 MaterialExtractor 支持 TXT、MD、DOCX、PDF、JPG、PNG；保留页码/章节、OCR 警告、
  48,000 字符 / 24 分块 / 60 条候选上限，超限要求拆分而不会静默截断。
- 新增 `/v1/knowledge/organize`，使用 organize entitlement/quota、稳定 sourceHash 幂等、
  严格候选结构和 prompt-injection 防护。
- 新增草稿、AI/离线整理、逐条预览编辑、确认落盘、来源查看、条目启停/编辑/删除和整份来源删除；
  原始文件只进入本机备份，知识结构化条目进入同步。

### 阶段 D：题库管理与换季

- 题库支持左滑显示删除、无障碍删除按钮、管理模式多选/全选当前筛选/类别删除，以及保留历史记录
  的一键清空。
- 通过账号隔离的 question exclusion / bank exclusion 隐藏状态实现删除，不修改打包题库 JSON，
  历史 session 的 questionSnapshot 继续可读。
- “导入并换季”在 IndexedDB 单事务内写入新导入题、原始文件、来源元数据和旧题排除状态；事务失败
  时旧题库保持可见。重导入同 ID 的题不会被旧排除状态误隐藏。

### 阶段 E：同步与备份

- 云同步新增 `imported_question`、`import_source_metadata`、`question_exclusion`、
  `question_bank_exclusion`、`knowledge_source`、`knowledge_entry`，按云账号 owner 隔离，删除保留
  tombstone，原始二进制不上传。
- 本地备份格式升级为 v3，包含生成偏好、session profile、导入/知识来源和文件、题目删除状态；
  旧 v1/v2 备份仍可导入，恢复前校验 schema、owner、引用和文件大小。

### 阶段 F：质量评测与文档

- 固定样例和人工评测表见 [AI_DIFFICULTY_USER_RAG_QUESTION_MANAGEMENT_EVAL.md](./AI_DIFFICULTY_USER_RAG_QUESTION_MANAGEMENT_EVAL.md)。
- 当前自动测试使用 fake provider / MockTransport，不调用真实付费 DeepSeek；静态提示词和来源边界
  回归均纳入前后端测试。
- README、Backend API 文档、V2 架构和 AGENTS 当前行为已同步更新。

## 验证结果

以下命令均在本机完成；前端测试使用 fake provider / MockTransport，不消耗真实第三方额度。

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test -- --run` | PASS；62 个测试文件、373 个测试 |
| `npm run test:backend` | PASS；96 个测试 |
| `npm run build` | PASS；2021 modules transformed |
| `npm run verify` | PASS；包含上述类型、lint、前端、Backend 与生产构建门禁 |
| Android Debug 构建 | PASS；Gradle Debug 单测与 lint 通过 |

## APK

产物：[ielts-speaking-meow-v2.2.1-debug.apk](../artifacts/ielts-speaking-meow-v2.2.1-debug.apk)，
SHA-256：`8e63a1e40b5d012a6b875fc6c3bada649a8e9c134fc7bef935a1eabbe7a1b759`。
`aapt2 dump badging` 核验为包名 `com.ieltsspeakingmeow.app`、`versionCode 20`、
`versionName 2.2.1`。`apksigner` 核验通过 APK Signature Scheme v2，签名证书为 Android
Debug（SHA-256 `036321a5e330c02eb745553610e25cab26d1f92a93ecf4aa068676c4bf9789eb`）。这是
可安装的 Debug 包，不能称为正式 Release 包。

## 部署与版本发布

- 三份 Compose 组合（基础、局域网、本机 Cloudflare Tunnel）均使用 `.env.deploy` 通过
  `docker compose config --quiet` 校验；未打印或提交任何密钥。
- 已修复 Windows 公网栈脚本在 Docker 引擎未运行时的异常处理，并尝试启动现有公网栈；本机
  Docker Desktop 当前仍未提供可用 Linux Engine，因此未伪称容器或公网健康检查已经完成。
- 代码提交、版本标签和远端推送将在本次交付提交完成后记录在此处。

## 真实环境限制

- 当前自动化不调用真实 DeepSeek、真实火山 TTS 或真实邮件服务；上游可用性、额度结算和失败路径
  通过 fake provider / MockTransport 验证。
- 若本机没有 Android 真机/模拟器，不能声称完成触摸左滑、系统键盘输入、TTS 和双设备云同步验收；
  需在目标设备按 AGENTS acceptance flow 手动复核。
- 云端 PostgreSQL、Cloudflare Tunnel、邮箱验证和另一设备恢复需在目标 Linux/公网环境执行；本轮
  只完成代码、SQLite 测试和部署配置审查，不把配置审查称为生产上线。
