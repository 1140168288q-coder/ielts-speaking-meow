# 雅思口语喵 V2.0

Android-first、local-first 的 IELTS Speaking 单题训练 App。它围绕“两次回答、
长期 Memory、个人素材复用”形成持续学习闭环：

> 结构化季度题库 → 听题 → 第一次文本回答 → 本地规则 + 教学 RAG + 该账号
> 长期 Memory → 精简 AI 反馈 → 对照并试听优化答案与 3 个参考回答
> → 插入自己的可复用素材 → 第二次回答 → 保存真正愿意再次说出口的表达

## V2.0 能力

### 题库与训练

- 2026 年 5–8 月结构化内置题库 653 题：
  Part 1 256 / Part 2 60 / Part 3 337；
- 保留 Part、Topic、new/old、Part 2 cue points 与 Part 2↔Part 3 关联；
- 题库由解析器生成，运行时经过 Zod 和语义完整性校验；
- 系统键盘语音输入或手动输入、两次回答、手动计时、离线规则和历史持久化；
- 反馈默认突出 2–3 个重点，三个参考回答按 tab 对照和试听；
- 个人素材跨题匹配并一键插入第二次答案。

### 个性化、Memory 与 RAG

- 版本化本地 IELTS 教学 RAG，覆盖各 Part、结构、语法、词汇和高频主题；
- Memory 从练习、AI 反馈、表达、素材和 reuseCount 等事实派生，不另存易失真的
  第二份画像；
- 同题 > 同 Topic/Tag > 关键词相近的素材复用；
- 设置按本地账号隔离：默认 Part、自动播题、反馈详细程度、TTS 来源/语速、
  Memory、个人素材 AI 分享、主题和减少动画；
- 个人素材默认不发送给 AI；显式开启后也只发送当前题最相关的紧凑内容。

### TTS

- 题目、优化答案和 3 个参考回答都可播放；
- 全局单一音频焦点：播放 B 前停止 A，同键再次点击停止；
- AI TTS 长音频有进度、时间、暂停、继续、停止和 provider 支持时 seek；
- 云端失败自动回退 Android System TTS；
- 可选自然语音优先或仅系统语音，语速偏好实际进入请求。

### 账号、同步与商业化基础

- 本地稳定 userId + 可选 PIN，数据按 ownerId 隔离；
- 邮箱注册/登录、会话恢复、邮箱验证、密码找回、单设备退出；
- Android token 由 Keystore 加密保存；Web 预览只用当前标签页 sessionStorage；
- 云端昵称、free/Pro 状态、feature quota、全设备退出；
- 当前密码 + 明确确认后删除云账号和云端个人数据；
- 幂等 outbox、实体版本、单调 cursor、软删除 tombstone 和冲突保护；
- 登录不自动上传，只有用户明确确认后才同步；
- plan / subscription / entitlement / usage / webhook event 已独立建模，未实现支付。

## 不会恢复的功能

- App 内录音或 STT；
- 发音、语速、停顿、语调评价；
- Band Score、分数段或水平评级；
- 官方级自动评分、实时 AI 考官或完整模拟考试。

没有 Backend 或 AI key 时，题库、输入、计时、本地规则、历史、个人素材和
System TTS 仍可用。

## 架构与部署

- [V2 产品与技术架构](docs/V2_ARCHITECTURE.md)
- [家庭 Linux 部署、升级、备份与恢复](docs/DEPLOY_HOME_LINUX.md)
- [季度题库更新机制](docs/QUESTION_BANK_UPDATE.md)
- [Backend 接口与安全边界](backend/README.md)

生产默认拓扑：

```text
Android App → Cloudflare HTTPS → outbound-only Tunnel
            → FastAPI → PostgreSQL
管理员设备 → Tailscale → 家庭 Linux
```

Backend 和数据库默认不发布宿主机端口，不依赖家庭公网 IP 或路由器端口映射。

## 技术栈

React 19 / TypeScript strict / Vite / Capacitor 8 / Android API 36 /
Zod / IndexedDB / Vitest / FastAPI / SQLAlchemy Async / Alembic /
PostgreSQL 17 / Docker Compose。

## 开发与验证

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm test
npm run test:backend
npm run build
# 完整验证
npm run verify
```

Windows 可双击 `start.bat`。网页开发默认连接
`http://127.0.0.1:8000`；Android 模拟器默认连接 `http://10.0.2.2:8000`。

本地 Backend：

```powershell
Copy-Item backend/.env.example backend/.env
backend/.venv/Scripts/python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

测试使用 fake provider / MockTransport，不调用真实付费 API。真实 `.env`、密钥、
token、答案和备份不得提交 Git。

换季度题库：

```bash
npm run question-bank:update -- "/path/to/new-quarter.pdf"
npm run verify
```

PDF 版式变化时只修改 `scripts/import-question-bank.mjs`，不手填生成 JSON。

## Android 构建

Debug：

```bash
npm run android:build
```

正式 Release 需要 `android/keystore.properties` 和 HTTPS Backend：

```powershell
npm run android:release -- -BackendUrl https://api.example.com
```

正式包锁定 Backend 根地址。构建脚本拒绝公网 HTTP、URL 凭证、query、fragment、
路径前缀和伪私网主机名。V2 文件名：

```text
artifacts/ielts-speaking-meow-v2.0.0-debug.apk
artifacts/ielts-speaking-meow-v2.0.0-release.apk
```

长期保管同一 release keystore；覆盖安装保留 IndexedDB，卸载会清除 App 私有数据。

## 家庭生产部署

仓库包含 `backend/Dockerfile`、`compose.yaml`、
`compose.cloudflare.yaml`、`compose.local.yaml`、`.env.deploy.example` 和
备份/恢复脚本。第一次部署按 [DEPLOY_HOME_LINUX.md](docs/DEPLOY_HOME_LINUX.md)
完成域名、tunnel token、真实 API key、SMTP 与 Tailscale 登录；禁止直接开放
8000 或 5432。

## 目录

```text
src/
  app/               运行时组合与控制器
  application/       练习、账号、同步、素材、备份用例
  data/              生成式题库
  domain/            Zod、RAG、Memory、本地规则
  features/          训练、题库、复盘、账号、设置 UI
  infrastructure/    IndexedDB、Backend client、TTS/provider
  ports/             存储、Backend、LLM、TTS 边界
backend/              FastAPI、Auth、sync、quota、AI/TTS
android/              Capacitor Android 工程
docs/                 架构、部署、题库与历史记录
scripts/              题库导入、Android 构建、备份恢复
```

项目最高开发规范见 [AGENTS.md](AGENTS.md)。
