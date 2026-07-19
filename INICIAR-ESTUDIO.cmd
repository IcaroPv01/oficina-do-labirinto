@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

title Oficina do Labirinto - Estudio online
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 24 ou superior não foi encontrado neste computador.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%V in ('node -p "process.versions.node"') do set "NODE_MAJOR=%%V"
if %NODE_MAJOR% LSS 24 (
  echo Este Estúdio exige Node.js 24 ou superior. Versão encontrada:
  node --version
  pause
  exit /b 1
)

node scripts\studio-online.mjs

if errorlevel 1 (
  echo.
  echo Não foi possível iniciar o Estúdio. A mensagem acima explica o motivo.
  pause
)
