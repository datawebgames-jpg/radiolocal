@echo off
title 🎙️ Radio Local
color 0A

echo.
echo  ==============================
echo    RADIO LOCAL - Iniciando...
echo  ==============================
echo.

:: Matar proceso anterior si existe
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8001 " 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
)

timeout /t 1 /nobreak >nul

cd /d "C:\ofertas locales\radiolocal"
echo  Servidor iniciando en http://localhost:8001
echo  Admin: http://localhost:8001/admin.html
echo.
echo  Presiona Ctrl+C para detener la radio.
echo.

node server.js

echo.
echo  [!] El servidor se detuvo.
pause
