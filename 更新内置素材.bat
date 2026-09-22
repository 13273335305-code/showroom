@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Update Built-in Materials
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0更新内置素材.ps1"
if errorlevel 1 (
  echo 更新失败，请查看上方错误。原素材文件不会被删除。
  pause
  exit /b 1
)
echo.
pause
