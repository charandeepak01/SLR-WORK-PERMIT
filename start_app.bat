@echo off
setlocal
cd /d "%~dp0"

REM --- Attempt to configure Windows Firewall for network access ---
echo.
echo Checking for Administrator privileges to configure firewall...
net session >nul 2>nul
if %errorlevel% EQU 0 (
    echo Running with Administrator privileges.
    echo.
    echo Checking for existing firewall rule...
    netsh advfirewall firewall show rule name="SLR Work Permit App" >nul
    if %errorlevel% NEQ 0 (
        echo Adding firewall rule to allow connections on port 8081...
        netsh advfirewall firewall add rule name="SLR Work Permit App" dir=in action=allow protocol=TCP localport=8081 >nul
        if %errorlevel% EQU 0 (
            echo Firewall rule 'SLR Work Permit App' was added successfully.
        ) else (
            echo [WARNING] Failed to add firewall rule automatically.
        )
    ) else (
        echo Firewall rule 'SLR Work Permit App' already exists. No action needed.
    )
) else (
    echo [INFO] Script is not running as Administrator. The firewall cannot be configured automatically.
    echo        If you see a "refused to connect" error from another device, please run this script
    echo        ONCE as an administrator (right-click 'start_app.bat' > 'Run as administrator').
)
echo.

REM --- Find a suitable Python executable ---
set "PYTHON_EXE="
where py >nul 2>nul
if %errorlevel% EQU 0 (
    set "PYTHON_EXE=py"
) else (
    where python >nul 2>nul
    if %errorlevel% EQU 0 (
        set "PYTHON_EXE=python"
    )
)

if not defined PYTHON_EXE (
    echo.
    echo [ERROR] Python 3 is required to start this app.
    echo         Could not find 'py' or 'python' in your system's PATH.
    echo.
    echo         Please install Python 3.11 or later from https://www.python.org/downloads/
    echo         and make sure to select "Add Python to PATH" during installation.
    pause
    exit /b 1
)

echo Using Python executable: %PYTHON_EXE%
echo.

echo Installing required packages...
%PYTHON_EXE% -m pip install -r requirements.txt
if %errorlevel% NEQ 0 (
    echo.
    echo [ERROR] Failed to install required packages.
    echo         Please check your internet connection and try again.
    pause
    exit /b 1
)

REM --- Find local IP address to display to the user ---
set "IP_ADDRESS="
for /f "tokens=1,2 delims=:" %%a in ('ipconfig^|find "IPv4"') do (
    for /f "tokens=*" %%c in ("%%b") do set "IP_ADDRESS=%%c"
)

cls
echo.
echo ====================================================================
echo  SLR Digital Safe Work Permit Server
echo ====================================================================
echo.
echo  Installation complete. Starting server...
echo.
echo  The server is now running.
echo.
echo  - On THIS computer, open: http://127.0.0.1:8081
echo.
if defined IP_ADDRESS (
    echo  - On another device on the same Wi-Fi, open: http://%IP_ADDRESS%:8081
) else (
    echo  - To use on another device, find this computer's "IPv4 Address" by
    echo    running 'ipconfig' in a new Command Prompt.
)
echo.
echo  (Press CTRL+C in this window to stop the server)
echo ====================================================================
echo.
%PYTHON_EXE% -m waitress --host=0.0.0.0 --port=8081 app:app
