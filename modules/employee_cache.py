# =============================================================================
# modules/employee_cache.py
# Persistent geocoding cache for employees, stored in employees.json at the
# project root.
#
# Motivation:
#   The Geocoding API is called once per employee per event.  For a 10-person
#   team that appears in 50 events per year, that is 500 identical API calls
#   returning the same coordinates.  Persisting the results to disk means each
#   address is resolved at most once, regardless of how many events that employee
#   appears in.
#
# Key format:
#   "{nombre} {apellido}|{direccion}, {cp}, {ciudad}"
#   All components are lowercased and stripped.  Including the address in the
#   key means a person who moves gets re-geocoded automatically — the new address
#   is a different key and the old entry becomes an inert orphan.
#
# Three-state lookup semantics:
#   dict    — cache hit, valid {lat, lng, formatted_address}
#   None    — cache hit, geocoding previously failed for this address
#             (do NOT retry the API — failure is already recorded)
#   MISSING — key absent from cache; call the Geocoding API and save() the result
#
# Thread safety:
#   Not thread-safe.  This app is single-process (uvicorn with 1 worker) and all
#   geocoding happens in a single synchronous request, so a lock is not needed.
# =============================================================================

import json
import os

# ---------------------------------------------------------------------------
# File path
# ---------------------------------------------------------------------------

# Resolved relative to this file's own directory so the path is correct
# regardless of which directory the process was started from.
_HERE         = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.dirname(_HERE)
_CACHE_PATH   = os.path.join(_PROJECT_ROOT, "employees.json")

# ---------------------------------------------------------------------------
# In-memory store
# ---------------------------------------------------------------------------

# Maps cache key → coords dict | None.
# Populated once at module import time by load(); updated by save().
_cache: dict = {}

# ---------------------------------------------------------------------------
# Public sentinel
# ---------------------------------------------------------------------------

# Returned by lookup() when the key is entirely absent from the cache.
# Callers distinguish "not yet geocoded" (MISSING) from "geocoded but failed"
# (None) by checking `result is employee_cache.MISSING`.
MISSING = object()


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _make_key(nombre: str, apellido: str, direccion: str, cp: str, ciudad: str) -> str:
    """
    Builds the canonical cache key for a name + address combination.
    All components are lowercased and stripped so minor formatting differences
    in the Excel (extra spaces, mixed case) do not cause spurious cache misses.
    """
    full_name = f"{nombre.lower().strip()} {apellido.lower().strip()}"
    address   = (
        f"{direccion.lower().strip()}, "
        f"{str(cp).lower().strip()}, "
        f"{ciudad.lower().strip()}"
    )
    return f"{full_name}|{address}"


# ---------------------------------------------------------------------------
# Public functions
# ---------------------------------------------------------------------------

def load() -> None:
    """
    Reads employees.json from disk into the in-memory cache.

    Called automatically at module import time (see end of file).  Safe to
    call again to reload from disk if the file was modified externally.

    If the file does not exist, the cache starts empty and employees.json is
    created on the first save() call.
    """
    global _cache
    if not os.path.exists(_CACHE_PATH):
        _cache = {}
        return
    with open(_CACHE_PATH, "r", encoding="utf-8") as f:
        _cache = json.load(f)


def lookup(
    nombre:   str,
    apellido: str,
    direccion: str,
    cp:        str,
    ciudad:    str,
):
    """
    Looks up an employee's geocoding result by name + address.

    Returns:
        dict    — cache hit; valid {lat, lng, formatted_address}.
        None    — cache hit; geocoding previously failed for this address.
                  Do NOT retry — the failure is recorded so we skip the API.
        MISSING — key not in cache; the caller should geocode and then save().
    """
    key = _make_key(nombre, apellido, direccion, cp, ciudad)
    if key not in _cache:
        return MISSING
    # Value may be a coords dict (success) or None (previously failed geocode)
    return _cache[key]


def save(
    nombre:   str,
    apellido: str,
    direccion: str,
    cp:        str,
    ciudad:    str,
    coords,        # dict | None — None records a geocoding failure
) -> None:
    """
    Persists an employee's geocoding result to both the in-memory cache and
    employees.json on disk.

    Saving None is intentional: it records that geocoding failed for this
    address so future calls skip the API rather than retrying indefinitely.

    Parameters:
        coords: {lat, lng, formatted_address} on success, or None on failure.
    """
    key = _make_key(nombre, apellido, direccion, cp, ciudad)
    _cache[key] = coords
    with open(_CACHE_PATH, "w", encoding="utf-8") as f:
        # ensure_ascii=False preserves Spanish characters (accents, ñ, etc.)
        # indent=2 keeps the file human-readable for debugging
        json.dump(_cache, f, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# Module-level initialisation
# ---------------------------------------------------------------------------

# Load from disk once when the module is first imported.
# All subsequent lookup() calls hit the in-memory dict (O(1) hash lookup);
# disk I/O only occurs when save() is called (i.e., on a cache miss).
load()
