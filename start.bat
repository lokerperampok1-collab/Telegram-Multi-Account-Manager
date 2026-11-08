@echo off
title Telegram Pro Enterprise
echo ===================================================
echo     Telegram Multi-Account Manager (Pro Enterprise)
echo ===================================================
echo.

if not exist venv (
    echo [INFO] Membuat virtual environment 'venv'...
    python -m venv venv
    if errorlevel 1 (
        echo [ERROR] Gagal membuat virtual environment. Pastikan Python sudah terinstall di PATH.
        pause
        exit /b 1
    )
    echo [INFO] Menginstall dependencies dari requirements.txt...
    call venv\Scripts\activate
    pip install -r requirements.txt
) else (
    call venv\Scripts\activate
)

if not exist .env (
    if exist .env.example (
        echo [INFO] Menyalin .env.example ke .env...
        copy .env.example .env
    )
)

echo.
echo [INFO] Menjalankan server Telegram Manager di http://127.0.0.1:8005 ...
echo Buka browser di http://127.0.0.1:8005
echo Tekan Ctrl+C di jendela ini untuk mematikan server.
echo.
python main.py
pause

