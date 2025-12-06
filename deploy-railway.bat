@echo off
title Deploy para Railway - SIGO WhatsApp Bot

echo ============================================
echo     🚀 INICIANDO DEPLOY PARA RAILWAY
echo ============================================

:: Caminho do projeto
cd /d C:\Users\javer\SIGO-WHATSAPP-BOT

:: Verifica Railway CLI
echo.
echo 🔍 Verificando Railway CLI...
where railway >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ Railway CLI nao encontrado!
    echo Instale com: npm i -g @railway/cli
    pause
    exit /b
)

:: Login (caso nao esteja logado)
echo.
echo 🔐 Autenticando no Railway...
railway login

:: Linka o projeto (somente na primeira vez)
echo.
echo 🔗 Conectando com projeto no Railway...
railway link --detach

:: Realiza o deploy
echo.
echo 🚀 Enviando projeto para Railway...
railway up --detach

if %errorlevel% neq 0 (
    echo ❌ Erro no deploy!
    pause
    exit /b
)

:: Reinicia o serviço
echo.
echo 🔄 Reiniciando servico...
railway service restart

:: Mostra logs
echo.
echo 📜 Logs recentes:
railway logs --lines 50

echo.
echo ============================================
echo   ✅ DEPLOY FINALIZADO COM SUCESSO!
echo ============================================
pause
