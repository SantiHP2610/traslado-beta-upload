# =============================================================================
# modules/venue_cache.py
# Persistent geocoding cache for event venues, stored in venues.json at the
# project root.
#
# Motivation:
#   The Geocoding API is called for the event venue address in every endpoint
#   that needs routing.  For the same event running multiple times, or during
#   development with frequent server restarts, the address never changes yet
#   the API would be hit on every request.  Persisting the result to disk means
#   each venue address is resolved at most once across the lifetime of the app.
#
# Key format:
#   Lowercase, stripped full address string (e.g. "palacio duhau, alvear 1661, caba").
#   Minor formatting differences in the Excel (extra spaces, mixed case) do not
#   cause spurious cache misses because the key is always normalised.
#
# Lookup semantics:
#   dict  — cache hit; valid {lat, lng, formatted_address}.
#   None  — cache miss; call geocode() and then save() the result.
#
# Note: unlike employee_cache.py, geocoding failures are NOT persisted.
#   If geocode() returns None (API error or unresolvable address), the caller
#   raises an HTTP exception; nothing is written to venues.json.  The next
#   request will retry the API rather than caching a permanent failure.
#
# Thread safety:
#   Not thread-safe.  This app is single-process (uvicorn with 1 worker) and
#   all geocoding happens in a single synchronous request, so a lock is unneeded.
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
_CACHE_PATH   = os.path.join(_PROJECT_ROOT, "venues.json")

# ---------------------------------------------------------------------------
# In-memory store
# ---------------------------------------------------------------------------

# Maps normalised address string → coords dict.
# Populated once at module import time by load(); updated by save().
_cache: dict = {}


# ---------------------------------------------------------------------------
# Internal helper
# ---------------------------------------------------------------------------

def _make_key(address: str) -> str:
    """
    Builds the canonical cache key from an address string.
    Lowercased and stripped so minor formatting differences do not cause misses.
    """
    return address.lower().strip()


# ---------------------------------------------------------------------------
# Public functions
# ---------------------------------------------------------------------------

def lookup(address: str) -> dict | None:
    """
    Looks up an event venue's geocoding result by address.

    Returns:
        dict  — cache hit; {lat, lng, formatted_address}.
        None  — cache miss; caller should geocode and then call save().
    """
    key = _make_key(address)
    return _cache.get(key)   # returns None for missing keys


def save(address: str, coords: dict) -> None:
    """
    Persists a venue's geocoding result to both the in-memory cache and
    venues.json on disk.

    Only call this when geocode() returned a valid result — do NOT save None
    (geocoding failures are not cached here; the next request will retry).

    Parameters:
        address (str):  The full event address string (will be normalised).
        coords  (dict): {lat, lng, formatted_address} from the Geocoding API.
    """
    key = _make_key(address)
    _cache[key] = coords
    with open(_CACHE_PATH, "w", encoding="utf-8") as f:
        # ensure_ascii=False preserves Spanish characters (accents, ñ, etc.)
        # indent=2 keeps the file human-readable for debugging
        json.dump(_cache, f, ensure_ascii=False, indent=2)


def load() -> None:
    """
    Reads venues.json from disk into the in-memory cache.

    Called automatically at module import time (see end of file).  Safe to
    call again to reload from disk if the file was modified externally.

    If the file does not exist, the cache starts empty and venues.json is
    created on the first save() call.
    """
    global _cache
    if not os.path.exists(_CACHE_PATH):
        _cache = {}
        return
    try:
        with open(_CACHE_PATH, "r", encoding="utf-8") as f:
            _cache = json.load(f)
    except (json.JSONDecodeError, OSError):
        # Corrupted or unreadable file — start fresh; will be overwritten on
        # the next save() call.
        _cache = {}


# ---------------------------------------------------------------------------
# Module-level initialisation
# ---------------------------------------------------------------------------

# Load from disk once when the module is first imported.
# All subsequent lookup() calls hit the in-memory dict (O(1) hash lookup);
# disk I/O only occurs when save() is called (i.e., on a cache miss).
load()
