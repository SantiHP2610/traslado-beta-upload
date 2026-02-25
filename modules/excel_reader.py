# =============================================================================
# excel_reader.py
# Module responsible for reading the event Excel file and transforming its
# data into Python structures (dicts and lists) ready to be serialized to JSON.
# =============================================================================

import openpyxl


def read_excel(path: str) -> dict:
    """
    Reads the event Excel file and returns a dictionary with three keys:
      - 'event':    dict with the general event data (field → value)
      - 'staff':    list of dicts, one per staff member
      - 'services': list of dicts, one per contracted service

    Parameters:
        path (str): Path to the .xlsx file to read.

    Returns:
        dict: { "event": {...}, "staff": [...], "services": [...] }
    """

    # Open the workbook in read-only mode (data_only=True reads calculated
    # values instead of raw formulas)
    workbook = openpyxl.load_workbook(path, data_only=True)

    return {
        "event":    _read_event(workbook["evento"]),
        "staff":    _read_table(workbook["equipo"]),
        "services": _read_table(workbook["prestaciones"]),
    }


# -----------------------------------------------------------------------------
# Internal helpers (underscore prefix signals private use within this module)
# -----------------------------------------------------------------------------

def _read_event(sheet) -> dict:
    """
    Reads the 'evento' sheet, which has a field/value layout in two columns.
    Row 1 is the header (field | value) and is discarded.
    Returns a dict: { "presupuesto": "...", "tipo": "...", ... }
    """
    result = {}

    # iter_rows starts from row 2 (min_row=2) to skip the header.
    # values_only=True returns raw cell values (not Cell objects).
    for field, value in sheet.iter_rows(min_row=2, values_only=True):
        # Skip rows where the field column is empty (trailing blank rows)
        if field is None:
            continue
        # Convert None values (empty cells) to empty string
        result[str(field).strip()] = value if value is not None else ""

    return result


def _read_table(sheet) -> list[dict]:
    """
    Reads a sheet in table format: row 1 contains the column headers,
    and subsequent rows contain the data.
    Returns a list of dicts, one per data row.

    Example for the 'equipo' sheet:
        [
          { "Profesion": "Chef", "Nombre": "Martín", ... },
          ...
        ]
    """
    rows = list(sheet.iter_rows(values_only=True))

    # If the sheet is empty or only has a header, return an empty list
    if len(rows) < 2:
        return []

    # First row contains the column headers; normalize each to a string
    headers = [str(col).strip() if col is not None else f"col_{i}"
               for i, col in enumerate(rows[0])]

    result = []
    for row in rows[1:]:  # iterate from the second row onward
        # Replace None with "" to avoid JSON serializing as null
        values = [v if v is not None else "" for v in row]

        # Combine headers with values using zip to build the row dict
        row_dict = dict(zip(headers, values))

        # Discard entirely empty rows (no useful value in any column)
        if any(v != "" for v in row_dict.values()):
            result.append(row_dict)

    return result
