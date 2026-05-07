# 🚗 App Traslado Personal

> **Logistics planning tool for catering event staff transport — Buenos Aires**

A full-stack web application that automates the transport coordination for catering events. Given an Excel file with event and staff data, it plans vehicle assignments, meeting points, pickup stops and departure times — all on an interactive map.

> ⚠️ **Beta status:** The app currently works with the included test Excel file (`sample_data/evento_prueba.xlsx`). Automated export from the company's Access database is not yet implemented (see [Roadmap](#roadmap)).

---

## ✨ What it does

The app guides a manager through a step-by-step decision flow:

### Step 1 — Frescos vehicle
Determines whether the company van ("Vehículo QH") or a hired miniflete is needed based on the event's menu and guest count, and auto-assigns the senior manager and grill lead to it.

### Step 2 — Meeting point selection
Calculates the optimal staff meeting point (PE) from 3 fixed locations across Buenos Aires (Puente Saavedra, Caballito, Ramos Mejía) using the Google Routes API. It also proposes alternative meeting points (PEA) — transit hubs along the driver's route that minimize travel time for the remaining staff — using Google Places and Distance Matrix APIs.

### Step 3 — Vehicle & Uber assignment
Displays all staff on a map as interactive markers. The manager assigns each person to the personal vehicle or an Uber group via a context menu. The app groups Uber passengers optimally (max 4 per vehicle) and warns about single-passenger rides. Supports manual map-click pickup point selection for the car driver.

### Step 4 — Pickup points
For the personal vehicle, the app finds optimal pickup stops along the route (gas stations and 24h McDonald's near the route polyline) to pick up additional staff members without significant detours.

### Step 5 — Final output
Calculates departure times from the company depot (CP) and from the meeting point (PE/PEA), factoring in travel time, event duration, loading time, and long-event rules. Outputs a full transport summary: who goes where, in what vehicle, at what time.

### Bonus — Config panel
All business-rule thresholds (vehicle capacity, time buffers, pickup distances, etc.) are editable at runtime via a settings panel — no code changes needed.

---

## 🗺️ Screenshots

> *(Coming soon — add screenshots of the map view, assignment panel, and final output here)*

---

## 🛠 Tech stack

| Layer | Technologies |
|---|---|
| **Backend** | Python 3, FastAPI, uvicorn, openpyxl, httpx |
| **Frontend** | React 19, Vite, Tailwind CSS v4, shadcn/ui |
| **Maps** | Google Maps JS API, Geocoding, Routes, Distance Matrix, Places (New) |
| **State** | React useReducer + split contexts |
| **Caching** | File-based API cache (`.api_cache/`) + persistent geocoding cache |

---

## 🚀 Running locally

### Prerequisites
- Python 3.10+
- Node.js 18+
- A Google Cloud project with the following APIs enabled:
  - Maps JavaScript API
  - Geocoding API
  - Routes API
  - Distance Matrix API
  - Places API (New)

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/app-traslado-personal.git
cd app-traslado-personal
```

### 2. Backend setup

```bash
pip install -r requirements.txt
```

Create a `.env` file in the project root:

```env
GOOGLE_MAPS_API_KEY=your_api_key_here
```

Start the server:

```bash
uvicorn main:app --reload
```

The API will be available at `http://localhost:8000`.

### 3. Frontend setup

```bash
cd frontend
npm install
```

Create `frontend/.env`:

```env
VITE_API_BASE_URL=http://localhost:8000
VITE_GOOGLE_MAPS_API_KEY=your_api_key_here
VITE_GOOGLE_MAPS_MAP_ID=your_map_id_here
```

Start the dev server:

```bash
npm run dev
```

Open `http://localhost:5173`.

### 4. Load the test file

On the upload screen, click **"Usar Excel de prueba"** to load the included sample event and start exploring the app.

---

## 📊 Excel structure

The app reads a 3-sheet `.xlsx` file exported from the company's Access database:

| Sheet | Contents |
|---|---|
| `Evento` | Event details: menu type, date, time, venue address, guest count |
| `Equipo` | Staff list: name, role, seniority, home address, car availability |
| `Prestaciones` | Services contracted: grill station, equipment, etc. |

The test file (`sample_data/evento_prueba.xlsx`) contains a realistic fictional event with a full staff roster and can be regenerated at any time by running:

```bash
python _generar_excel.py
```

---

## 📁 Project structure

```
app-traslado-personal/
├── main.py               ← FastAPI server and all endpoints
├── config.py             ← All business-rule constants (editable at runtime)
├── modules/
│   ├── excel_reader.py   ← Reads the 3-sheet Excel
│   ├── maps_client.py    ← Google Maps: geocoding, routes, meeting points, pickup
│   ├── logistics.py      ← Business logic: vehicle assignment, departure times
│   ├── api_cache.py      ← File-based cache for Google API calls
│   ├── employee_cache.py ← Persistent geocoding cache for staff addresses
│   └── venue_cache.py    ← Persistent geocoding cache for event venues
├── sample_data/
│   └── evento_prueba.xlsx
├── _generar_excel.py     ← Generates test Excel file
├── requirements.txt
└── frontend/
    └── src/
        ├── App.jsx
        ├── AppShell.jsx
        ├── state/appState.jsx
        ├── components/
        │   ├── map/         ← Map, markers, polylines
        │   └── panels/      ← Step-by-step decision panels
        └── api/             ← Axios client and endpoint functions
```

---

## 🗺️ Roadmap

- [ ] **Access DB integration** — Automated export from company database to the required Excel format, triggered by entering an event code. This is the main blocker for production use.
- [ ] **Final output redesign** — Replace the two-panel output with a single full-screen summary view.
- [ ] **Phone numbers in UI** — Display staff phone numbers in map InfoWindows and assignment panels once the Excel format is finalized.
- [ ] **Pickup map overlay** — Visual circle around route cross-points for easier review.

---

## ⚙️ Notable implementation details

- **Stateless backend** — The frontend accumulates all state across steps; the backend never stores session data between requests. Each step passes all necessary context in the request body.
- **API cost optimization** — PEA candidate search uses a cluster-first approach (1–3 Places API calls per evaluation instead of ~40). Google API results are cached on disk to avoid redundant calls during development.
- **Config hot-reload** — `POST /config` updates all importing modules' namespaces at runtime and rewrites `config.py` on disk, preserving comments. No server restart needed to change thresholds.
- **Coordinate overrides** — Staff addresses can be corrected by dragging markers or entering an address directly on the map. Overrides persist for the session and trigger automatic route recalculation where relevant.

---

## 📄 License

Private project — not licensed for redistribution.
