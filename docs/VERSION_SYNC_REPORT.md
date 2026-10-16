# 雅思口语喵三端版本同步报告

执行日期：2026-09-18（Asia/Shanghai）  
同步目标：本地 Backend、Cloudflare Tunnel 公网 Backend、Android 客户端统一到 v2.2.1。

## 1. 基线

### Git 与工作区

只读命令：

~~~text
git status --short --branch
git rev-parse HEAD
git describe --tags --always --dirty
~~~

结果：

~~~text
## codex/v2-product-refactor...origin/codex/v2-product-refactor
?? artifacts/
?? docs/COMPETITION_VIDEO_PLAN_2026-09-14.md
?? docs/competition-materials/
?? scripts/build_pdf_materials.py
?? scripts/verify_pdf_quality.py
462cdaf8b5f4eca32a26ab258900788e5bb1ac5d
v2.2.1
~~~

git diff --name-status 为空；没有修改已有 tracked 文件。上述未提交内容在部署前已存在，全部保留。项目路径 C:/Users/11401/ielts_meow 是 junction，目标为 D:/111-Trae_project/雅思喵/雅思口语喵。

### 本地代码与客户端版本

~~~text
backend/app/main.py:
title="雅思口语喵 Backend", version="2.2.1"

android/app/build.gradle:
versionCode 20
versionName "2.2.1"
~~~

同时确认 package.json 版本为 2.2.1。

### 部署方式与服务基线

已确认项目既有部署入口为：

- compose.yaml
- compose.cloudflare.yaml
- .env.deploy
- docs/DEPLOY_WINDOWS_PUBLIC.md
- scripts/windows-public-stack.ps1

Compose 服务为 postgres、backend、cloudflared；固定公网入口为 https://api.formomentward.com。本机 Docker Engine 和 Docker Compose 均可用，部署前状态为三项服务运行，Backend 容器内版本为 2.2.0。

部署前公网实测命令：

~~~text
curl.exe --noproxy "*" --connect-timeout 10 --max-time 20 -sS -D - https://api.formomentward.com/health
~~~

关键响应：

~~~text
HTTP/1.1 200 OK
{"status":"ok","version":"2.2.0",
 "providers":{
   "deepseek":{"configured":true,"model":"deepseek-v4-flash","verification":{"status":"unverified"}},
   "volc_tts":{"configured":true,"model":"seed-tts-2.0","resourceId":"seed-tts-2.0",
               "speaker":{"id":"en_female_dacey_uranus_bigtts"},
               "verification":{"status":"unverified"}}
 }}
~~~

部署前运行 Backend 镜像 ID：

~~~text
sha256:05f11c297a6554d758f943d0400750bf6a86a6d682a4af1a58bfadbb7e0396fa
容器内 app.version=2.2.0
~~~

## 2. 部署前备份

按 PostgreSQL Compose 数据卷现状执行只读 dump，未重置卷、未删除数据。

备份结果：

~~~text
命令：docker exec ielts-speaking-meow-postgres-1 pg_dump
      --format=custom --no-owner --no-acl
      --username <POSTGRES_USER> --dbname <POSTGRES_DB>

文件：backups/ielts-meow-20260918T085932Z.dump
大小：38641 bytes
SHA-256：697313fe2e4a19784604efc55f7f3a38d054abef65ff584aad948be62cea6258
~~~

.env.deploy 的密钥值没有写入报告或命令输出。

## 3. 公网 Backend 同步动作

执行的既有 Compose 流程：

~~~text
docker compose --env-file .env.deploy -f compose.yaml -f compose.cloudflare.yaml build backend

docker compose --env-file .env.deploy -f compose.yaml -f compose.cloudflare.yaml up -d --no-deps --force-recreate backend
~~~

结果：

~~~text
Image ielts-speaking-meow-backend Built
Container ielts-speaking-meow-backend-1 Started
health_poll=4 status=healthy
容器内 version=2.2.1
~~~

部署后 Backend 镜像和容器：

~~~text
image_id=sha256:70cb33cd01fbd8c3acb49dba8d7211ffe2b03e677e28094a1409300a37afeb77
container image_id=sha256:70cb33cd01fbd8c3acb49dba8d7211ffe2b03e677e28094a1409300a37afeb77
container health=healthy
~~~

PostgreSQL 未重建。启动日志确认 Backend 使用 PostgreSQL Alembic 迁移环境；只读查询结果：

