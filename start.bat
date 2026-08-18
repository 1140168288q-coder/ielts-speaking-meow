@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"
set "HOST=127.0.0.1"
set "PORT=5173"
set "URL=http://%HOST%:%PORT%/"

where npm.cmd >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm.cmd was not found. Please install Node.js first.
    pause
    exit /b 1
)

rem ---- Stop any stale server on the port so the latest code is served ----
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r ":5173 .*LISTENING"') do (
    echo [INFO] Found an old process on port 5173 ^(PID %%P^), stopping it first...
    taskkill /F /PID %%P >nul 2>nul
)
timeout /t 1 /nobreak >nul

echo Starting the IELTS Speaking Meow web app ^(latest code^)...
start "IELTS Speaking Meow Web - close this window to stop" cmd /d /k "cd /d ""%~dp0"" && npm.cmd start -- --host %HOST% --port %PORT%"

echo Waiting for the web server to become ready...
for /l %%I in (1,1,30) do (
    curl --silent --show-error --fail --max-time 2 "%URL%" >nul 2>nul
    if not errorlevel 1 goto ready
    timeout /t 1 /nobreak >nul
)

echo [ERROR] The web server did not start within 30 seconds.
echo        Check the new terminal window for details.
pause
exit /b 1

:ready
echo Web app is ready. Opening %URL%
echo.
echo NOTE: if the app shows "API not connected" in the top-right corner,
echo       start the backend first by double-clicking start-backend.bat,
echo       then refresh this page.
echo.
start "" "%URL%"
endlocal
exit /b 0
