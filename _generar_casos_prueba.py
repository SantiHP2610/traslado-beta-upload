# =============================================================================
# _generar_casos_prueba.py
# Generates multiple test Excel files in sample_data/ for edge case testing.
# Run with: python _generar_casos_prueba.py
# =============================================================================

import random
from datetime import date, time
from pathlib import Path

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill

OUTPUT_DIR = Path(__file__).resolve().parent / "sample_data"

HEADER_BG = "2F4F8F"
HEADER_FG = "FFFFFF"
FIELD_BG  = "D9E1F2"

ZONAS = {
    "norte": [
        ("Av. Cabildo 3200", None, "CABA"),
        ("Av. Maipú 1540", None, "Vicente López"),
        ("Av. del Libertador 8400", None, "Núñez"),
        ("Monroe 2100", None, "Belgrano"),
        ("Av. Congreso 2500", None, "Belgrano"),
        ("Av. Cramer 1800", None, "Belgrano"),
        ("Av. Elcano 3100", None, "Colegiales"),
        ("Av. Forest 900", None, "Chacarita"),
        ("Av. Triunvirato 4700", None, "Villa Urquiza"),
        ("Av. De los Incas 4200", None, "Parque Chas"),
        ("Av. Constituyentes 5100", None, "Villa Pueyrredón"),
        ("Av. San Isidro 4500", None, "Martínez"),
        ("Av. Centenario 600", None, "San Isidro"),
        ("Av. Rolón 2200", None, "Olivos"),
        ("Av. Santa Fe 1400", None, "Martínez"),
    ],
    "sur": [
        ("Av. Rivadavia 5200", None, "Caballito"),
        ("Av. Directorio 3100", None, "Flores"),
        ("Av. Corrientes 4800", None, "Almagro"),
        ("Av. La Plata 1200", None, "Boedo"),
        ("Yerbal 680", None, "Caballito"),
        ("Av. Jujuy 800", None, "San Cristóbal"),
        ("Av. Caseros 2400", None, "Parque Patricios"),
        ("Av. Sáenz 1100", None, "Pompeya"),
        ("Av. Almafuerte 300", None, "Boedo"),
        ("Av. Chiclana 3600", None, "Boedo"),
        ("Av. Independencia 3900", None, "Almagro"),
        ("Av. Castro Barros 1200", None, "Almagro"),
        ("Av. Mitre 700", None, "Avellaneda"),
        ("Av. Pavón 3200", None, "Lanús"),
        ("Av. Hipólito Yrigoyen 3800", None, "Remedios de Escalada"),
    ],
    "oeste": [
        ("Av. Gaona 1234", None, "Ituzaingó"),
        ("Rivadavia 3240", None, "Haedo"),
        ("San Martín 1567", None, "Moreno"),
        ("Belgrano 856", None, "Ramos Mejía"),
        ("Av. de Mayo 1200", None, "Ramos Mejía"),
        ("Av. Mosconi 2400", None, "Morón"),
        ("Av. Pierrestegui 500", None, "Merlo"),
        ("Av. Vergara 3100", None, "Hurlingham"),
        ("Av. Arias 2600", None, "Castelar"),
        ("Av. Gobernador Vergara 1700", None, "Hurlingham"),
        ("Av. Paso de la Patria 900", None, "Ituzaingó"),
        ("Av. 25 de Mayo 800", None, "Moreno"),
        ("Av. Ratti 2300", None, "Haedo"),
        ("Av. Pueyrredón 600", None, "Ciudadela"),
        ("Av. Sarmiento 1500", None, "Merlo"),
    ],
    "random_1": [
        ("Av. Santa Fe 3200", None, "CABA"),
        ("Av. Callao 800", None, "CABA"),
        ("Av. Pueyrredón 1100", None, "CABA"),
        ("Av. Scalabrini Ortiz 2300", None, "CABA"),
        ("Av. Cabildo 1500", None, "Belgrano"),
        ("Av. Córdoba 6200", None, "Chacarita"),
        ("Av. Warnes 1200", None, "Paternal"),
        ("Av. Nazca 800", None, "Villa del Parque"),
        ("Av. San Martín 5600", None, "Villa Devoto"),
        ("Av. Beiró 3500", None, "Villa Pueyrredón"),
        ("Av. Lope de Vega 2200", None, "Floresta"),
        ("Av. Segurola 1400", None, "Villa Santa Rita"),
        ("Av. Avellaneda 3000", None, "Flores"),
        ("Av. Boyacá 500", None, "Flores"),
        ("Av. Álvarez Jonte 4200", None, "Villa del Parque"),
    ],
    "random_2": [
        ("Av. Hipólito Yrigoyen 3400", None, "Lanús"),
        ("Av. Mitre 600", None, "Avellaneda"),
        ("Av. Centenario 500", None, "Lomas de Zamora"),
        ("Av. Alsina 1200", None, "Banfield"),
        ("Av. Pavón 3600", None, "Lanús"),
        ("Av. Belgrano 2800", None, "Remedios de Escalada"),
        ("Av. Meeks 800", None, "Wilde"),
        ("Av. Calchaquí 3200", None, "Quilmes"),
        ("Av. San Martín 1500", None, "Bernal"),
        ("Av. Dardo Rocha 600", None, "Adrogué"),
        ("Av. Espora 2200", None, "Temperley"),
        ("Av. Almirante Brown 1700", None, "Burzaco"),
        ("Av. Monteverde 400", None, "Claypole"),
        ("Av. Eva Perón 4100", None, "San José"),
        ("Av. Tomás Espora 1100", None, "Florencio Varela"),
    ],
}