~~~text
alembic_version=0004_usage_request_hash
users=10
sync_entities=1
sync_changes=1
~~~

最终 Compose 状态：

~~~text
ielts-speaking-meow-backend-1       Up 12 minutes (healthy)
ielts-speaking-meow-cloudflared-1   Up 58 minutes
ielts-speaking-meow-postgres-1      Up 6 hours (healthy)
~~~

## 4. 公网实测证据

### /health 前后对比

| 时点 | HTTP | version | DeepSeek | TTS |
|---|---:|---|---|---|
| 部署前 | 200 | 2.2.0 | configured=true, unverified | configured=true, unverified |
| 部署后 | 200 | 2.2.1 | configured=true, unverified | configured=true, unverified |
| 本地容器最终检查 | 200 | 2.2.1 | configured=true, unverified | configured=true, unverified |

部署后最终检查命令：

~~~text
curl.exe --noproxy "*" -sS https://api.formomentward.com/health
docker exec ielts-speaking-meow-backend-1 python -c "from app.main import app; print(app.version)"
~~~

最终结果：

~~~text
verified_at_utc=2026-09-18T09:12:28.6603362Z
public_status=ok public_version=2.2.1
local_http_status=200 local_status=ok local_version=2.2.1
public/local deepseek model=deepseek-v4-flash
public/local tts model=seed-tts-2.0
public/local tts resource=seed-tts-2.0
public/local tts speaker=en_female_dacey_uranus_bigtts
~~~

### 公网接口清单

命令：

~~~text
curl.exe --noproxy "*" -sS https://api.formomentward.com/openapi.json
docker exec ielts-speaking-meow-backend-1 python -c "print(app.openapi())"
~~~

公网 OpenAPI info.version=2.2.1。公网与部署后本地容器的 path/method 集合均为 23 个 operation，比较结果：

~~~text
remote_route_count=23
container_route_count=23
missing_public=
extra_public=
~~~

接口集合为：

~~~text
GET  /
GET  /health
POST /health/verify
POST /v1/auth/confirm-email-verification
POST /v1/auth/login
POST /v1/auth/logout
POST /v1/auth/logout-all
POST /v1/auth/password-reset/confirm
POST /v1/auth/password-reset/request
POST /v1/auth/register
POST /v1/auth/request-email-verification
GET  /v1/auth/session
POST /v1/feedback
POST /v1/feedback/second-attempt
POST /v1/knowledge/organize
POST /v1/materials/suggest
DELETE /v1/me
GET  /v1/me
PATCH /v1/me
POST /v1/organize
GET  /v1/sync/pull
POST /v1/sync/push
POST /v1/tts
~~~

### 核心路由冒烟

使用符合当前 Pydantic schema 的相同 JSON，请求公网和容器本地；不带 Authorization，因此不会创建账号、扣额度或触发 DeepSeek/TTS 上游调用。

请求覆盖：

- POST /v1/feedback
- POST /v1/feedback/second-attempt
- POST /v1/organize
- POST /v1/knowledge/organize
- POST /v1/materials/suggest
- POST /v1/tts

公网与本地逐项结果均一致：

~~~text
HTTP 401
{"error":{"code":"invalid-session","message":"登录状态无效或已过期,请重新登录。"}}
~~~

这证明了公网路由、请求解析和认证边界均命中同一 v2.2.1 契约；它不是已验证邮箱账号下的真实 AI/TTS 业务成功证明，后者需要可用的已验证账号并会触发第三方调用。

## 5. Android 客户端同步

### 原客户端发现

现有 v2.2.1 Debug APK 的版本号本来已经正确，但其构建 bundle 默认地址仍是 10.0.2.2:8000 / 127.0.0.1:8000，不适合手机开箱即用连接本轮公网 Backend。因此重新构建 Debug 包，保持 Debug 构建可编辑地址的设计。

### 构建命令与验证

在 junction 路径执行脚本时，ESLint 因 TypeScript project 路径解析报 191 个 parser error，脚本在 lint 阶段退出，未覆盖 APK。改用 junction 的真实目标目录执行同一既有脚本：

~~~text
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/android-build.ps1 -BackendUrl https://api.formomentward.com
~~~

成功结果：

~~~text
eslint . --max-warnings=0                 passed
Vitest: 62 test files, 373 tests         passed
Backend pytest: 96 passed in 16.21s
Gradle assembleDebug                     successful
Gradle testDebugUnitTest                 successful
Gradle lintDebug                         successful
~~~

