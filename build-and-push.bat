@echo off
echo =====================================
echo Docker Build und Push Script
echo =====================================
echo.

REM Backend Image bauen
echo [1/4] Building Backend Image...
docker build -f server/Dockerfile.backend -t davdocker70807/akquise-backend:latest .
if %errorlevel% neq 0 (
    echo ERROR: Backend Build fehlgeschlagen!
    exit /b 1
)
echo Backend Image erfolgreich gebaut!
echo.

REM Frontend Image bauen
echo [2/4] Building Frontend Image...
docker build -f client/Dockerfile -t davdocker70807/akquise-frontend:latest .
if %errorlevel% neq 0 (
    echo ERROR: Frontend Build fehlgeschlagen!
    exit /b 1
)
echo Frontend Image erfolgreich gebaut!
echo.

REM Backend Image pushen
echo [3/4] Pushing Backend Image...
docker push davdocker70807/akquise-backend:latest
if %errorlevel% neq 0 (
    echo ERROR: Backend Push fehlgeschlagen!
    exit /b 1
)
echo Backend Image erfolgreich gepusht!
echo.

REM Frontend Image pushen
echo [4/4] Pushing Frontend Image...
docker push davdocker70807/akquise-frontend:latest
if %errorlevel% neq 0 (
    echo ERROR: Frontend Push fehlgeschlagen!
    exit /b 1
)
echo Frontend Image erfolgreich gepusht!
echo.

echo =====================================
echo Fertig! Beide Images wurden gebaut und gepusht:
echo - davdocker70807/akquise-backend:latest
echo - davdocker70807/akquise-frontend:latest
echo =====================================
pause
