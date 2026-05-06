# =============================================================================
# _generar_excel.py
# Auxiliary script (one-time use) to create / regenerate the sample test file.
# Run with: python _generar_excel.py
#
# The generated file mirrors the structure of the real Access-exported Excel:
#   - Sheet "Evento":       field/value pairs (NO header row), Spanish field names
#   - Sheet "Equipo":       table, row 1 = headers, seniority embedded in Profesion
#   - Sheet "Prestaciones": table, row 1 = headers, 3 columns
#
# Sheet names are capitalised to match the source file.
# All staff names and addresses are fictional.
# =============================================================================

from datetime import date, time
from pathlib import Path

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill

OUTPUT_PATH = Path(__file__).resolve().parent / "sample_data" / "evento_prueba.xlsx"

# Colors for header cells in the table sheets (Equipo, Prestaciones)
HEADER_BG_COLOR = "2F4F8F"  # dark blue background
HEADER_FG_COLOR = "FFFFFF"  # white text

# Color for field-name cells in the Evento sheet
FIELD_BG_COLOR  = "D9E1F2"  # light blue background
FIELD_FG_COLOR  = "000000"  # black text


def _style_header(cell):
    """Applies bold white text on dark blue background to a table header cell."""
    cell.font      = Font(bold=True, color=HEADER_FG_COLOR)
    cell.fill      = PatternFill(fill_type="solid", fgColor=HEADER_BG_COLOR)
    cell.alignment = Alignment(horizontal="center")


def _style_field_name(cell):
    """Applies light blue background to a field-name cell in the Evento sheet."""
    cell.font = Font(bold=True, color=FIELD_FG_COLOR)
    cell.fill = PatternFill(fill_type="solid", fgColor=FIELD_BG_COLOR)