Gradle 有既有 warning（experimental android.overridePathCheck、flatDir、SDK XML 版本提示、Gradle deprecation），没有 error。

### APK 产物

~~~text
路径：artifacts/ielts-speaking-meow-v2.2.1-debug.apk
大小：48701037 bytes
SHA-256：e9610494037b1a8998a6aa2159825ccf1b25704b72da93074822e6462b73673a
~~~

aapt dump badging：

~~~text
package: name='com.ieltsspeakingmeow.app' versionCode='20' versionName='2.2.1'
~~~

apksigner verify --verbose --print-certs：

~~~text
Verifies
Verified using v2 scheme: true
Signer certificate DN: C=US, O=Android, CN=Android Debug
~~~

构建后的 WebView bundle 实测包含：

~~~text
https://api.formomentward.com
/v1/feedback/second-attempt
/v1/organize
/v1/materials/suggest
/v1/knowledge/organize
/v1/tts
/v1/sync/push
/v1/sync/pull
~~~

## 6. 客户端与 Backend 契约对照

| 功能 | Android/Web 客户端调用 | 请求关键字段 | v2.2.1 Backend | 结果 |
|---|---|---|---|---|
| 第一次反馈 | POST /v1/feedback | part、question、answer、answerDurationSeconds；可选 tutorContext、learnerContext、userKnowledgeContext、naturalUpgradeLevel、spokenEnglishStyle | FeedbackPayload 同字段与枚举 | 一致 |
| 第二次反馈 | POST /v1/feedback/second-attempt | part、question、answer | SecondAttemptFeedbackPayload | 一致 |
| 题目整理 | POST /v1/organize | fileName、extractedText | OrganizePayload | 一致 |
| 用户知识整理 | POST /v1/knowledge/organize | fileName、64 位 sourceHash、chunks[index/pageNumber/section/text] | KnowledgeOrganizePayload | 一致 |
| 个人素材建议 | POST /v1/materials/suggest | memoryDigest、existingTitles、maxCount、targetPart | MaterialSuggestPayload | 一致 |
| 云端 TTS | POST /v1/tts | text、language、voice、rate、pitch；返回 audio/mpeg | TtsPayload；Response audio/mpeg | 一致 |
| 云端同步上传 | POST /v1/sync/push | items | SyncPushRequest | 一致 |
| 云端同步下载 | GET /v1/sync/pull?cursor=&limit= | cursor、limit | SyncPullResponse | 一致 |
| 健康检查 | GET /health | 无 | status、version、providers | 一致 |

客户端实现仍经 BackendClient/BackendTextProvider/BackendTtsProvider/CloudSyncClient 访问，不携带第三方 API Key。

## 7. 三端最终一致性结论

| 端 | 版本/提交 | 运行或产物证据 | 状态 |
|---|---|---|---|
| 本地 Backend 源码 | version 2.2.1；Git 462cdaf8b5f4eca32a26ab258900788e5bb1ac5d；tag v2.2.1 | backend/app/main.py；工作区无 tracked diff | 一致 |
| Docker Backend + Cloudflare Tunnel 公网 | /health version 2.2.1；Backend healthy；Tunnel Up | HTTPS /health 200；OpenAPI 23 operation 无缺失/多余 | 一致 |
| Android 客户端 | versionCode 20；versionName 2.2.1；Debug APK | SHA-256 e9610494037b1a8998a6aa2159825ccf1b25704b72da93074822e6462b73673a；默认 URL 为公网 | 一致 |

## 8. 遗留项与边界

1. /health 显示 DeepSeek 和火山 TTS configured=true，但 verification.status=unverified。本轮没有使用已验证账号调用 /health/verify，也没有伪称真实 DeepSeek/TTS 业务成功。
2. Cloudflare Tunnel watchdog 任务状态为 Running。其日志显示本日存在间歇性公网健康检查失败，曾按阈值重启 Tunnel，随后恢复；本轮最终公网健康检查为 HTTP 200 / v2.2.1。建议继续观察 Tunnel 出站网络稳定性。
3. 当前交付的是 Debug APK，使用 Android Debug 证书；没有生成或替换正式 Release 包，也没有进行线上 APK 替换。
4. 版本同步没有修改业务源码或配置密钥；部署备份保存在 backups/。项目原有未提交文件未处理。

