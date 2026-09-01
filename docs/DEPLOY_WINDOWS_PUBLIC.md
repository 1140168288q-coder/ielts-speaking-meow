# Windows 校园网主用、USB/手机热点备用部署

本机公网入口继续使用固定 HTTPS 域名和 Cloudflare Tunnel。校园网与 USB/手机热点
只提供电脑到 Cloudflare 的出站网络，不开放路由器端口，也不把 Backend 的 8000 或
PostgreSQL 的 5432 映射到校园网。

## 一键部署

在项目根目录以 PowerShell 执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/windows-public-stack.ps1 -Mode Install
```

脚本会：

1. 注册 Windows 登录启动任务；
2. 启动 Docker Desktop（如果尚未运行）；
3. 使用 `compose.yaml` 和 `compose.cloudflare.yaml` 拉起 PostgreSQL、Backend、
   Cloudflare Tunnel；
4. 每 30 秒检查固定公网 `/health`；
5. 校园网断开后接入 USB/手机热点时，等待 Tunnel 自动重连；连续健康检查失败时，
   自动重启 Tunnel 一次以重新建立出站连接。

## 网络切换

- 校园 Wi-Fi 作为主线路。
- USB 共享网络优先作为备用线路；比 Wi-Fi 热点更适合长时间运行。
- 如果同时连接两条线路，Windows 会依据接口 metric 选择出口。首次插入手机后，
  应确认校园 Wi-Fi 的 metric 小于 USB 网络；不要修改 Docker 或 Cloudflare 域名。
- 手机热点必须保持不休眠，并接电源。校园网需要网页登录时，Tunnel 无法代替
  登录动作。

## 验证与停止

```powershell
curl.exe --fail https://api.formomentward.com/health
docker compose --env-file .env.deploy -f compose.yaml -f compose.cloudflare.yaml ps
Get-Content runtime/public-stack-watch.log -Tail 80
```

移除自动启动任务（不会删除数据库和容器）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/windows-public-stack.ps1 -Mode Uninstall
```

不要使用 `compose.local.yaml` 作为公网部署配置，也不要为 8000/5432 添加入站防火墙
规则。校园网络的公共网络类别应保持启用。
