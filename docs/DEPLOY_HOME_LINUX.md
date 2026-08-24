# 家庭 Linux Backend 部署与运维

本文是 V2.0 家庭服务器的正式部署手册。目标是：不开放路由器端口、不依赖固定公网
IP、服务器更换后容易迁移，并且 App 在外网仍能使用 HTTPS 访问 Backend。

## 结论先行

生产拓扑固定为：

```text
Android App
    │ HTTPS + 云账号 Bearer session
    ▼
Cloudflare 公网域名
    │ Cloudflare Tunnel（服务器主动向外建立连接）
    ▼
cloudflared 容器 ── Docker 私有网络 ── FastAPI Backend
                                         │
                                         ▼
                                      PostgreSQL

管理员手机/电脑 ── Tailscale 私网 ── 家庭 Linux（SSH、查看日志、升级）
```

- App 公网入口：Cloudflare Tunnel。无需公网 IP、DDNS、端口映射或在路由器开放
  80/443。Cloudflare 官方说明 Tunnel 是 outbound-only，并且不要求开放入站端口。
- 服务器维护：Tailscale。SSH 只走 tailnet，不把 SSH 和 Docker 端口暴露到公网。
- 数据库：PostgreSQL 17，只有 Docker 私有网络可访问。
- Backend：没有宿主机端口映射；只有显式叠加 `compose.local.yaml` 时才会绑定
  `127.0.0.1:8000` 用于本机排查。
- 进程恢复：所有长期服务使用 `restart: unless-stopped`，容器和 Docker 服务开机
  后会自动恢复。
- App 认证：Cloudflare 负责安全入口和抗攻击，应用自己的邮箱账号负责用户身份与
  数据隔离。不要在 API 域名前启用需要浏览器交互的 Cloudflare Access 登录页，
  否则 Android 原生请求无法完成登录流程。

官方参考：

