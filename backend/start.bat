@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist .venv\Scripts\python.exe (
  echo [错误] 未找到 .venv 虚拟环境,请先按 backend\README.md 完成安装。
  pause
  exit /b 1
)

echo ============================================
echo   雅思口语喵 后端启动中(局域网模式)
echo ============================================
echo.
echo 提示:
echo   1. 首次启动时若 Windows 防火墙弹窗,请点"允许访问",
echo      否则手机连不上本机。
echo   2. 手机需要和这台电脑连接同一个 WiFi。
echo   3. 本机局域网地址可运行 ipconfig 查看(IPv4 地址),
echo      若地址变化需重新打包 App。
echo   4. 关闭本窗口即可停止后端。
echo.
.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
pause
