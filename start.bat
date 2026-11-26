@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [x] 没找到 Node.js
  echo       请先安装 Node.js 18 或更高版本：https://nodejs.org/
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -v') do set NODEV=%%v
echo.
echo   点云实验室 · POINT CLOUD STUDIO
echo   Node %NODEV%
echo   正在启动 http://127.0.0.1:5183/   （关掉这个窗口即停止服务）
echo.

rem 等 3 秒再开浏览器，避免服务还没起来
start "" /min cmd /c "timeout /t 3 >nul & start http://127.0.0.1:5183/"
node server/index.mjs

echo.
echo   服务已停止。
pause