NOMBRES = [
    "Valentina", "Gonzalo", "Lucía", "Marcela", "Diego", "Natalia",
    "Facundo", "Romina", "Agustín", "Camila", "Martín", "Florencia",
    "Sebastián", "Paula", "Federico", "Carolina", "Emilio", "Julieta",
]
APELLIDOS = [
    "Moreno", "Pereyra", "Ríos", "Gutiérrez", "Castro", "López",
    "Sánchez", "Vidal", "Fernández", "Domínguez", "Martínez", "Álvarez",
    "García", "Rodríguez", "Torres", "Romero", "Díaz", "Benítez",
]
PROFESIONES_STANDARD = [
    "Manager Senior", "Jefe de Parrilla Senior", "Parrillero Senior",
    "Jefe de Camareros Senior", "Camarero Senior", "Camarero Medior",
    "Camarero Medior", "Camarero Junior",
]


def _style_header(cell):
    cell.font = Font(bold=True, color=HEADER_FG)
    cell.fill = PatternFill(fill_type="solid", fgColor=HEADER_BG)
    cell.alignment = Alignment(horizontal="center")

def _style_field(cell):
    cell.font = Font(bold=True, color="000000")
    cell.fill = PatternFill(fill_type="solid", fgColor=FIELD_BG)


def _write_event(ws, data):
    ws.title = "Evento"
    for i, (field, val) in enumerate(data, 1):
        ws.cell(row=i, column=1, value=field)
        ws.cell(row=i, column=2, value=val)
        _style_field(ws.cell(row=i, column=1))
    ws.column_dimensions["A"].width = 46
    ws.column_dimensions["B"].width = 55


def _write_staff(wb, staff_rows):
    ws = wb.create_sheet("Equipo")
    cols = ["Profesion", "Nombre", "Apellido", "Direccion", "CP", "Ciudad", "Auto", "Patente"]
    ws.append(cols)
    for i, c in enumerate(cols, 1):
        _style_header(ws.cell(row=1, column=i))
    for row in staff_rows:
        ws.append(row)
    widths = [26, 18, 18, 36, 8, 16, 8, 10]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w


def _write_services(wb, service_rows):
    ws = wb.create_sheet("Prestaciones")
    cols = ["Servicio", "Detalle", "Cantidad"]
    ws.append(cols)
    for i, c in enumerate(cols, 1):
        _style_header(ws.cell(row=1, column=i))
    for row in service_rows:
        ws.append(row)
    widths = [18, 46, 10]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w


def _gen_staff(count, zona, with_car_index=None):
    """Generate staff rows. with_car_index = which employee gets a car (None = nobody)."""
    used = set()
    rows = []
    # Always start with Manager Senior + Jefe de Parrilla Senior (required for frescos)
    profs = ["Manager Senior", "Jefe de Parrilla Senior"]
    # Fill rest
    extras = ["Parrillero Senior", "Jefe de Camareros Senior", "Camarero Senior",
              "Camarero Medior", "Camarero Medior", "Camarero Junior",
              "Camarero Junior", "Camarero Medior", "Jefe Bebidas Senior",
              "Camarero bebidas Junior", "Camarero Senior", "Camarero Medior"]
    while len(profs) < count:
        profs.append(extras[len(profs) - 2] if (len(profs) - 2) < len(extras) else "Camarero Junior")

    addrs = ZONAS.get(zona, ZONAS["oeste"])

    for i in range(count):
        while True:
            n = random.choice(NOMBRES)
            a = random.choice(APELLIDOS)
            if (n, a) not in used:
                used.add((n, a))
                break
        addr = addrs[i % len(addrs)]
        car = None
        patente = None
        if with_car_index is not None and i == with_car_index:
            car = random.choice(["FOX", "CORSA", "GOLF", "ETIOS", "CRONOS"])
            patente = f"AB{random.randint(100,999)}CD"
        rows.append([profs[i], n, a, addr[0], addr[1], addr[2], car, patente])
    return rows


