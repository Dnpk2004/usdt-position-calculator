@echo off
chcp 65001 >nul
setlocal
title 合约仓位计算器

set "CALCULATOR_PROJECT=%~dp0"
if not exist "%CALCULATOR_PROJECT%package.json" set "CALCULATOR_PROJECT=%USERPROFILE%\Documents\ChatGPT\bian\"
if not exist "%CALCULATOR_PROJECT%package.json" (
  echo 未找到计算器项目。请确认项目仍在 Documents\ChatGPT\bian 文件夹中。
  pause
  exit /b 1
)
cd /d "%CALCULATOR_PROJECT%"
if errorlevel 1 (
  echo 无法打开计算器项目文件夹。
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo 未找到 Node.js，请先安装 Node.js 24 LTS，再重新双击此文件。
  pause
  exit /b 1
)

node -e "fetch('http://127.0.0.1:5173/',{signal:AbortSignal.timeout(3000)}).then(async r=>{const t=await r.text();process.exit(r.ok && t.includes('\u5408\u7ea6\u4ed3\u4f4d\u8ba1\u7b97\u5668')?0:1)}).catch(()=>process.exit(1))" >nul 2>&1
if not errorlevel 1 (
  echo 计算器已在运行。
  if /i "%~1"=="--check" exit /b 0
  start "" "http://127.0.0.1:5173/"
  exit /b 0
)

if /i "%~1"=="--check" exit /b 2

if not exist "node_modules\vite\bin\vite.js" (
  echo 尚未安装项目依赖。请在此目录运行 npm install，完成后再次双击。
  pause
  exit /b 1
)

echo 正在启动计算器，浏览器将自动打开。
echo 使用期间请保持此窗口运行，关闭此窗口即停止服务。
echo 地址：http://127.0.0.1:5173/
echo.
call npm.cmd run dev -- --open --port 5173 --strictPort
if errorlevel 1 (
  echo.
  echo 启动失败，请查看上方错误信息。如果 5173 端口被其他程序占用，请先关闭占用程序。
  pause
  exit /b 1
)
