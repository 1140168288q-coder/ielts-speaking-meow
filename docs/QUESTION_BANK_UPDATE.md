# 季度题库更新机制（V2.0）

## 当前已审阅基线

内置题库是生成产物，不在业务代码中手工维护。当前基线来自：

```text
更新版-2026年5-8月雅思口语新题库0526(1).pdf
```

| 项目 | 基线值 |
| --- | --- |
| 季度 | `2026-05`（2026 年 5–8 月） |
| 源 PDF SHA-256 | `02ea9e1fe4cdee302a8949552cfe7de6d260a7c498c0185b70aeaa677db896de` |
| questions 内容 SHA-256 | `b6a63eb96398542af61cf93dd2e94dcc4a3dc13e8ddb2dbaa2f728f2cc073b38` |
| 解析器版本 | `2.2.0` |
| 题量 | Part 1：256；Part 2：60；Part 3：337；合计：653 |
| Part 2→Part 3 关联 | 337 条 |

生成结果为 `src/data/questionBank.generated.json`。应用启动时由
`src/data/questions.ts` 使用 Zod 校验文件格式、元数据、声明题量和题目结构，
然后导出 `questionBank`。

## 每季度更新步骤

1. 在 Git 中保留一个可回滚 checkpoint，并确认工作区没有来源不明的题库改动。
2. 把新 PDF 放到项目目录。PDF 已被 `.gitignore` 忽略，不进入仓库。
3. 独立记录源文件指纹，便于和生成 JSON 中的 `sourceSha256` 交叉核对：

   Windows PowerShell：

   ```powershell
   Get-FileHash -Algorithm SHA256 -LiteralPath "新季度题库.pdf"
   ```

   Linux：

   ```bash
   sha256sum "新季度题库.pdf"
   ```

4. 运行唯一的生成命令：

   ```bash
   npm run question-bank:update -- "新季度题库.pdf"
   ```

   脚本会读取同一份源文件字节来计算 SHA-256，并解析 Part 1 / 2 / 3、Topic、
   `[new]` / `[old]`、Part 2 cue points 及 Part 2↔Part 3 双向关联。全部校验
   通过后才覆盖生成 JSON；解析或校验失败时保留上一版生成文件。

5. 审阅命令输出和 `git diff -- src/data/questionBank.generated.json`：

   - `sourceFile`、`sourceSha256`、`seasonLabel` 与本季度源文件一致；
   - 题量和分类分布符合 PDF 目录与抽样页；
   - 抽样核对 new/old、跨行标题、Part 2 cue points 和对应 Part 3；
   - 生成题目中没有页眉、页码、目录点线或章节标记；
   - 不直接手改生成 JSON 来“修复”解析结果。

6. 更新测试中明确固定的季度、源 SHA-256、`JSON.stringify(questions)` 内容
   SHA-256 和审阅后题量；同时抽查发生过语义修复的 topic/prompt。id 序列和
   P2→P3 关系指纹必须保持不变，除非来源题目本身确实增删。这些断言是防止误拿
   旧 PDF、错误 PDF 或残缺解析结果的人工确认点，不应由生成器自动改写。
7. 运行题库门禁及项目门禁：

   ```bash
   npm test -- scripts/import-question-bank.test.mjs src/data/questions.test.ts
   npm run typecheck
   npm run lint
   npm run build
   ```

   发布前再运行项目统一门禁：

   ```bash
   npm run verify
   ```

8. 在版本发布说明中记录季度、源 SHA-256、解析器版本和题量，再提交生成 JSON、
   解析器、测试及文档。

## 生成器会拒绝什么

以下任一情况都会使生成命令失败，不再只打印 warning：

- 任一 Part 解析题量低于安全下限；
- id 重复、id 与 Part 不一致、缺少 topic/category/new-old/source/difficulty；
- 来源分类不属于该 Part 的已知分类；
- Part 2 不是 `Describe ...` cue card，或真实 cue points 少于 2 条；
- cue point 起始词异常，或 cue points/关联数超过运行时模型上限；
- Part 2/3 关联缺失、悬空、重复或双向不一致；
- Part 2 派生的 Part 2/3 topic 超过 80 字符、在词中间截断，或以连接词、介词、
  冠词、残缺缩写结尾；
- 题面、topic 或 cue point 出现 `@@PAGE`、`Warning:`、`You should say:`、
  目录点线、`[new]` / `[old]` 泄漏、控制字符或换行；
- 英文逗号与后词粘连、未规范化的 `e. g.`，或孤立 OCR token `pf`；
- JSON 输入包含未知字段或不符合内置题库结构。

校验器有意允许两种真实来源差异：不同 Topic 中出现完全相同的题面，以及每张
Part 2 cue card 具有不同数量的 Part 3 跟进题。它只要求 id 唯一和关联完整，
不会错误地强制题面唯一或固定 Part 3 数量。

解析器绝不再自动补写通用 cue points。若源 PDF 中确实有提示而脚本没有解析到，
应修复解析器并重新生成；若源 PDF 本身残缺，应更换可靠源文件。OCR 修复同样只
接受高置信度、带明确回归测试的规则：当前 `pf`→`of` 只匹配独立小写 token，
不会替换单词内部字符或大写缩写。

## JSON 元数据

```jsonc
{
  "format": "ielts-speaking-meow-question-bank",
  "formatVersion": 2,
  "parserVersion": "2.2.0",
  "seasonLabel": "2026-05",
  "sourceFile": "更新版-2026年5-8月雅思口语新题库0526(1).pdf",
  "sourceSha256": "02ea9e1f...896de",
  "generatedAt": "ISO 时间",
  "counts": { "1": 256, "2": 60, "3": 337 },
  "questions": []
}
```

`formatVersion` 表示生成 JSON 的结构版本；`parserVersion` 表示解析与校验逻辑
版本。修改解析规则或校验语义时必须同步提升 `PARSER_VERSION`，让生成结果可
追溯到具体实现。仅更换季度 PDF 不需要修改业务代码或格式版本。

## PDF 排版变化时的处理

解析器只适配当前“新航道季度题库”版式。新季度生成失败时：

1. 根据第一个校验错误定位正文标题、目录跳过、跨页续行或 cue point 识别问题；
2. 只修改 `scripts/import-question-bank.mjs` 的解析适配，并补充失败回归测试；
3. 提升 `PARSER_VERSION`，重新运行生成和全部门禁；
4. 对照 PDF 抽样复核，不在 UI、`questions.ts` 或练习服务中写季度特判；
5. 连续两次无法可靠解析时停止，保留旧生成文件并换用更可验证的来源或版式。

## 源文件与版权

原 PDF 属于题库出版方文件，且二进制文件不适合代码评审，因此不提交 Git。
仓库只保留生成器、结构化生成结果、完整性测试和来源文件指纹。对外分发前仍需
由项目维护者确认题库文本的授权与使用边界。
