@echo off
REM Build and Push Docker Images to Docker Hub (Windows)
REM SIRA Akquise Tool

echo ================================
echo Building SIRA Akquise Images
echo ================================

SET DOCKER_USER=davdocker70807

REM Login to Docker Hub
echo Logging in to Docker Hub...
docker login -u %DOCKER_USER%

REM Build Backend
echo.
echo Building Backend...
docker build -f server/Dockerfile.backend -t %DOCKER_USER%/akquise-backend:latest .
echo Pushing Backend...
docker push %DOCKER_USER%/akquise-backend:latest

REM Build Frontend
echo.
echo Building Frontend...
docker build -f client/Dockerfile --build-arg VITE_API_URL=/api -t %DOCKER_USER%/akquise-frontend:latest .
echo Pushing Frontend...
docker push %DOCKER_USER%/akquise-frontend:latest

echo.
echo ================================
echo All images pushed successfully!
echo ================================
echo.
echo Images:
echo   - %DOCKER_USER%/akquise-backend:latest
echo   - %DOCKER_USER%/akquise-frontend:latest
echo.


pause