- [Cloudflare Tunnel 工作原理](https://developers.cloudflare.com/tunnel/)
- [Cloudflare Tunnel Docker/Token 部署](https://developers.cloudflare.com/tunnel/setup/)
- [Cloudflare published application 路由](https://developers.cloudflare.com/tunnel/routing/)
- [Tailscale Linux 安装](https://tailscale.com/docs/install/linux)
- [Tailscale SSH](https://tailscale.com/docs/reference/ssh-over-tailscale)
- [Docker Compose restart policy](https://docs.docker.com/engine/containers/start-containers-automatically/)

## 为什么不选其他公网方式

| 方式 | 安全性 | 家宽适配 | 维护成本 | 本项目结论 |
|---|---:|---:|---:|---|
| Cloudflare Tunnel | 高，无入站端口 | 不需要公网 IP | 低 | App 的正式 HTTPS 入口 |
| Tailscale | 高，私网设备身份 | 不需要公网 IP | 低 | 管理与 SSH，不作为普通用户入口 |
| Caddy + 端口转发 | 可做好，但直接暴露家庭 IP | 需要公网 IP/IPv6 与路由设置 | 中 | 不作为默认方案 |
| DDNS + 端口转发 | 取决于防火墙和反代 | 运营商 CGNAT 下可能不可用 | 中高 | 不采用 |
| 直接暴露 8000/5432 | 低 | 不稳定 | 高风险 | 禁止 |

Cloudflare Tunnel 并不替代应用账号鉴权。公网请求最终仍必须通过 Backend 的
Bearer session、邮箱验证、quota 和多用户隔离。

## 第一次部署（Ubuntu / Debian）

### 1. 需要人工准备的账号与信息

执行到这里时，需要你本人完成以下第三方操作：

1. 一个已托管到 Cloudflare 的域名；
2. 在 Cloudflare Dashboard 的 **Networking → Tunnels** 创建 remotely-managed
   tunnel，并复制 tunnel token；
3. 决定 API 子域名，例如 `api.example.com`；
4. DeepSeek、火山引擎和 SMTP 的真实凭证（可分阶段配置；没有 AI/TTS key 时，
   App 仍保留本地训练与系统 TTS）；
5. 若启用 Tailscale，使用你的 Tailscale 账号登录服务器和管理设备。

不需要操作家庭路由器，也不需要提供家庭公网 IP。

### 2. 安装 Docker

使用 Docker 官方针对当前 Linux 发行版的安装步骤，安装 Docker Engine 与 Compose
plugin。确认：

```bash
docker version
docker compose version
sudo systemctl enable --now docker
```

把当前项目复制或克隆到服务器，例如 `/opt/ielts-speaking-meow`。路径可以更换，
Compose 和脚本都从项目根目录解析，不硬编码该示例路径。

### 3. 创建生产环境文件

```bash
cd /opt/ielts-speaking-meow
cp .env.deploy.example .env.deploy
chmod 600 .env.deploy
openssl rand -hex 32
```

把最后一条命令生成的值填到 `POSTGRES_PASSWORD`。密码使用十六进制是为了避免
数据库 URL 中的特殊字符转义问题。然后编辑 `.env.deploy`：

- 替换 PostgreSQL 占位密码；
- 填入 DeepSeek / 火山引擎密钥；
- 如需注册邮箱验证与找回密码，填入 SMTP 配置；
- 将 `APP_ACCOUNT_URL` 改为固定 HTTPS 入口。当前 Android 可靠路径是复制邮件
  中的一次性凭证并粘贴到 App；不要把 token 或密钥写进此文档；
- 根据未来 free / pro 策略调整各项额度。

真实 `.env.deploy` 已被 Git 忽略，不得提交或发到聊天中。

### 4. 保存 Cloudflare Tunnel token

```bash
install -d -m 700 secrets
umask 077
read -r -s -p "Cloudflare Tunnel token: " CF_TUNNEL_TOKEN
printf '%s' "$CF_TUNNEL_TOKEN" > secrets/cloudflare-tunnel-token
unset CF_TUNNEL_TOKEN
chmod 600 secrets/cloudflare-tunnel-token
```

Token 通过 Compose secret 只读挂载，不放进镜像和普通环境变量。

### 5. 在 Cloudflare 添加公网路由

进入刚创建的 Tunnel，添加 **Published application**：

- Hostname：`api.example.com`（替换为你的域名）；
- Service type：HTTP；
- Service URL：`http://backend:8000`。

这里必须写 Docker service 名 `backend`，不能写 `localhost`。用户到 Cloudflare
使用 HTTPS，Tunnel 到同机 Docker 私网使用 HTTP；Backend 没有公网或宿主机监听
端口。

不要给这个 API hostname 套 Cloudflare Access 浏览器登录页。可以使用 Cloudflare
的 DDoS/WAF 能力，但规则不能阻断 App 的 `Authorization`、`Content-Type` 和
`X-Idempotency-Key` 请求头。

### 6. 启动

```bash
docker compose \
  --env-file .env.deploy \
  -f compose.yaml \
  -f compose.cloudflare.yaml \
  up -d --build
```

Backend 启动时会自动执行 Alembic `upgrade head`。查看状态：

```bash
docker compose --env-file .env.deploy -f compose.yaml -f compose.cloudflare.yaml ps
docker compose --env-file .env.deploy -f compose.yaml -f compose.cloudflare.yaml logs --tail=100 backend
docker compose --env-file .env.deploy -f compose.yaml -f compose.cloudflare.yaml logs --tail=100 cloudflared
curl --fail --show-error https://api.example.com/health
```

`/health` 返回 `status: ok` 只表示 Backend 可达；设置页会分别显示第三方 key
是否配置、是否已做真实验证以及最近调用状态，不能把“已填写 key”当成“上游正常”。

### 7. 安装 Tailscale 做远程维护

在 Linux 主机上按 Tailscale 官方文档安装稳定版，然后：

```bash
sudo tailscale up
sudo tailscale set --ssh
tailscale status
```

先在家中确认管理电脑或手机能通过 Tailscale 访问，再考虑收紧现有 SSH 防火墙。
不要在一次远程会话中同时关闭原 SSH 路径和修改防火墙，避免把自己锁在门外。

Tailscale 只用于维护服务器；Android App 的普通 API 请求仍走 Cloudflare HTTPS
域名，因此不要求每位用户安装 VPN。

### 8. 构建正式 Android APK

Backend URL 只在一个构建入口传入：

```powershell
npm run android:release -- -BackendUrl https://api.example.com
```

正式构建会锁定该 HTTPS 地址，设置页只读。代码中不得散落 IP 或 URL。更换家庭
服务器但保留同一域名时，APK 不需要重新构建；只需让 Tunnel 指向新服务器。

首次上线至少验收：

1. 手机关闭 Wi-Fi，使用移动网络打开 App；
2. 设置页显示 Backend 可达；
3. 注册、登录、邮箱验证凭证、退出再登录；
4. 完成一条反馈与一条 TTS；
5. 确认另一账号看不到前一账号的云同步资料；
6. `docker compose ps` 中 postgres/backend/cloudflared 均为 healthy/running。

## 日常运维

### 查看状态与日志

```bash
docker compose --env-file .env.deploy -f compose.yaml -f compose.cloudflare.yaml ps
docker compose --env-file .env.deploy -f compose.yaml -f compose.cloudflare.yaml logs --since=30m backend
```

日志不得包含答案正文、Authorization header、第三方 key、SMTP 密码或账号 token。
排错时优先记录响应的 request ID 与错误码。

### 升级

先备份，再拉取代码、重建镜像：

```bash
./scripts/backend-backup.sh
git pull --ff-only
docker compose --env-file .env.deploy -f compose.yaml -f compose.cloudflare.yaml build --pull backend
docker compose --env-file .env.deploy -f compose.yaml -f compose.cloudflare.yaml up -d
curl --fail --show-error https://api.example.com/health
```

`up -d` 会依据 `restart: unless-stopped` 保持服务常驻；数据库 migration 在新
Backend 健康前完成。不要先删除旧备份或 Docker volume。

若新版本失败：

1. 保留数据库和备份；
2. 切回上一个已知可用 Git tag/commit；
3. 重新 `build backend` 与 `up -d`；
4. 只有 migration 明确不向后兼容时才恢复数据库备份。

### 备份

```bash
./scripts/backend-backup.sh
```

输出为 PostgreSQL custom-format `.dump`，先写 `.partial`，成功后原子改名。
备份默认保存在 `backups/`，该目录被 Git 忽略。至少再复制一份到不在这台主机的
加密存储，并定期实际演练恢复；“有备份文件”不等于“能恢复”。

可用 systemd timer 或 cron 每天调用脚本。示例（每天 03:20）：

```cron
20 3 * * * cd /opt/ielts-speaking-meow && ./scripts/backend-backup.sh >> /var/log/ielts-meow-backup.log 2>&1
```

脚本不会自动删除旧备份，避免错误 retention 配置造成不可恢复的数据删除。可在
确认异地副本可用后再制定保留周期。

### 恢复

恢复会替换当前数据库，因此脚本要求显式确认，并在破坏性步骤前再自动做一次
pre-restore 备份：

```bash
RESTORE_CONFIRMATION=RESTORE \
  ./scripts/backend-restore.sh /absolute/path/to/ielts-meow-YYYYMMDDTHHMMSSZ.dump
```

恢复完成后依次验证 `/health`、登录、账号隔离、历史和素材，再决定是否清理旧
volume 或备份。

### 仅在服务器本机排查 Backend

默认 Compose 不发布 8000。需要短时从主机访问时：

```bash
docker compose \
  --env-file .env.deploy \
  -f compose.yaml \
  -f compose.local.yaml \
  up -d
curl http://127.0.0.1:8000/health
```

`compose.local.yaml` 只绑定 loopback，不得改成 `0.0.0.0:8000` 后直接暴露。

## 迁移到另一台服务器

1. 在旧机运行 `backend-backup.sh`，复制最新 dump、项目版本号和安全保存的
   `.env.deploy`；
2. 新机安装 Docker/Tailscale，复制项目、环境文件和 tunnel secret；
3. 先启动 PostgreSQL 与 Backend，运行恢复脚本；
4. 启动 cloudflared。复用同一 tunnel token 时，域名不变；也可以在 Cloudflare
   创建新 tunnel 并把 route 切过去；
5. 移动网络验收后，再停止旧服务器。

只要公网域名不变，家庭 IP、局域网 IP、Linux 用户名和项目绝对路径都可以改变，
Android APK 无需修改。

## 故障排查

### Cloudflare 显示 502

按 Cloudflare 官方排错顺序：

```bash
docker compose --env-file .env.deploy -f compose.yaml -f compose.cloudflare.yaml ps
docker compose --env-file .env.deploy -f compose.yaml -f compose.cloudflare.yaml logs --tail=200 cloudflared
docker compose --env-file .env.deploy -f compose.yaml exec backend \
  python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health').status)"
```

Dashboard route 必须是 `http://backend:8000`。若写成 `localhost:8000`，
cloudflared 会在自己的容器里找服务而失败。

### Backend 不健康

```bash
docker compose --env-file .env.deploy -f compose.yaml logs --tail=200 backend
docker compose --env-file .env.deploy -f compose.yaml logs --tail=200 postgres
```

常见原因：

- PostgreSQL 密码含未编码的 URL 特殊字符：改用十六进制密码；
- `.env.deploy` 缺失或占位值未替换；
- migration 失败：不要反复重启，先保留数据库并检查 Alembic 错误；
- 第三方 key 错误不会让基础 Backend 停止，健康页会显示 provider failed。

### 家中断电或重启

Docker 服务和三个容器都设置为自动恢复。恢复供电后检查：

```bash
systemctl is-active docker
docker compose --env-file .env.deploy -f compose.yaml -f compose.cloudflare.yaml ps
tailscale status
```

如果 BIOS 没有配置“来电自动开机”，操作系统层无法解决，需要你在主板设置中按需
启用 Restore on AC Power Loss；这属于唯一可能需要接触家庭硬件的步骤。
