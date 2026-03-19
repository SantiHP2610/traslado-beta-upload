# =============================================================================
# excel_reader.py
# Module responsible for reading the event Excel file and transforming its
# data into Python structures (dicts and lists) ready to be serialized to JSON.
#
# The source file is exported from an Access database, so field names are in
# Spanish and sometimes contain non-breaking spaces (\xa0) or trailing periods.
# All translation from Spanish Excel names to internal English keys happens
# here — the rest of the application only uses the internal names.
# =============================================================================

import datetime

import openpyxl


# ---------------------------------------------------------------------------
# Field name mapping: real Excel field names (Spanish, from source Access DB)
# → internal Python keys (English, as used throughout this application).
#
# This dict is the single source of truth for the translation.  If the Access
# export ever renames a field, only this dict needs updating.
# ---------------------------------------------------------------------------
_EVENT_FIELD_MAP = {
    "Menu":                                           "tipo",
    "Evento":                                         "ocasion",
    "Locacion":                                       "direccion_evento",
    "DescripcionLocacion":                            "descripcion_locacion",
    "Empresa":                                        "empresa",
    "Observaciones * (podes ponerlas todas juntas?)": "observaciones",
    "Fecha":                                          "fecha",
    "Horario":                                        "hora_inicio",
    "Comensales carne":                               "comensales",
    "Comensales veggie":                              "comensales_veggie",
}

# Number of data columns we care about in each table sheet.
# Trailing None columns (artefacts of merged cells or Access export) are
# sliced off before processing so they cannot produce spurious dict keys.
_EQUIPO_COLS      = 9  # Profesion … Patente + optional Telefono (9th)
_EQUIPO_BASE_COLS = 8  # The always-present columns (Profesion … Patente)
_PRESTACIONES_COLS = 3  # Servicio, Detalle, Cantidad


def read_excel(path: str) -> dict:
    """
    Reads the event Excel file and returns a dictionary with three keys:
      - 'event':    dict with the general event data (internal English field names)
      - 'staff':    list of dicts, one per staff member
      - 'services': list of dicts, one per contracted service

    Sheet names in the source file are capitalised: Evento, Equipo, Prestaciones.

    Parameters:
        path (str): Absolute or relative path to the .xlsx file.

    Returns:
        dict: { "event": {...}, "staff": [...], "services": [...] }
    """
    # Open in read-only mode; data_only=True reads computed cell values
    # instead of raw formula strings.
    workbook = openpyxl.load_workbook(path, data_only=True)

    return {
        "event":    _read_event(workbook["Evento"]),
        "staff":    _read_staff(workbook["Equipo"]),
        "services": _read_services(workbook["Prestaciones"]),
    }


# =============================================================================
# Private helpers (underscore prefix = internal to this module)
# =============================================================================

def _clean_str(value) -> str:
    """
    Normalises a cell value to a clean string:
      - Returns "" for None (empty cells).
      - Converts non-string types (e.g. integer CP postal codes) via str().
      - Strips non-breaking spaces (\xa0) that Access/Excel sometimes inserts
        in lieu of regular spaces — these would silently break comparisons.
      - Strips leading and trailing whitespace.
    """
    if value is None:
        return ""
    return str(value).replace("\xa0", " ").strip()


def _read_event(sheet) -> dict:
    """
    Reads the 'Evento' sheet, which has a field/value layout:
    every row is a (field_name, value) pair with NO header row.

    Raw Excel field names (Spanish) are translated to internal Python keys
    using _EVENT_FIELD_MAP.  Fields not present in the map are ignored.

    Special per-field processing:
    - "Locacion" → "direccion_evento": stored as the full address string.
      Additionally derives "ciudad_evento" by taking the last comma-separated
      token (e.g. "Juan Díaz de Solís 1261, Hurlingham." → "Hurlingham").
      The trailing period sometimes present in Access text fields is stripped.
    - "Horario" → "hora_inicio": openpyxl returns Excel time cells as
      datetime.time objects; we format them as "HH:MM" strings so the rest
      of the application can do simple string-based time arithmetic.
    - "Observaciones ..." → "observaciones": returned as a list of strings.
      The source Access field uses a literal "\\n" (backslash-n, not a real
      newline) as a line separator — we split on that sequence.
    - "Comensales carne" / "Comensales veggie" → int, defaulting to 0.
    """
    # Collect raw field→value pairs in one pass, then translate.
    raw: dict = {}
    for row in sheet.iter_rows(min_row=1, values_only=True):
        field = row[0]
        value = row[1] if len(row) > 1 else None
        if field is None:
            continue  # skip any trailing blank rows
        raw[str(field).strip()] = value

    result: dict = {}
    for excel_key, internal_key in _EVENT_FIELD_MAP.items():
        value = raw.get(excel_key)  # None if the field is absent from this sheet

        if internal_key == "hora_inicio":
            # openpyxl reads Excel time cells as datetime.time objects.
            # Convert to "HH:MM" string so the logistics module can parse it
            # with standard string operations (e.g. datetime.strptime).
            if isinstance(value, datetime.time):
                result[internal_key] = value.strftime("%H:%M")
            else:
                result[internal_key] = _clean_str(value)

        elif internal_key == "observaciones":
            # The Access multi-line text field encodes line breaks as the
            # literal two-character sequence backslash + "n", not as a real
            # newline character.  We split on "\\n" (a Python string of two
            # chars: \ and n) and return a list of stripped, non-empty lines.
            text = _clean_str(value)
            if text:
                result[internal_key] = [
                    line.strip()
                    for line in text.split("\\n")
                    if line.strip()
                ]
            else:
                result[internal_key] = []

        elif internal_key in ("comensales", "comensales_veggie"):
            # Guest counts are used as integers in all threshold comparisons.
            # Default to 0 if the cell is blank or contains an unexpected type.
            try:
                result[internal_key] = int(value) if value is not None else 0
            except (ValueError, TypeError):
                result[internal_key] = 0

        elif internal_key == "direccion_evento":
            # Store the full address string as-is for geocoding.
            full_address = _clean_str(value)
            result[internal_key] = full_address

            # Derive ciudad_evento by taking the last comma-separated token.
            # "Juan Díaz de Solís 1261, Hurlingham." → "Hurlingham"
            # rstrip(".") removes the trailing period that Access sometimes adds.
            parts = [p.strip().rstrip(".") for p in full_address.split(",") if p.strip()]
            result["ciudad_evento"] = parts[-1] if parts else ""

        else:
            result[internal_key] = _clean_str(value)

    return result


