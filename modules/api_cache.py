# =============================================================================
# modules/api_cache.py
# File-based cache for Google Maps API responses.
#
# Eliminates repeated API calls during development and testing by storing
# every API response as a JSON file keyed on the request parameters.
# First run with a given Excel file makes all real API calls and populates
# the cache; every subsequent run returns cached results with zero network
# traffic and zero quota cost.
#
# Toggle via .env:
#   API_CACHE_ENABLED=true   (default) — read/write cache
#   API_CACHE_ENABLED=false  — bypass cache entirely (production)
#
# Cache lives in .api_cache/ at the project root.  Each entry is a separate
# JSON file named by its SHA-256 content hash.  To reset: delete the folder.
# =============================================================================

import hashlib
import json
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
_CACHE_DIR = Path(__file__).resolve().parent.parent / ".api_cache"
_ENABLED   = os.getenv("API_CACHE_ENABLED", "true").lower() == "true"

# In-memory mirror of the on-disk cache so repeated lookups within the same
# process lifetime do not hit the filesystem on every call.
_memory: dict[str, object] = {}

# Set to True to print cache hit/miss messages to stdout (useful for
# debugging which calls are actually going to the network).
_VERBOSE = os.getenv("API_CACHE_VERBOSE", "false").lower() == "true"


def _make_key(namespace: str, *args, **kwargs) -> str:
    """
    Builds a deterministic cache key from a namespace string plus any
    combination of positional and keyword arguments.

    The key is a SHA-256 hex digest of the JSON-serialised arguments.
    Using JSON (with sorted keys) guarantees that semantically identical
    calls produce the same key regardless of dict insertion order.

    Parameters:
        namespace (str): Logical grouping — typically the function name
                         (e.g. "geocode", "calculate_distances").
        *args, **kwargs: The arguments that uniquely identify this API call.

    Returns:
        str: 64-character hex string usable as a filename.
    """
    raw = json.dumps(
        {"ns": namespace, "a": args, "kw": kwargs},
        sort_keys=True,
        default=str,    # handles datetime, Path, and other non-JSON types
    )
    return hashlib.sha256(raw.encode()).hexdigest()


def get(namespace: str, *args, **kwargs):
    """
    Looks up a cached API response.

    Returns the cached value (which may be None — a valid cached result)
    wrapped in a dict: {"hit": True, "data": <value>}.
    Returns None (bare) on cache miss.

    The {"hit": True} wrapper is necessary because the cached value itself
    can be None (e.g. geocode() returns None for unresolvable addresses),
    and we need to distinguish "not in cache" from "cached None".
    """
    if not _ENABLED:
        return None

    key = _make_key(namespace, *args, **kwargs)

    # Check in-memory mirror first (fastest path)
    if key in _memory:
        if _VERBOSE:
            print(f"  [CACHE HIT  memory] {namespace}")
        return {"hit": True, "data": _memory[key]}

    # Fall back to disk
    path = _CACHE_DIR / f"{key}.json"
    if path.exists():
        try:
            entry = json.loads(path.read_text(encoding="utf-8"))
            value = entry["data"]
            _memory[key] = value       # promote to memory for next lookup
            if _VERBOSE:
                print(f"  [CACHE HIT  disk]   {namespace}")
            return {"hit": True, "data": value}
        except (json.JSONDecodeError, KeyError):
            # Corrupted cache file — treat as miss, it will be overwritten
            pass

    if _VERBOSE:
        print(f"  [CACHE MISS]        {namespace}")
    return None


def put(namespace: str, value, *args, **kwargs) -> None:
    """
    Stores an API response in both the in-memory mirror and on disk.

    Parameters:
        namespace (str): Same namespace used in get().
        value:           The API response to cache (any JSON-serialisable value,
                         including None).
        *args, **kwargs: Same call arguments used in get() — must match
                         exactly so the key is consistent.
    """
    if not _ENABLED:
        return

    key = _make_key(namespace, *args, **kwargs)

    # Write to memory
    _memory[key] = value

    # Write to disk (create directory on first write)
    _CACHE_DIR.mkdir(exist_ok=True)
    path = _CACHE_DIR / f"{key}.json"
    path.write_text(
        json.dumps({"data": value}, default=str, ensure_ascii=False),
        encoding="utf-8",
    )


def clear() -> int:
    """
    Deletes all cached files and clears the in-memory mirror.

    Returns:
        int: Number of cache files deleted.
    """
    _memory.clear()
    count = 0
    if _CACHE_DIR.exists():
        for f in _CACHE_DIR.glob("*.json"):
            f.unlink()
            count += 1
    return count


def stats() -> dict:
    """
    Returns basic cache statistics for debugging.

    Returns:
        dict: {"enabled": bool, "memory_entries": int, "disk_entries": int}
    """
    disk_count = len(list(_CACHE_DIR.glob("*.json"))) if _CACHE_DIR.exists() else 0
    return {
        "enabled":        _ENABLED,
        "memory_entries": len(_memory),
        "disk_entries":   disk_count,
    }
