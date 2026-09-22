@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title FORM Material Studio Launcher
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0更新内置素材.ps1"
if errorlevel 1 (
  pause
  exit /b 1
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
if errorlevel 1 (
  echo.
  echo Unable to start FORM. Please keep all files together and try again.
  pause
)
