import os
import json
import time
import logging
from typing import Optional

logger = logging.getLogger(__name__)

CACHE_DIR = "/tmp/aether_cache"

def _get_ttl() -> int:
    try:
        config_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "config.json")
        with open(config_path, 'r') as f:
            return json.load(f).get("cache_ttl_seconds", 1800)
    except:
        return 1800

def _get_cache_path(url: str) -> str:
    """Generate a deterministic file path based on URL hash."""
    import hashlib
    # We use a simple hash of the URL to name the cache file
    url_hash = hashlib.md5(url.encode('utf-8')).hexdigest()
    return os.path.join(CACHE_DIR, f"{url_hash}.json")

def get_cached_response(url: str) -> Optional[str]:
    """Retrieves cached JSON if it exists and is less than 30 minutes old."""
    cache_path = _get_cache_path(url)
    ttl = _get_ttl()
    
    if os.path.exists(cache_path):
        file_age = time.time() - os.path.getmtime(cache_path)
        if file_age < ttl:
            logger.info(f"CACHE HIT: Loading data from {cache_path} (Age: {int(file_age)}s)")
            with open(cache_path, 'r') as f:
                return f.read()
        else:
            logger.info(f"CACHE EXPIRED: Data in {cache_path} is older than TTL ({ttl}s).")
    else:
        logger.info("CACHE MISS: Fetching fresh data from network.")
        
    return None

def set_cached_response(url: str, data: str):
    """Saves API response to the cache directory."""
    if not os.path.exists(CACHE_DIR):
        os.makedirs(CACHE_DIR)
        
    cache_path = _get_cache_path(url)
    with open(cache_path, 'w') as f:
        f.write(data)
    logger.info(f"Cached API response to {cache_path}")
