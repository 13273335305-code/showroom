@echo off
setlocal
cd /d "%~dp0"
title FORM Material Studio Launcher
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
if errorlevel 1 (
  echo.
  echo Unable to start FORM. Please keep all files together and try again.
  pause
)
