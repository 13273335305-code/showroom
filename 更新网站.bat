@echo off
cd /d "%~dp0"
title Update Website
color 0A

echo ============================================
echo        Deploy website to Vercel
echo ============================================
echo.
echo [1/3] Checking local changes...
echo.

git add -A
git status --short
echo.

git diff --cached --quiet
if errorlevel 1 goto commit
echo No new changes, will push existing version.
goto push

:commit
echo [2/3] Changes detected.
set /p msg=Enter update note (press Enter for default): 
if "%msg%"=="" set msg=Update website
echo.
echo Committing...
git commit -m "%msg%"

:push
echo.
echo [3/3] Pushing to GitHub...
echo.
git push origin master
echo.

if errorlevel 1 goto fail
echo ============================================
echo   SUCCESS!
echo   Vercel will auto-deploy in 1-2 minutes.
echo   URL: https://showroom-ivory.vercel.app
echo ============================================
goto end

:fail
echo ============================================
echo   PUSH FAILED. Screenshot the error above.
echo ============================================

:end
echo.
pause