def save(wb, name):
    path = OUTPUT_DIR / name
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    wb.save(path)
    print(f"  ✓ {name}")


# ============================================================
# CASO 1: CABA pool grande — 12 empleados, con auto, pool > 8
# ============================================================
def caso_caba_pool_grande():
    wb = openpyxl.Workbook()
    _write_event(wb.active, [
        ("Menu", "Asado Finger Food"),
        ("Evento", "Corporativo"),
        ("Locacion", "Av. del Libertador 4700, CABA"),
        ("DescripcionLocacion", "Salón grande con cocina industrial"),
        ("Empresa", "TechCorp SA"),
        ("Observaciones", "Evento grande, verificar acceso para vehículos."),
        ("Fecha", date(2026, 7, 15)),
        ("Horario", time(20, 0)),
        ("Comensales carne", 150),
        ("Comensales veggie", 10),
    ])
    # 12 employees, one with car. After frescos (2 assigned), pool = 10 > CHARTER_THRESHOLD (8)
    _write_staff(wb, _gen_staff(12, "norte", with_car_index=6))
    _write_services(wb, [
        ["Menu principal", "Asado Finger Food", 150],
        ["Traslado", "Personal", 1],
        ["Traslado", "Estacion de fuegos", 1],
        ["Postre", "Torta 3 pisos", 150],
    ])
    save(wb, "caso_caba_pool_grande.xlsx")


# ============================================================
# CASO 1b: Charter real — 12 empleados, nadie tiene auto
# ============================================================
def caso_charter_real():
    wb = openpyxl.Workbook()
    _write_event(wb.active, [
        ("Menu", "Asado Finger Food"),
        ("Evento", "Corporativo"),
        ("Locacion", "Ruta 8 km 28, Pilar"),
        ("DescripcionLocacion", "Salón de eventos con estacionamiento amplio"),
        ("Empresa", "MegaCorp SA"),
        ("Observaciones", "Evento grande, acceso por colectora."),
        ("Fecha", date(2026, 8, 10)),
        ("Horario", time(20, 0)),
        ("Comensales carne", 160),
        ("Comensales veggie", 10),
    ])
    # 12 employees, NOBODY has car. After frescos (2): pool = 10 > 8 → charter
    _write_staff(wb, _gen_staff(12, "oeste", with_car_index=None))
    _write_services(wb, [
        ["Menu principal", "Asado Finger Food", 160],
        ["Traslado", "Personal", 1],
        ["Traslado", "Estacion de fuegos", 1],
        ["Postre", "Torta + shots", 160],
    ])
    save(wb, "caso_charter_real.xlsx")


# ============================================================
# CASO 2: Sin auto propio, muchas personas (10) — all Uber
# ============================================================
def caso_sin_auto():
    wb = openpyxl.Workbook()
    _write_event(wb.active, [
        ("Menu", "Asado Finger Food"),
        ("Evento", "Casamiento"),
        ("Locacion", "Av. Figueroa Alcorta 7500, CABA"),
        ("DescripcionLocacion", "Espacio al aire libre con parrilla propia"),
        ("Empresa", None),
        ("Observaciones", "Estacionamiento limitado, no hay cochera disponible."),
        ("Fecha", date(2026, 8, 22)),
        ("Horario", time(21, 0)),
        ("Comensales carne", 120),
        ("Comensales veggie", 15),
    ])
    # 10 employees, NOBODY has a car
    _write_staff(wb, _gen_staff(10, "norte", with_car_index=None))
    _write_services(wb, [
        ["Menu principal", "Asado Finger Food", 120],
        ["Traslado", "Personal", 1],
        ["Traslado", "Estacion de fuegos", 1],
        ["Bebidas", "Acompañamiento bebidas", 25],
        ["Postre", "Shots y bocaditos", 120],
    ])
    save(wb, "caso_sin_auto.xlsx")


# ============================================================
# CASO 3: Evento zona norte — PE should be Puente Saavedra
# ============================================================
def caso_pe_norte():
    wb = openpyxl.Workbook()
    _write_event(wb.active, [
        ("Menu", "Asado Finger Food"),
        ("Evento", "Cumpleaños de 50"),
        ("Locacion", "Av. Maipú 2300, Olivos"),
        ("DescripcionLocacion", "Casa con jardín amplio"),
        ("Empresa", None),
        ("Observaciones", "Acceso por calle lateral."),
        ("Fecha", date(2026, 6, 20)),
        ("Horario", time(19, 30)),
        ("Comensales carne", 80),
        ("Comensales veggie", 5),
    ])
    _write_staff(wb, _gen_staff(8, "norte", with_car_index=6))
    _write_services(wb, [
        ["Menu principal", "Asado Finger Food", 80],
        ["Traslado", "Personal", 1],
        ["Traslado", "Estacion de fuegos", 1],
        ["Postre", "Shots y bocaditos", 80],
    ])
    save(wb, "caso_pe_norte.xlsx")


