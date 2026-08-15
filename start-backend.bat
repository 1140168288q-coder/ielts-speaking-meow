@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0backend"

echo ==============================================
echo   雅思口语喵 一键启动后端
echo ==============================================
echo.

rem ---- 读取本机局域网 IPv4(用于提示手机 App 地址)----
set "LANIP=未检测到"
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do set "LANIP=%%a"
set "LANIP=%LANIP: =%"

rem ---- 后端已经在运行?----
netstat -ano | findstr ":8000" | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 (
    echo [提示] 后端已经在运行,直接打开状态页。
    start "" "http://127.0.0.1:8000/health"
    timeout /t 3 >nul
    exit /b 0
)

if not exist ".venv\Scripts\python.exe" (
    echo [错误] 未找到 .venv 虚拟环境。
    echo        请先按 backend\README.md 完成安装。
    echo.
    pause
    exit /b 1
)

echo [1/3] 启动 uvicorn(端口 8000)...
echo        新窗口会显示后端日志,关闭该窗口即停止后端。
start "雅思口语喵后端 - 关闭此窗口即停止" cmd /k ".venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000"

echo [2/3] 等待后端就绪...
set "OK=0"
for /l %%i in (1,1,15) do (
    timeout /t 1 /nobreak >nul
    curl -s -o nul "http://127.0.0.1:8000/health"
    if not errorlevel 1 (
        set "OK=1"
        goto ready
    )
)
:ready

if "%OK%"=="1" (
    echo [3/3] 后端已就绪。
    echo.
    echo   本机状态页  : http://127.0.0.1:8000/health
    echo   手机 App 地址: http://%LANIP%:8000  (手机需与电脑连同一个 WiFi)
    echo.
    echo   首次运行时若 Windows 防火墙弹窗,请点"允许访问",
    echo   否则手机连不上本机。
    echo.
    start "" "http://127.0.0.1:8000/health"
) else (
    echo [失败] 后端未能在 15 秒内就绪,请查看后端日志窗口。
    echo        常见原因:端口被占用、依赖缺失、防火墙拦截。
)

echo.
pause
endlocal
