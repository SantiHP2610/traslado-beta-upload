#!/bin/bash
set -e

echo ""
echo " ============================================"
echo "  App Traslado Personal -- Setup y arranque"
echo " ============================================"
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] Python3 no encontrado. Instala Python 3.10+ desde https://python.org"
    exit 1
fi

# Check Node
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js no encontrado. Instala Node.js 18+ desde https://nodejs.org"
    exit 1
fi

# Verificar .env
if [ ! -f ".env" ]; then
    echo "[ATENCION] Falta el archivo .env en la raiz del proyecto."
    echo "Crea un archivo '.env' con el siguiente contenido:"
    echo ""
    echo "  GOOGLE_MAPS_API_KEY=tu_api_key_aqui"
    echo ""
    exit 1
fi
if [ ! -f "frontend/.env" ]; then
    echo "[ATENCION] Falta el archivo frontend/.env"
    echo "Crea un archivo 'frontend/.env' con el siguiente contenido:"
    echo ""
    echo "  VITE_API_BASE_URL=http://localhost:8000"
    echo "  VITE_GOOGLE_MAPS_API_KEY=tu_api_key_aqui"
    echo "  VITE_GOOGLE_MAPS_MAP_ID=tu_map_id_aqui"
    echo ""
    exit 1
fi

# Crear venv si no existe
if [ ! -d "venv" ]; then
    echo "[1/4] Creando entorno virtual..."
    python3 -m venv venv
else
    echo "[1/4] Entorno virtual ya existe, omitiendo creacion."
fi

# Activar venv
source venv/bin/activate

# Instalar dependencias Python
echo ""
echo "[2/4] Instalando dependencias de Python..."
pip install -r requirements.txt

# Instalar dependencias frontend
echo ""
echo "[3/4] Instalando dependencias del frontend..."
cd frontend && npm install && cd ..

# Generar Excel de prueba
echo ""
echo "[4/4] Generando Excel de prueba..."
python _generar_excel.py

# Arrancar backend en terminal nueva
echo ""
echo " Abriendo backend (uvicorn)..."
if [[ "$OSTYPE" == "darwin"* ]]; then
    osascript -e 'tell app "Terminal" to do script "cd '"$(pwd)"' && source venv/bin/activate && uvicorn main:app --reload"'
else
    gnome-terminal -- bash -c "cd $(pwd) && source venv/bin/activate && uvicorn main:app --reload; exec bash" 2>/dev/null || \
    xterm -e "cd $(pwd) && source venv/bin/activate && uvicorn main:app --reload" &
fi

# Arrancar frontend en terminal nueva
echo " Abriendo frontend (npm dev)..."
if [[ "$OSTYPE" == "darwin"* ]]; then
    osascript -e 'tell app "Terminal" to do script "cd '"$(pwd)"'/frontend && npm run dev"'
else
    gnome-terminal -- bash -c "cd $(pwd)/frontend && npm run dev; exec bash" 2>/dev/null || \
    xterm -e "cd $(pwd)/frontend && npm run dev" &
fi

# Esperar a que el frontend levante y abrir el navegador
echo " Esperando que el frontend levante..."
sleep 5
if [[ "$OSTYPE" == "darwin"* ]]; then
    open http://localhost:5173
else
    xdg-open http://localhost:5173
fi

echo ""
echo " Todo listo."
echo ""
