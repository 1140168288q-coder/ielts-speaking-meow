# 案例：季度题库由宽松解析升级为来源保真管线

证据读取于 2026-09-20。原项目路径仅作溯源；技能不依赖这些文件存在。

## 历史失败与修复

V1.8 提交 `dd2d01e` 引入 PDF→结构化 JSON 生成。其 `scripts/import-question-bank.mjs:422-428` 在真实 cue points 不足时自动补入 “Explain the main details.” 和 “Say why this is meaningful to you.”，表面满足最少数量却丢失来源忠实性。该提交第 582-594 行对关系悬空、缺少关联和题量偏少仅记录 warning。

当前版本不再补写通用内容；`scripts/import-question-bank.mjs:435-444` 仅规范化真实来源字段，缺失由校验拒绝。`docs/QUESTION_BANK_UPDATE.md:82-106` 记录题量、结构残留、关系和 OCR 异常的拒绝策略，并明确不应凭空填补 cue points。

这不是“AI 不能生成补充材料”的规则；错误在于把补写伪装为来源事实。目标应用若允许生成补充，应另存建议及来源类型。

## 当前实现

- 使用同一次读取的 bytes 解析并计算 SHA-256：`scripts/import-question-bank.mjs:63-84`。
- 解析器版本、结构版本、季度、来源指纹与题量写入元数据，同上；应用启动再校验严格结构及声明题量：`src/data/questions.ts:14-48`。
- 旧题目保留为历史查找，不重新进入当前题库：`src/data/questions.ts:60-63`；对应测试 `src/data/questions.test.ts:162`。
- 审阅来源为 2026-05 季度、653 题、337 条 P2→P3 关系：`docs/QUESTION_BANK_UPDATE.md:11-18`。这些是特定基线，不是通用阈值。
- 缺失 cue points 拒绝、标题/OCR 问题拒绝、关系损坏拒绝：`scripts/import-question-bank.test.mjs:114-169`。
- 来源元数据、合法重复题面、来源提示点、双向关系有测试：`src/data/questions.test.ts:5-160`。
- 更新规范明确生成器不自动改写人工审阅后的来源/内容指纹：`docs/QUESTION_BANK_UPDATE.md:52-63`。

## 保证的边界

当前 `run` 在校验成功后调用 `writeFile`，因此解析或校验失败不会覆盖旧产物；但它没有临时文件+rename，不能据此宣称写入断电也具备原子替换保证。技能将两种保证分开。

V1.8 文档记载统一门禁和 Android Debug 构建通过，见 `docs/V1.8_RELEASE.md:67-78`；其正式 Release APK 未生成，见第 85-93 行。此次提炼只读取源码、测试和记录，没有重新解析原始 PDF 或执行发布。

## 不宜照搬

新航道版式、Part 1/2/3、Describe cue card、固定题量下限、80 字符标题以及 `pf`→`of` 都是来源特定假设。其他项目应从自己样本和下游契约重新建立阈值与规则。
独立小写 token 的 OCR 修复有意避开词内字符和大写缩写，见 `docs/QUESTION_BANK_UPDATE.md:103-106`；迁移时应保留“最窄可靠修复”的方法，不复制替换字符串。
源文件授权和发布边界仍需由维护者确认：`docs/QUESTION_BANK_UPDATE.md:138-142`。生成成功不等于内容可任意再分发。
