# 季度题库更新机制（V1.8）

## 目标

内置题库是**生成产物**，换季度不手工改业务代码。当前内置题库来自：

```text
更新版-2026年5-8月雅思口语新题库0526(1).pdf
```

生成结果：

```text
src/data/questionBank.generated.json
```

应用运行时由 `src/data/questions.ts` 用 Zod 校验后导出 `questionBank`。

## 更新步骤

1. 把新季度题库 PDF 放到项目目录（PDF 已被 `.gitignore` 忽略，不进入仓库）。
2. 执行：

   ```bash
   npm run question-bank:update -- "新季度题库.pdf"
   ```

3. 脚本会：
   - 用项目内已有的 `pdfjs-dist` 提取文本；
   - 识别 Part 1 / Part 2&3 正文（自动跳过目录页）；
   - 解析 topic、`[new]/[old]`、Part 1 题目、Part 2 cue points、
     Part 3 跟进题，并双向建立 `relatedPart3Ids` / `part2QuestionId`；
   - 为每道题生成稳定 id；
   - 校验重复 id、Part 2 cue points、Part 2↔Part 3 关系后覆盖 JSON。
4. 执行全量门禁：

   ```bash
   npm run verify
   ```

   `src/data/questions.test.ts` 会再次验证：
   - 三个 Part 都有足够题目；
   - id 唯一、new/old 完整；
   - 每个 Part 2 至少 2 个 cue points；
   - 每个内置 Part 3 都能回链到唯一 Part 2。

5. 在 `docs/V1.x_RELEASE.md` 记录季度与题量，然后按正常流程构建 APK、
   git 提交备份。

## JSON 结构

```jsonc
{
  "format": "ielts-speaking-meow-question-bank",
  "formatVersion": 1,
  "seasonLabel": "2026-05",
  "sourceFile": "更新版-2026年5-8月雅思口语新题库0526(1).pdf",
  "generatedAt": "ISO 时间",
  "counts": { "1": 256, "2": 60, "3": 337 },
  "questions": [
    {
      "id": "p2-describe-a-boring-place-001",
      "part": 2,
      "topic": "boring place",
      "prompt": "Describe a boring place",
      "difficulty": "developing",
      "source": "雅思口语喵内置题库",
      "category": "PLACE",
      "isNew": true,
      "cuePoints": ["Where it is", "..."],
      "relatedPart3Ids": ["p3-..."]
    }
  ]
}
```

Part 1 的 `category` 为 `必考话题` / `高频话题`（正文中的
PLACE/OBJECT/EVENT/ABSTRACT 也保留）；Part 2&3 为
`PLACE` / `PEOPLE` / `OBJECTS` / `EVENTS`。

## 未来 PDF 排版变化怎么办

解析器只认识“新航道季度题库”这一种结构。如果后续季度排版调整：

1. 先运行脚本，看 `src/data/questions.test.ts` 或脚本内置校验报什么错；
2. 在 `scripts/import-question-bank.mjs` 中增加/调整适配函数
   （正文识别、标题识别、目录跳过、跨页续行等）；
3. **不要**为了新季度在 UI、`questions.ts`、练习服务里写任何
   题目相关的特判。

## 为什么不把 PDF 提交进 git

原 PDF 属于题库出版方文件，且二进制文件不参与 diff。仓库只提交解析后的
结构化题目 JSON（IELTS 口语题目文本）和生成器；原始 PDF 保存在项目目录
但不进入版本库。