# ============================================================
# CASO 4: Evento zona sur — PE should be Caballito
# ============================================================
def caso_pe_sur():
    wb = openpyxl.Workbook()
    _write_event(wb.active, [
        ("Menu", "Asado tradicional"),
        ("Evento", "Aniversario"),
        ("Locacion", "Av. Eva Perón 3200, Lanús"),
        ("DescripcionLocacion", "Quincho cerrado con parrilla"),
        ("Empresa", None),
        ("Observaciones", "Confirmar acceso camión por calle angosta."),
        ("Fecha", date(2026, 9, 10)),
        ("Horario", time(13, 0)),
        ("Comensales carne", 65),
        ("Comensales veggie", 0),
    ])
    _write_staff(wb, _gen_staff(7, "sur", with_car_index=5))
    _write_services(wb, [
        ["Menu principal", "Asado tradicional", 65],
        ["Traslado", "Personal", 1],
        ["Postre", "Flan con dulce de leche", 65],
    ])
    save(wb, "caso_pe_sur.xlsx")


# ============================================================
# CASO 5: Equipo chico — 5 total, auto lleno, sin Uber
# ============================================================
def caso_equipo_chico():
    wb = openpyxl.Workbook()
    _write_event(wb.active, [
        ("Menu", "Asado Finger Food"),
        ("Evento", "Reunión familiar"),
        ("Locacion", "Sarmiento 450, Ituzaingó"),
        ("DescripcionLocacion", "Casa familiar, cocina chica"),
        ("Empresa", None),
        ("Observaciones", "Evento íntimo, confirmar menores."),
        ("Fecha", date(2026, 5, 3)),
        ("Horario", time(12, 30)),
        ("Comensales carne", 30),
        ("Comensales veggie", 5),
    ])
    # 5 employees: 2 go to frescos, 3 remain. Car holds all 3 + driver = 4/5. No Uber needed.
    _write_staff(wb, _gen_staff(5, "oeste", with_car_index=4))
    _write_services(wb, [
        ["Menu principal", "Asado Finger Food", 30],
        ["Traslado", "Personal", 1],
    ])
    save(wb, "caso_equipo_chico.xlsx")


# ============================================================
# CASO 6 y 7: Random events for manager testing
# ============================================================
def caso_random(n, zona, filename):
    wb = openpyxl.Workbook()
    menus = ["Asado Finger Food", "Asado tradicional"]
    eventos = ["Cumpleaños", "Casamiento", "Corporativo", "Aniversario", "Bautismo"]
    ubicaciones = [
        ("Av. San Martín 1800, Caseros", "Salón de eventos con estacionamiento"),
        ("Ruta 8 km 32, Pilar", "Country club, acceso con DNI"),
        ("Av. Centenario 300, Lomas de Zamora", "Club social, salón principal"),
        ("Av. Boulogne Sur Mer 500, Boulogne", "Quinta con parque y pileta"),
    ]
    ubi = random.choice(ubicaciones)
    comensales = random.choice([50, 70, 90, 100, 120])
    menu = random.choice(menus)

    _write_event(wb.active, [
        ("Menu", menu),
        ("Evento", random.choice(eventos)),
        ("Locacion", ubi[0]),
        ("DescripcionLocacion", ubi[1]),
        ("Empresa", random.choice([None, "Empresa SA", "Corp XYZ"])),
        ("Observaciones", "Evento de prueba generado aleatoriamente."),
        ("Fecha", date(2026, random.randint(6, 12), random.randint(1, 28))),
        ("Horario", time(random.choice([12, 13, 19, 20, 21]), 0)),
        ("Comensales carne", comensales),
        ("Comensales veggie", random.randint(0, 15)),
    ])
    has_car = random.choice([None, random.randint(3, n - 1)])
    _write_staff(wb, _gen_staff(n, zona, with_car_index=has_car))

    services = [["Menu principal", menu, comensales], ["Traslado", "Personal", 1]]
    if random.random() > 0.5:
        services.append(["Traslado", "Estacion de fuegos", 1])
    if comensales > 80:
        services.append(["Bebidas", "Acompañamiento bebidas", random.randint(15, 30)])
    services.append(["Postre", "Shots y bocaditos", comensales])
    _write_services(wb, services)
    save(wb, filename)


if __name__ == "__main__":
    print("Generando casos de prueba...\n")
    random.seed(42)  # reproducible
    caso_caba_pool_grande()
    caso_charter_real()
    caso_sin_auto()
    caso_pe_norte()
    caso_pe_sur()
    caso_equipo_chico()
    caso_random(8, "random_1", "caso_random_1.xlsx")
    caso_random(7, "random_2", "caso_random_2.xlsx")
    print("\n¡Listo! 7 archivos generados en sample_data/")
