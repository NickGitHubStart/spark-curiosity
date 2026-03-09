@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\install-from-wsl.ps1"
exit /b %ERRORLEVEL%
