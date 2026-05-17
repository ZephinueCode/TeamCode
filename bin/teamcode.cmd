@echo off
setlocal
set "TEAMCODE_ROOT=%~dp0.."
cd /d "%CD%"
bun run --conditions=browser "%TEAMCODE_ROOT%\src\index.ts" %*