def create_excel():
    wb = openpyxl.Workbook()

    # =========================================================================
    # SHEET 1: Evento
    # Format: two columns (field_name | value) with NO header row.
    # Field names match exactly what the Access export produces — the reader
    # translates them to internal English keys via _EVENT_FIELD_MAP.
    # =========================================================================
    ws_event = wb.active
    ws_event.title = "Evento"

    # Each tuple is (Excel field name, sample value).
    # "Observaciones" uses literal "\\n" as a line separator, matching the
    # Access multi-line text format that excel_reader.py splits on.
    # Fecha must be a date object (not a string) so openpyxl stores it as a
    # date serial — excel_reader.py expects openpyxl to return a date/datetime.
    # Horario must be a time object so openpyxl stores it as a time fraction —
    # excel_reader.py expects openpyxl to return datetime.time.
    event_data = [
        ("Menu",                                           "Asado Finger Food"),
        ("Evento",                                         "Cumpleaños"),
        # Locacion is the full address; ciudad_evento is derived from the last
        # comma-separated token ("Hurlingham") by excel_reader.py.
        ("Locacion",                                       "Juan Díaz de Solís 1261, Hurlingham."),
        ("DescripcionLocacion",                            "Hay una cocina de la casa (cuenta con 2 heladeras)."),
        ("Empresa",                                        None),
        # Literal backslash-n separates individual observations — NOT a real newline.
        ("Observaciones * (podes ponerlas todas juntas?)", "Confirmar horario final.\\nConfirmar comensales con restricciones alimentarias.\\n80 adultos, 15 menores"),
        ("Fecha",                                          date(2026, 3, 1)),   # stored as date serial, not string
        ("Horario",                                        time(20, 0)),        # stored as time fraction, not string
        ("Comensales carne",                               100),
        ("Comensales veggie",                              0),
    ]

    for row_idx, (field, value) in enumerate(event_data, start=1):
        ws_event.cell(row=row_idx, column=1, value=field)
        ws_event.cell(row=row_idx, column=2, value=value)
        _style_field_name(ws_event.cell(row=row_idx, column=1))

    ws_event.column_dimensions["A"].width = 46  # wide enough for the Observaciones key
    ws_event.column_dimensions["B"].width = 55

    # =========================================================================
    # SHEET 2: Equipo
    # Table format: row 1 = headers, subsequent rows = one employee per row.
    #
    # Seniority is embedded in the "Profesion" column string — there is no
    # separate "Senioridad" column in the real Access export.
    # Examples: "Manager Senior", "Camarero Medior", "Parrillero Junior".
    #
    # "Auto" column rules (mirroring the real data):
    #   - None / empty → employee has no car
    #   - "NO"         → employee has no car (normalised to "" by the reader)
    #   - Any other text (e.g. "FOX", "CORSA") → car make/model; employee has a car
    #
    # All names and addresses below are fictional.
    # =========================================================================
    ws_staff = wb.create_sheet("Equipo")

    staff_cols = ["Profesion", "Nombre", "Apellido", "Direccion", "CP", "Ciudad", "Auto", "Patente"]
    ws_staff.append(staff_cols)
    for col_idx, title in enumerate(staff_cols, start=1):
        _style_header(ws_staff.cell(row=1, column=col_idx))

    # Fictional Buenos Aires area staff.
    # One employee ("Facundo Sánchez") has a personal car (required for Step 4b).
    # "Marcela Gutiérrez" has "NO" in Auto — reader normalises this to empty string.
    # CP is left None for most employees as in the real export; Diego Castro
    # has a numeric CP to exercise the int→str conversion in _clean_str().
    staff = [
        # Profesion (with seniority)      Nombre       Apellido      Direccion                   CP    Ciudad        Auto   Patente
        ["Manager Senior",                "Valentina",  "Moreno",     "Rivadavia 3240",           None, "Haedo",      None,  None],
        ["Camarero Medior",               "Gonzalo",    "Pereyra",    "Belgrano 856",             None, "Ramos Mejía",None,  None],
        ["Jefe de Camareros Senior",      "Lucía",      "Ríos",       "Avenida Corrientes 4102",  None, "CABA",       None,  None],
        ["Camarero Senior",               "Marcela",    "Gutiérrez",  "San Martín 1567",          None, "Moreno",     "NO",  None],
        ["Jefe de Parrilla Senior",       "Diego",      "Castro",     "Av. Luro 743",             1754, None,         None,  None],
        ["Camarero Medior",               "Natalia",    "López",      "Alem 2891",                None, "Moreno",     None,  None],
        # Employee with a personal car — only one per event (see architecture rules)
        ["Parrillero Senior",             "Facundo",    "Sánchez",    "Av. Gaona 1234",           None, "Ituzaingó",  "FOX", None],
        [None, None, None, None, None, None, None, None],  # blank spacer row — reader skips it
        ["Camarero Medior",               "Romina",     "Vidal",      None,                       None, None,         None,  None],
    ]
    for row in staff:
        ws_staff.append(row)

    staff_col_widths = [26, 18, 18, 36, 8, 16, 8, 10]
    for col_idx, width in enumerate(staff_col_widths, start=1):
        ws_staff.column_dimensions[openpyxl.utils.get_column_letter(col_idx)].width = width

    # =========================================================================
    # SHEET 3: Prestaciones
    # Table format: row 1 = headers, subsequent rows = one service per row.
    # Only the first 3 columns matter; the reader ignores any extras.
    # =========================================================================
    ws_services = wb.create_sheet("Prestaciones")

    services_cols = ["Servicio", "Detalle", "Cantidad"]
    ws_services.append(services_cols)
    for col_idx, title in enumerate(services_cols, start=1):
        _style_header(ws_services.cell(row=1, column=col_idx))

    services = [
        ["Menu principal",  "Asado Finger Food",                             100],
        ["Menu principal",  "Menores entre 4 y 12 años 50%",                  15],
        ["Traslado",        "Personal",                                         1],
        ["Traslado",        "Estacion de fuegos",                               1],
        ["Postre",          "Shots y bocaditos",                              100],
        ["Postre",          "Menores entre 4 y 12 años 50%",                   15],
        ["Pinchos extra",   "Provoleta ahumada SIN CARGO",                    108],
    ]
    for row in services:
        ws_services.append(row)

    services_col_widths = [18, 46, 10]
    for col_idx, width in enumerate(services_col_widths, start=1):
        ws_services.column_dimensions[openpyxl.utils.get_column_letter(col_idx)].width = width

    # -------------------------------------------------------------------------
    # Save the file
    # -------------------------------------------------------------------------
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUTPUT_PATH)
    print(f"Excel file generated at: {OUTPUT_PATH}")


if __name__ == "__main__":
    create_excel()
