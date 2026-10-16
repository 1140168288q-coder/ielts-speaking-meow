# 证据来源与提炼边界

## 核对方法

本次检查当前Git基线、全部提交标题、主要阶段文档，以及每类经验对应的当前源码和测试定义。V1.7/V1.8等易混淆处核对了对应提交快照。额外读取的既往任务记忆只作为定位线索，最终技能案例尽量落到仓库证据；没有读取部署密钥、用户数据库内容或真实答案来制作案例。

这里使用五类标记：**历史决定/变更、当前实现、历史验证、当前静态检查、提炼建议**。案例中的测试路径表示存在对应测试定义，除非验证记录明确说明本次执行，否则不表示重跑通过。

## 经验到证据

| 技能 | 历史锚点 | 当前入口/测试线索 | 需要防止的误推断 |
|---|---|---|---|
| core-loop-scope | `f7fed36`、`b93a696`、`dd2d01e` | AGENTS、V1.7、legacy兼容 | 推测STT删除动机；把后改文档当旧版本 |
| ai-contract-reliability | `f12f456`、`544e3c9` | deepseek_service、backendTextProvider、test_feedback_router | 200就成功；放松所有契约 |
| async-workflow-integrity | `f12f456`、`07f2ba1` | practiceService、PracticeFlow.text.test | 单记录原子等于整条链事务 |
| ai-usage-idempotency | `f12f456`、`07f2ba1` | feature_authorization、feedback路由、usage迁移 | 后结算等于上游免费；缓存等于全局恰好一次 |
| grounded-rag-memory | `dd2d01e`、`61d621f` | userMemory、userKnowledgeService、来源测试 | 引用存在等于内容真实；模板经历等于本人经历 |
| local-first-sync-recovery | `25f8bc4`、`07f2ba1`、`61d621f` | cloudSyncService、storageBackupService、test_sync_router | 云端200等于整批同步；备份文件等于已恢复 |
| source-import-pipeline | `dd2d01e`与当前解析器 | import-question-bank、QUESTION_BANK_UPDATE | 补造正文算解析成功；校验后写等于抗中断原子写 |
| interruptible-provider-fallback | `9121ec5`及后续语音修复 | audioCoordinator、fallbackTtsProvider、backendTtsProvider | 失效令牌等于取消上游收费；提示降级等于已播放 |
| public-stack-recovery | `daaaf2c`、`e15d7a2` | windows-public-stack、VERSION_SYNC_REPORT | 引擎活着等于栈健康；443通等于Tunnel通 |
| evidence-based-release | 各版本RESULT与发布提交 | android-build、package脚本、发布报告 | Debug/模拟器等于正式真机；本机等于Linux目标 |
| evidence-based-demo | 9月材料规划与录屏记录 | 共同事实说明、脚本、演示导入说明 | 规则编排等于模型自治；mock截图等于真实AI |
| agent-delivery-handoff | `cd99a0f`、`17a7fdd`、`dea899e` | AGENTS自救协议、方案/结果成对文档 | 检查点等于所有数据备份；旧审批请求永远适用 |

详细文件和行号保存在各技能的 `references/case-study.md`。行号仅针对整理时基线，代码变化后应按函数/测试名称重新定位。原仓库外的技能使用者无需访问这些证据文件。

## 已发现并处理的时序问题

1. 当前 `docs/V1.7_RELEASE.md` 包含后来的双版本答案说明；`b93a696`快照仍为三个参考答案及improvedAnswer。
2. 当前 `docs/V1.8_RELEASE.md` 提到后续云同步；`dd2d01e`快照仅预留身份。
3. 早期 `docs/DEPLOY_WINDOWS_PUBLIC.md` 侧重重启Tunnel；当前守护源码已检查完整服务栈。
4. 9月5日幂等方式与9月7日最终方式不同，不能混合描述。
5. 2.2.1当轮部署阻塞与9月18/19日后来成功是不同日期的事实。

## 本次未做的验收

本次是技能提炼，不是产品重新发布。没有重跑原产品全量测试、调用真实付费AI/TTS、读写生产数据库、重建APK、停机演练、双设备同步或验证新用户效果。这些缺口不妨碍提炼历史经验，但限制了对产品当前运行状态的断言。

新增技能的结构检查和场景试用另见 [验证记录](validation/README.md)。不能把技能文件检查通过，转述成原项目今天已完成全部功能验收。
