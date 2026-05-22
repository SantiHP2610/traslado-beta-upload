@echo off
setlocal enabledelayedexpansion

echo.
echo  ============================================
echo   App Traslado Personal
echo  ============================================
echo.

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python no encontrado. Instala Python 3.10+ desde https://python.org
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

:: Verificar build del frontend
if not exist "frontend\dist\index.html" (
    echo [ERROR] El frontend no esta compilado.
    echo Ejecuta "npm run build" en la carpeta frontend desde la PC de desarrollo
    echo antes de copiar el proyecto a esta computadora.
    pause & exit /b 1
)

:: Crear venv si no existe
if not exist "venv\" (
    echo [1/2] Creando entorno virtual...
    python -m venv venv
) else (
    echo [1/2] Entorno virtual OK.
)

:: Activar venv e instalar dependencias
call venv\Scripts\activate.bat
echo.
echo [2/2] Verificando dependencias...
pip install -r requirements.txt --quiet
if errorlevel 1 ( echo [ERROR] Fallo pip install. & pause & exit /b 1 )

:: Arrancar la app
echo.
echo  Iniciando la aplicacion...
echo  (No cerrar esta ventana mientras se use la app)
echo.
set SERVE_FRONTEND=true
start http://localhost:8000
uvicorn main:app
