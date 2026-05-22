@echo off
setlocal enabledelayedexpansion

echo.
echo  ============================================
echo   App Traslado Personal -- Desarrollo
echo  ============================================
echo.

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python no encontrado. Instala Python 3.10+ desde https://python.org
    pause & exit /b 1
)

:: Check Node
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js no encontrado. Instala Node.js 18+ desde https://nodejs.org
    pause & exit /b 1
)

:: Verificar .env
if not exist ".env" (
    echo [ATENCION] Falta el archivo .env en la raiz del proyecto.
    echo Crea un archivo ".env" con el siguiente contenido:
    echo.
    echo   GOOGLE_MAPS_API_KEY=tu_api_key_aqui
    echo.
    pause & exit /b 1
)
if not exist "frontend\.env" (
    echo [ATENCION] Falta el archivo frontend\.env
    echo Crea un archivo "frontend\.env" con el siguiente contenido:
    echo.
    echo   VITE_API_BASE_URL=http://localhost:8000
    echo   VITE_GOOGLE_MAPS_API_KEY=tu_api_key_aqui
    echo   VITE_GOOGLE_MAPS_MAP_ID=tu_map_id_aqui
    echo.
    pause & exit /b 1
)

:: Crear venv si no existe
if not exist "venv\" (
    echo [1/4] Creando entorno virtual...
    python -m venv venv
) else (
    echo [1/4] Entorno virtual OK.
)

:: Activar venv
call venv\Scripts\activate.bat

:: Instalar dependencias Python
echo.
echo [2/4] Verificando dependencias de Python...
pip install -r requirements.txt --quiet
if errorlevel 1 ( echo [ERROR] Fallo pip install. & pause & exit /b 1 )

:: Instalar dependencias frontend
echo.
echo [3/4] Verificando dependencias del frontend...
cd frontend
call npm install --silent
if errorlevel 1 ( echo [ERROR] Fallo npm install. & pause & exit /b 1 )
cd ..

:: Generar Excel de prueba
echo.
echo [4/4] Generando Excel de prueba...
python _generar_excel.py

:: Arrancar backend en ventana nueva
echo.
echo  Abriendo backend (uvicorn)...
start "Backend - App Traslado" cmd /k "call venv\Scripts\activate.bat && uvicorn main:app --reload"

:: Arrancar frontend en ventana nueva
echo  Abriendo frontend (npm dev)...
start "Frontend - App Traslado" cmd /k "cd frontend && npm run dev"

:: Esperar y abrir navegador
echo  Esperando que el frontend levante...
timeout /t 5 /nobreak >nul
start http://localhost:5173

echo.
echo  Todo listo. Modo desarrollo activo.
echo  Backend: http://localhost:8000
echo  Frontend: http://localhost:5173
echo.
pause