def _read_staff(sheet) -> list[dict]:
    """
    Reads the 'Equipo' sheet (table format: row 1 = headers, row 2+ = data).

    Cleaning rules applied to the real source data exported from Access:
    - The first 8 columns (Profesion … Patente) are always read.
    - A 9th column 'Telefono' is read when present; set to None otherwise.
      This makes the phone number field backwards-compatible with existing
      Excel files that only have 8 columns.
    - Rows where 'Profesion' is None or empty are skipped — these are either
      blank spacer rows or rows where only incidental data was entered.
    - '\xa0' (non-breaking space) is stripped from every string value.
    - The 'Auto' column value "NO" (case-insensitive, after stripping) signals
      that the employee does NOT own a car; it is normalised to "" so the
      rest of the application can treat any non-empty Auto as a car description.
      When Auto is blanked, Patente is also cleared for consistency.

    Note: seniority is embedded in the Profesion string
    (e.g. "Manager Senior", "Camarero Medior") — there is no separate column.
    """
    rows = list(sheet.iter_rows(values_only=True))
    if len(rows) < 2:
        return []

    # Use the canonical column names directly — the source header row may have
    # extra trailing None columns that we do not want as dict keys.
    # 'Telefono' is the optional 9th column; it is padded with None if the
    # sheet has fewer than 9 columns so downstream code always finds the key.
    headers = [
        "Profesion", "Nombre", "Apellido",
        "Direccion", "CP", "Ciudad",
        "Auto", "Patente",
        "Telefono",   # optional — None when column is absent from this Excel
    ]

    result = []
    for row in rows[1:]:
        # Read up to _EQUIPO_COLS (9) columns; pad shorter rows with None.
        # Python slicing never raises IndexError, so row[:9] on an 8-column
        # sheet returns 8 elements — the while-loop then appends the 9th None.
        values = list(row[:_EQUIPO_COLS])
        while len(values) < _EQUIPO_COLS:
            values.append(None)

        row_dict = dict(zip(headers, values))

        # Rows with no Profesion are spacer or junk rows — skip them.
        profesion = _clean_str(row_dict.get("Profesion"))
        if not profesion:
            continue

        # Clean the 8 always-present columns: strip \xa0 and whitespace.
        cleaned = {key: _clean_str(row_dict[key]) for key in headers[:_EQUIPO_BASE_COLS]}

        # Telefono: store None when the cell is empty or the column does not
        # exist in this Excel (both produce raw value None after padding).
        # When a value is present, strip whitespace the same way as other fields.
        telefono_raw = row_dict.get("Telefono")
        cleaned["Telefono"] = _clean_str(telefono_raw) if telefono_raw is not None else None

        # "NO" in the Auto column (from an Access boolean or dropdown) means
        # the employee has no personal vehicle.  Normalise to empty string
        # and clear the paired Patente so the detect_personal_vehicle()
        # function can treat any non-empty Auto as a car description.
        if cleaned.get("Auto", "").upper() == "NO":
            cleaned["Auto"]    = ""
            cleaned["Patente"] = ""

        result.append(cleaned)

    return result


def _read_services(sheet) -> list[dict]:
    """
    Reads the 'Prestaciones' sheet (table format: row 1 = headers, row 2+ = data).

    Only the first three columns are used (Servicio, Detalle, Cantidad).
    Extra columns beyond that (trailing None headers from Access export)
    are silently ignored.

    'Cantidad' is kept in its native numeric type (int or float) so the
    logistics thresholds in config.py can compare it directly without casting.
    Entirely blank rows are discarded.
    """
    rows = list(sheet.iter_rows(values_only=True))
    if len(rows) < 2:
        return []

    headers = ["Servicio", "Detalle", "Cantidad"]

    result = []
    for row in rows[1:]:
        values = list(row[:_PRESTACIONES_COLS])
        while len(values) < _PRESTACIONES_COLS:
            values.append(None)

        row_dict = dict(zip(headers, values))

        # Skip rows where every cell is empty or None
        if not any(v is not None and v != "" for v in row_dict.values()):
            continue

        cleaned = {}
        for key, val in row_dict.items():
            if key == "Cantidad":
                # Preserve the numeric type — logistics code compares against
                # integer thresholds defined in config.py.
                cleaned[key] = val
            else:
                cleaned[key] = _clean_str(val)

        result.append(cleaned)

    return result
