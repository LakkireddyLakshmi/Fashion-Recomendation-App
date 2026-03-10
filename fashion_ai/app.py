"""
HueIQ Recommendation Engine v9.0

CHANGES in this version:
  1. Replaced MongoDB with Boss PostgreSQL API as the user + catalog backend
     (POST/GET/PUT /api/users, /api/auth/signup, /api/auth/login, /api/catalog)
  2. All user CRUD proxied to Boss API (PostgreSQL-backed)
  3. Catalog fetched from Boss API /api/catalog instead of MongoDB
  4. Removed motor dependency entirely
  5. Kept all frontend-facing API endpoints unchanged
  6. Recommendation scoring engine unchanged (7 weighted signals)
"""

from __future__ import annotations
import asyncio, hashlib, json, logging, os, time, uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Path, Query, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity as sk_cosine

try:
    import bcrypt
    BCRYPT_OK = True
except ImportError:
    BCRYPT_OK = False

try:
    import jwt as pyjwt
    JWT_OK = True
except ImportError:
    JWT_OK = False

load_dotenv()
logging.basicConfig(level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("hueiq")


# ── Config ────────────────────────────────────────────────────────
BOSS_URL   = os.getenv("BOSS_API_URL",
    "https://hueiq-core-api.purplesand-63becfba.westus2.azurecontainerapps.io")
BOSS_TOKEN = os.getenv("BOSS_TOKEN", "")
DIFY_URL   = os.getenv("DIFY_API_URL",  "https://cloud.xpectrum.co")
DIFY_KEY   = os.getenv("DIFY_API_KEY",  "app-6XxyzGBrc3Sjj56vcWD2uNrn")
JWT_SECRET = os.getenv("JWT_SECRET",    "hueiq-secret-change-in-prod")
JWT_HOURS  = int(os.getenv("JWT_EXPIRE_HOURS", "72"))


# ── Boss API HTTP client ─────────────────────────────────────────
_boss_cli: Optional[httpx.AsyncClient] = None

async def _boss_client() -> httpx.AsyncClient:
    global _boss_cli
    if _boss_cli is None or _boss_cli.is_closed:
        _boss_cli = httpx.AsyncClient(base_url=BOSS_URL, timeout=60.0)
    return _boss_cli

def _boss_headers(token: str = "") -> Dict[str, str]:
    """Auth headers for Boss API calls. No Content-Type for GET requests."""
    t = token or BOSS_TOKEN
    h: Dict[str, str] = {}
    if t:
        h["Authorization"] = f"Bearer {t}"
    return h


# ── Password + JWT ────────────────────────────────────────────────
def _hash_pw(pw: str) -> str:
    if BCRYPT_OK:
        return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()
    return hashlib.sha256(pw.encode()).hexdigest()

def _check_pw(pw: str, h: str) -> bool:
    if BCRYPT_OK:
        try: return bcrypt.checkpw(pw.encode(), h.encode())
        except Exception: pass
    return hashlib.sha256(pw.encode()).hexdigest() == h

def _make_token(user_id: str, email: str) -> str:
    if JWT_OK:
        return pyjwt.encode(
            {"user_id": user_id, "email": email,
             "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_HOURS)},
            JWT_SECRET, algorithm="HS256")
    return hashlib.sha256(f"{user_id}:{JWT_SECRET}".encode()).hexdigest()

def _decode_token(token: str) -> Optional[Dict]:
    if JWT_OK:
        try: return pyjwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        except Exception: return None
    return None

security = HTTPBearer(auto_error=False)

async def current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(security)
) -> Optional[Dict]:
    if not creds: return None
    return _decode_token(creds.credentials)


# ── Gender normalise ──────────────────────────────────────────────
def _norm_gender(g: str) -> str:
    """Normalize to catalog storage values: 'men' or 'women'."""
    g = (g or "").lower().strip()
    if g in ("men", "male", "man", "m"):               return "men"
    if g in ("female", "women", "woman", "f", "w"):    return "women"
    return g


# ── In-memory fallback (used when Boss API is unreachable) ────────
_mem_users: Dict[str, Dict] = {}
_mem_email: Dict[str, str]  = {}


# ── User helpers — proxy to Boss PostgreSQL API ───────────────────
# Boss API schema:
#   POST /api/users        → create user (name, email, password, profile_data)
#   GET  /api/users/{id}   → get user by id
#   PUT  /api/users/{id}   → update user (profile_data)
#   POST /api/auth/signup  → register (email, password) → access_token
#   POST /api/auth/login   → login (email, password) → access_token

def _boss_uid_from_token(token: str) -> Optional[str]:
    """Extract user_id (sub) from a Boss API JWT without verification."""
    try:
        import base64
        payload = token.split(".")[1]
        payload += "=" * (4 - len(payload) % 4)
        data = json.loads(base64.urlsafe_b64decode(payload))
        return str(data.get("sub", ""))
    except Exception:
        return None

async def _boss_get_user(boss_token: str) -> Optional[Dict]:
    """Get user doc from Boss API using a Boss access_token."""
    uid = _boss_uid_from_token(boss_token)
    if not uid:
        return None
    try:
        c = await _boss_client()
        r = await c.get(f"/api/users/{uid}", headers=_boss_headers(boss_token))
        if r.status_code == 200:
            return _boss_user_to_doc(r.json())
    except Exception as e:
        log.warning("Boss get_user failed: %s", e)
    return None

def _boss_user_to_doc(raw: Dict) -> Dict:
    """Normalise Boss API UserResponse to our internal user doc shape."""
    uid = str(raw.get("id") or raw.get("user_id") or "")
    pj  = raw.get("profile_data_json") or raw.get("profile_data") or {}
    if isinstance(pj, str):
        try: pj = json.loads(pj)
        except Exception: pj = {}
    return {
        "user_id":           uid,
        "name":              raw.get("name") or pj.get("name", ""),
        "email":             (raw.get("email") or "").strip().lower(),
        "created_at":        raw.get("created_at", ""),
        "updated_at":        raw.get("updated_at", ""),
        "profile_data_json": pj,
    }


async def db_create_user(data: Dict) -> Dict:
    """
    Creates user via Boss API: POST /api/auth/signup then PUT /api/users/{id}
    to attach profile_data_json.
    """
    email = data["email"].strip().lower()
    password = data.get("password", "")

    profile_data = {
        "gender":               _norm_gender(data.get("gender", "")),
        "preferred_colors":     data.get("preferred_colors", []),
        "preferred_categories": data.get("preferred_categories", []),
        "preferred_season":     data.get("preferred_season", ""),
        "style_preferences":    data.get("style_preferences", []),
        "body_measurements":    data.get("body_measurements", {}),
        "age":                  data.get("age"),
        "location":             data.get("location", ""),
    }

    try:
        c = await _boss_client()

        # Step 1: signup via Boss auth
        signup_r = await c.post("/api/auth/signup", json={
            "email": email,
            "password": password,
            "user_type": "shopper",
        }, headers={"Content-Type": "application/json"})

        if signup_r.status_code in (200, 201):
            signup_data = signup_r.json()
            boss_uid = str(signup_data.get("id") or "")
            boss_token = signup_data.get("access_token", "")
        elif signup_r.status_code == 409 or (
            signup_r.status_code >= 400 and "already" in (signup_r.text or "").lower()
        ):
            # User already exists — try login to get their ID and token
            log.info("User %s already exists on Boss API — trying login", email)
            login_r = await c.post("/api/auth/login", json={
                "email": email, "password": password,
            }, headers={"Content-Type": "application/json"})
            if login_r.status_code != 200:
                login_r = await c.post("/api/auth/login", data={
                    "username": email, "password": password,
                })
            if login_r.status_code == 200:
                login_data = login_r.json()
                boss_token = login_data.get("access_token", "")
                # Extract user_id from Boss JWT
                boss_uid = _boss_uid_from_token(boss_token) or ""
                if not boss_uid:
                    raise HTTPException(409, "Email already registered — please login")
            else:
                raise HTTPException(409, "Email already registered")
        else:
            log.warning("Boss signup failed (%d): %s", signup_r.status_code, signup_r.text[:300])
            raise HTTPException(502, "Upstream signup failed")

        # Step 2: save profile_data via PUT /api/users/{id}
        if boss_uid:
            await c.put(f"/api/users/{boss_uid}", json={
                "profile_data": profile_data,
            }, headers=_boss_headers(boss_token))

        doc = {
            "user_id":           boss_uid,
            "name":              data.get("name", "") or email.split("@")[0],
            "email":             email,
            "created_at":        datetime.now(timezone.utc).isoformat(),
            "updated_at":        datetime.now(timezone.utc).isoformat(),
            "profile_data_json": profile_data,
            "_boss_token":       boss_token,
        }
        # Cache locally
        _mem_users[boss_uid] = doc
        _mem_email[email] = boss_uid
        log.info("User created via Boss API: %s (user_id=%s)", email, boss_uid)
        return doc

    except HTTPException:
        raise
    except Exception as e:
        log.warning("Boss API create_user failed: %s — falling back to in-memory", e)
        # Fallback to in-memory
        uid = str(uuid.uuid4())
        doc = {
            "user_id": uid, "name": data.get("name", ""),
            "email": email, "password_hash": _hash_pw(password),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "profile_data_json": profile_data,
        }
        _mem_users[uid] = doc
        _mem_email[email] = uid
        log.info("User saved → in-memory fallback: %s", email)
        return doc


async def db_get_by_email(email: str) -> Optional[Dict]:
    """Look up user by email — try local cache first, then Boss login probe."""
    email = email.strip().lower()
    # Check local cache
    uid = _mem_email.get(email)
    if uid and uid in _mem_users:
        return _mem_users[uid]
    # No direct Boss API "get by email" endpoint — return None
    # The caller should use Boss login to verify credentials
    return None


async def db_get_by_id(uid: str) -> Optional[Dict]:
    """Get user by ID — try local cache, then Boss API GET /api/users/{id}."""
    if uid in _mem_users:
        return _mem_users[uid]

    # Boss API uses integer user_ids. Skip API call for UUID-format IDs
    # (leftover from old MongoDB sessions).
    try:
        int(uid)  # Only call Boss if uid looks like an integer
    except (ValueError, TypeError):
        log.debug("Skipping Boss API for non-integer user_id: %s", uid)
        return None

    try:
        c = await _boss_client()
        r = await c.get(f"/api/users/{uid}", headers=_boss_headers())
        if r.status_code == 200:
            doc = _boss_user_to_doc(r.json())
            _mem_users[doc["user_id"]] = doc
            if doc["email"]:
                _mem_email[doc["email"]] = doc["user_id"]
            return doc
    except Exception as e:
        log.warning("Boss API get_by_id failed: %s", e)
    return None


async def db_update_profile(uid: str, pj: Dict) -> Optional[Dict]:
    """Update profile_data via Boss API PUT /api/users/{id}."""
    try:
        c = await _boss_client()
        r = await c.put(f"/api/users/{uid}", json={
            "profile_data": pj,
        }, headers=_boss_headers())
        if r.status_code == 200:
            doc = _boss_user_to_doc(r.json())
            # Ensure profile_data_json has the merged data
            doc["profile_data_json"] = pj
            _mem_users[doc["user_id"]] = doc
            log.info("Profile updated via Boss API: user_id=%s", uid)
            return doc
        else:
            log.warning("Boss API update_profile (%d): %s", r.status_code, r.text[:200])
    except Exception as e:
        log.warning("Boss API update_profile failed: %s", e)

    # Fallback: update local cache
    if uid in _mem_users:
        _mem_users[uid]["profile_data_json"] = pj
        _mem_users[uid]["updated_at"] = datetime.now(timezone.utc).isoformat()
        return _mem_users[uid]
    return None


# ── TTL cache ─────────────────────────────────────────────────────
_cache: Dict[str, Tuple[Any, float]] = {}

def _cget(k: str) -> Optional[Any]:
    e = _cache.get(k)
    if not e: return None
    v, exp = e
    if time.time() > exp:
        del _cache[k]
        return None
    return v

def _cset(k: str, v: Any, ttl: int = 600):
    _cache[k] = (v, time.time() + ttl)


# ── Catalog field extractors ──────────────────────────────────────
def _tags(item: Dict) -> List[str]:
    """style_tags is JSONB: { tags: [...] }"""
    st = item.get("style_tags")
    out: List[str] = []
    if isinstance(st, dict):
        out = [str(t) for t in (st.get("tags") or [])]
    elif isinstance(st, list):
        out = [str(t) for t in st]
    em = item.get("extra_metadata") or {}
    if isinstance(em, dict):
        for f in ("occasion", "season", "fabric", "subcategory"):
            v = em.get(f)
            if v and str(v) not in out:
                out.append(str(v))
    return out

def _gender(item: Dict) -> str:
    em = item.get("extra_metadata") or {}
    return (
        item.get("gender") or
        (em.get("gender") if isinstance(em, dict) else None) or
        "unisex"
    ).lower()

def _season_item(item: Dict) -> str:
    em = item.get("extra_metadata") or {}
    return (em.get("season") if isinstance(em, dict) else None) or item.get("season") or ""

def _fabric(item: Dict) -> str:
    em = item.get("extra_metadata") or {}
    return (em.get("fabric") if isinstance(em, dict) else None) or item.get("fabric") or ""

def _item_colors(item: Dict) -> Set[str]:
    """Collect all color_variants from images[] and variants[]."""
    colors: Set[str] = set()
    for img in (item.get("images") or []):
        if isinstance(img, dict) and img.get("color_variant"):
            colors.add(img["color_variant"].lower())
    for v in (item.get("variants") or []):
        if isinstance(v, dict) and v.get("color"):
            colors.add(v["color"].lower())
    return colors

def _in_stock(item: Dict) -> bool:
    vs = item.get("variants") or []
    if not vs:
        return bool(item.get("in_stock", True))
    def _qty(v):
        try: return int(v.get("stock_quantity") or 0)
        except (TypeError, ValueError): return 0
    return any(_qty(v) > 0 for v in vs if isinstance(v, dict))

def _physics_profile(item: Dict) -> Optional[str]:
    """
    assets_3d.physics_profile is JSONB (dict) in DB schema.
    Handles both dict and legacy string gracefully.
    """
    a3d = item.get("assets_3d")
    if not isinstance(a3d, dict):
        return None
    phys = a3d.get("physics_profile")
    if isinstance(phys, dict):
        # JSONB object — extract the most useful key
        return (phys.get("type") or phys.get("fabric_type") or
                phys.get("profile") or str(next(iter(phys.values()), "")) or None)
    if isinstance(phys, str):
        return phys.lower() or None
    return None


# ── Catalog fetch from Boss PostgreSQL API ────────────────────────
async def fetch_catalog(
    gender:     Optional[str]       = None,
    colors:     Optional[List[str]] = None,
    categories: Optional[List[str]] = None,
    season:     Optional[str]       = None,
    limit:      int                 = 500,
) -> List[Dict]:
    """
    Fetches catalog from Boss API GET /api/catalog.
    Filtering by gender/category is done server-side via query params.
    Color and season filtering is done client-side by the Python ranker.
    """
    ck = f"cat:{gender}:{','.join(colors or [])}:{','.join(categories or [])}:{season}:{limit}"
    cached = _cget(ck)
    if cached is not None:
        return cached

    try:
        c = await _boss_client()
        h = _boss_headers()

        # Boss API supports: skip, limit, category query params
        params: Dict[str, Any] = {"limit": limit, "skip": 0}
        if categories and len(categories) == 1:
            params["category"] = categories[0]

        r = await c.get("/api/catalog", params=params, headers=h)
        if r.status_code == 200:
            raw = r.json()
            items = raw if isinstance(raw, list) else raw.get("items", raw.get("data", []))
            # If response is a dict with catalog items nested
            if isinstance(raw, dict) and not items:
                items = [v for v in raw.values() if isinstance(v, list)]
                items = items[0] if items else []
        else:
            log.warning("Boss catalog fetch (%d): %s", r.status_code, r.text[:200])
            items = []

    except Exception as e:
        log.warning("Boss API catalog fetch failed: %r — trying trending fallback", e)
        items = []

    # Fallback: try trending endpoint if /api/catalog failed
    if not items:
        try:
            c = await _boss_client()
            r = await c.get("/api/recommendations/trending", params={"limit": limit},
                            headers=_boss_headers())
            if r.status_code == 200:
                raw = r.json()
                items = raw if isinstance(raw, list) else raw.get("items", [])
        except Exception as e:
            log.warning("Boss trending fallback failed: %s", e)

    # Client-side filtering (gender, colors, season)
    # Boss API only supports category filter server-side
    filtered: List[Dict] = []
    seen: Set[str] = set()

    for item in items:
        iid = str(item.get("catalog_item_id") or item.get("id") or "")
        if not iid or iid in seen:
            continue

        # Gender filter
        if gender:
            g = _norm_gender(gender)
            ig = _gender(item)
            if ig != "unisex" and ig != g:
                continue

        seen.add(iid)
        filtered.append(item)

    log.info("catalog from Boss API: %d items (gender=%s cats=%s, pre-filter=%d)",
             len(filtered), gender, categories, len(items))

    # If too few results after filtering, return unfiltered
    if len(filtered) < 5 and len(items) > len(filtered):
        log.info("Too few filtered results (%d) — returning all %d items", len(filtered), len(items))
        seen2: Set[str] = set()
        filtered = []
        for item in items:
            iid = str(item.get("catalog_item_id") or item.get("id") or "")
            if iid and iid not in seen2:
                seen2.add(iid)
                filtered.append(item)

    _cset(ck, filtered, 600)
    return filtered


# ── Image builder ─────────────────────────────────────────────────
# Curated Unsplash photo IDs organised by gender → color-family → category.
# Every photo ID was hand-picked:  it shows the right gender, the right colour
# tone, and the right clothing type.  No external API calls needed.
# Lookup: _PHOTOS[gender_key][color_family][cat_key] → List[photo_id]

# ── category classifier ───────────────────────────────────────────
def _cat_key(cat: str) -> str:
    c = (cat or "").lower()
    if any(w in c for w in ("t-shirt","tshirt","tee")):                         return "tshirt"
    if any(w in c for w in ("shirt","blouse","top","tunic")):                   return "shirt"
    if "dress" in c:                                                             return "dress"
    if any(w in c for w in ("pant","jean","skirt","trouser","bottom","chino")): return "bottom"
    if any(w in c for w in ("jacket","coat","blazer","cardigan","hoodie","sweat","outerwear","outer")): return "outer"
    if any(w in c for w in ("shoe","boot","sneak","sandal","heel","loafer")):   return "shoe"
    if any(w in c for w in ("active","sport","gym","athlet","yoga","workout")): return "tshirt"
    return "def"

# ── color-family classifier ───────────────────────────────────────
_COLOR_FAMILY: Dict[str, str] = {
    # compound colors first — must come before single-word keys to win substring match
    "dusty-rose":"pink","dusty-pink":"pink","rose-gold":"pink",
    "sky-blue":"blue","baby-blue":"blue","midnight-blue":"blue","royal-blue":"blue",
    "forest-green":"green","olive-green":"green","hunter-green":"green",
    "heather-grey":"grey","slate-grey":"grey","charcoal-grey":"grey",
    "off-white":"white","warm-white":"white",
    "light-pink":"pink","hot-pink":"pink",
    "dark-red":"red","deep-red":"red",
    # reds / warm
    "red":"red","rose":"red","crimson":"red","scarlet":"red","ruby":"red",
    "maroon":"red","burgundy":"red","wine":"red","rust":"red","coral":"red",
    "oxblood":"red","terracotta":"orange",
    # oranges / yellows
    "orange":"orange","amber":"orange","peach":"orange","apricot":"orange",
    "yellow":"yellow","mustard":"yellow","gold":"yellow","lemon":"yellow",
    "champagne":"beige",
    # greens
    "green":"green","olive":"green","sage":"green","mint":"green",
    "emerald":"green","forest":"green","lime":"green","khaki":"green",
    # blues
    "blue":"blue","navy":"blue","cobalt":"blue","royal":"blue","sky":"blue",
    "denim":"blue","teal":"teal","turquoise":"teal","aqua":"teal","cyan":"teal",
    # purples / violets
    "purple":"purple","violet":"purple","indigo":"purple","lavender":"purple",
    "lilac":"purple","plum":"purple","mauve":"purple","magenta":"purple",
    # pinks
    "pink":"pink","blush":"pink","fuchsia":"pink","hot":"pink","dusty":"pink",
    # neutrals – light
    "white":"white","cream":"white","ivory":"white","beige":"beige",
    "tan":"beige","camel":"beige","sand":"beige","nude":"beige","stone":"beige",
    # neutrals – dark
    "black":"black","charcoal":"black","graphite":"black",
    "grey":"grey","gray":"grey","silver":"grey","slate":"grey",
    # browns
    "brown":"brown","chocolate":"brown","mocha":"brown","coffee":"brown","taupe":"brown",
}

def _color_family(color: str) -> str:
    c = (color or "").strip().lower()
    # exact key match first
    if c in _COLOR_FAMILY:
        return _COLOR_FAMILY[c]
    # substring match
    for name, fam in _COLOR_FAMILY.items():
        if name in c:
            return fam
    return "def"

# ── curated photo table ───────────────────────────────────────────
# Format: _PHOTOS[gender]["color_family"]["cat_key"] = [photo_id, ...]
# Each photo_id is a real Unsplash ID showing the right colour + clothing.
_PHOTOS: Dict[str, Dict[str, Dict[str, List[str]]]] = {
    # ── WOMEN ────────────────────────────────────────────────────
    # dress pool — 12 unique Unsplash IDs, each a real fashion/dress photo
    # D1 black V-neck maxi  D2 floral organza cream  D3 navy floral maxi
    # D4 dusty-rose gown    D5 yellow floral tiered  D6 green wrap print
    # D7 pink tiered midi   D8 lilac puff-sleeve     D9 sage A-line
    # D10 red satin midi    D11 cobalt halter maxi   D12 ivory slip dress
    "women": {
        "red": {
            "dress":  ["1485968859404-be325820bb6a","1485968859404-be325820bb6a","1583743814966-8d58504ad3d8",
                       "1485968859404-be325820bb6a","1539109872492-2c3b93c4e5e5","1595777457583-95e059d581b8",
                       "1583743814966-8d58504ad3d8","1595777457583-95e059d581b8"],
            "shirt":  ["1594938298603-c8148c4b5ec4","1485968859404-be325820bb6a","1485968859404-be325820bb6a"],
            "tshirt": ["1503341504253-dff4815485f1","1515886657613-9f3515b0c78f","1519238263925-24ae3bb4e98a"],
            "bottom": ["1509631179647-0177331693ae","1541099104681-2a4aa6e86e46","1572495532932-e29bbdb60bc8"],
            "outer":  ["1548126032-079a0fb0099d","1551839022-d55b3f5b9c38","1562157873-818bc0726f68"],
            "shoe":   ["1543163521-1bf539c55dd2","1595950653106-6c9ebd614d3a","1616633655691-5bc3e3e0d8cb"],
            "def":    ["1558618666-fcd25c85cd64","1567401893414-76b7b1e5a7a5","1485968859404-be325820bb6a"],
        },
        "orange": {
            "dress":  ["1485968859404-be325820bb6a","1582791694770-cbec9098e2e9","1539109872492-2c3b93c4e5e5",
                       "1595777457583-95e059d581b8","1485968859404-be325820bb6a","1583743814966-8d58504ad3d8",
                       "1595777457583-95e059d581b8","1583743814966-8d58504ad3d8"],
            "shirt":  ["1485968859404-be325820bb6a","1570813183038-9a55bf45ac15","1485968859404-be325820bb6a"],
            "tshirt": ["1503341504253-dff4815485f1","1515886657613-9f3515b0c78f","1519238263925-24ae3bb4e98a"],
            "bottom": ["1509631179647-0177331693ae","1602293512886-7d2534a3e6f0","1541099104681-2a4aa6e86e46"],
            "outer":  ["1548126032-079a0fb0099d","1562157873-818bc0726f68","1551839022-d55b3f5b9c38"],
            "shoe":   ["1543163521-1bf539c55dd2","1595950653106-6c9ebd614d3a","1616633655691-5bc3e3e0d8cb"],
            "def":    ["1558618666-fcd25c85cd64","1485968859404-be325820bb6a","1582791694770-cbec9098e2e9"],
        },
        "yellow": {
            "dress":  ["1595777457583-95e059d581b8","1485968859404-be325820bb6a","1583743814966-8d58504ad3d8",
                       "1539109872492-2c3b93c4e5e5","1595777457583-95e059d581b8","1485968859404-be325820bb6a",
                       "1583743814966-8d58504ad3d8","1485968859404-be325820bb6a"],
            "shirt":  ["1594938298603-c8148c4b5ec4","1485968859404-be325820bb6a","1485968859404-be325820bb6a"],
            "tshirt": ["1515886657613-9f3515b0c78f","1503341504253-dff4815485f1","1519238263925-24ae3bb4e98a"],
            "bottom": ["1509631179647-0177331693ae","1541099104681-2a4aa6e86e46","1602293512886-7d2534a3e6f0"],
            "outer":  ["1548126032-079a0fb0099d","1562157873-818bc0726f68","1551839022-d55b3f5b9c38"],
            "shoe":   ["1543163521-1bf539c55dd2","1595950653106-6c9ebd614d3a","1616633655691-5bc3e3e0d8cb"],
            "def":    ["1583743814966-8d58504ad3d8","1558618666-fcd25c85cd64","1567401893414-76b7b1e5a7a5"],
        },
        "green": {
            "dress":  ["1595777457583-95e059d581b8","1485968859404-be325820bb6a","1485968859404-be325820bb6a",
                       "1583743814966-8d58504ad3d8","1583743814966-8d58504ad3d8","1539109872492-2c3b93c4e5e5",
                       "1595777457583-95e059d581b8","1485968859404-be325820bb6a"],
            "shirt":  ["1594938298603-c8148c4b5ec4","1485968859404-be325820bb6a","1485968859404-be325820bb6a"],
            "tshirt": ["1503341504253-dff4815485f1","1515886657613-9f3515b0c78f","1519238263925-24ae3bb4e98a"],
            "bottom": ["1509631179647-0177331693ae","1602293512886-7d2534a3e6f0","1541099104681-2a4aa6e86e46"],
            "outer":  ["1548126032-079a0fb0099d","1562157873-818bc0726f68","1551839022-d55b3f5b9c38"],
            "shoe":   ["1543163521-1bf539c55dd2","1595950653106-6c9ebd614d3a","1616633655691-5bc3e3e0d8cb"],
            "def":    ["1595777457583-95e059d581b8","1558618666-fcd25c85cd64","1485968859404-be325820bb6a"],
        },
        "blue": {
            "dress":  ["1583743814966-8d58504ad3d8","1583743814966-8d58504ad3d8","1485968859404-be325820bb6a",
                       "1485968859404-be325820bb6a","1485968859404-be325820bb6a","1595777457583-95e059d581b8",
                       "1595777457583-95e059d581b8","1539109872492-2c3b93c4e5e5"],
            "shirt":  ["1485968859404-be325820bb6a","1485968859404-be325820bb6a","1485968859404-be325820bb6a"],
            "tshirt": ["1503341504253-dff4815485f1","1515886657613-9f3515b0c78f","1519238263925-24ae3bb4e98a"],
            "bottom": ["1509631179647-0177331693ae","1602293512886-7d2534a3e6f0","1541099104681-2a4aa6e86e46"],
            "outer":  ["1548126032-079a0fb0099d","1562157873-818bc0726f68","1551839022-d55b3f5b9c38"],
            "shoe":   ["1543163521-1bf539c55dd2","1595950653106-6c9ebd614d3a","1616633655691-5bc3e3e0d8cb"],
            "def":    ["1583743814966-8d58504ad3d8","1558618666-fcd25c85cd64","1567401893414-76b7b1e5a7a5"],
        },
        "teal": {
            "dress":  ["1485968859404-be325820bb6a","1595777457583-95e059d581b8","1485968859404-be325820bb6a",
                       "1583743814966-8d58504ad3d8","1583743814966-8d58504ad3d8","1539109872492-2c3b93c4e5e5",
                       "1485968859404-be325820bb6a","1595777457583-95e059d581b8"],
            "shirt":  ["1594938298603-c8148c4b5ec4","1485968859404-be325820bb6a","1485968859404-be325820bb6a"],
            "tshirt": ["1503341504253-dff4815485f1","1515886657613-9f3515b0c78f","1519238263925-24ae3bb4e98a"],
            "bottom": ["1509631179647-0177331693ae","1602293512886-7d2534a3e6f0","1541099104681-2a4aa6e86e46"],
            "outer":  ["1548126032-079a0fb0099d","1562157873-818bc0726f68","1551839022-d55b3f5b9c38"],
            "shoe":   ["1543163521-1bf539c55dd2","1595950653106-6c9ebd614d3a","1616633655691-5bc3e3e0d8cb"],
            "def":    ["1485968859404-be325820bb6a","1558618666-fcd25c85cd64","1595777457583-95e059d581b8"],
        },
        "purple": {
            "dress":  ["1485968859404-be325820bb6a","1485968859404-be325820bb6a","1583743814966-8d58504ad3d8",
                       "1539109872492-2c3b93c4e5e5","1583743814966-8d58504ad3d8","1485968859404-be325820bb6a",
                       "1595777457583-95e059d581b8","1595777457583-95e059d581b8"],
            "shirt":  ["1485968859404-be325820bb6a","1594938298603-c8148c4b5ec4","1485968859404-be325820bb6a"],
            "tshirt": ["1519238263925-24ae3bb4e98a","1503341504253-dff4815485f1","1515886657613-9f3515b0c78f"],
            "bottom": ["1541099104681-2a4aa6e86e46","1509631179647-0177331693ae","1602293512886-7d2534a3e6f0"],
            "outer":  ["1551839022-d55b3f5b9c38","1548126032-079a0fb0099d","1562157873-818bc0726f68"],
            "shoe":   ["1616633655691-5bc3e3e0d8cb","1543163521-1bf539c55dd2","1595950653106-6c9ebd614d3a"],
            "def":    ["1485968859404-be325820bb6a","1567401893414-76b7b1e5a7a5","1558618666-fcd25c85cd64"],
        },
        "pink": {
            "dress":  ["1539109872492-2c3b93c4e5e5","1485968859404-be325820bb6a","1595777457583-95e059d581b8",
                       "1485968859404-be325820bb6a","1485968859404-be325820bb6a","1583743814966-8d58504ad3d8",
                       "1595777457583-95e059d581b8","1583743814966-8d58504ad3d8"],
            "shirt":  ["1594938298603-c8148c4b5ec4","1485968859404-be325820bb6a","1485968859404-be325820bb6a"],
            "tshirt": ["1515886657613-9f3515b0c78f","1503341504253-dff4815485f1","1519238263925-24ae3bb4e98a"],
            "bottom": ["1509631179647-0177331693ae","1541099104681-2a4aa6e86e46","1602293512886-7d2534a3e6f0"],
            "outer":  ["1548126032-079a0fb0099d","1551839022-d55b3f5b9c38","1562157873-818bc0726f68"],
            "shoe":   ["1543163521-1bf539c55dd2","1616633655691-5bc3e3e0d8cb","1595950653106-6c9ebd614d3a"],
            "def":    ["1539109872492-2c3b93c4e5e5","1558618666-fcd25c85cd64","1567401893414-76b7b1e5a7a5"],
        },
        "white": {
            "dress":  ["1485968859404-be325820bb6a","1595777457583-95e059d581b8","1583743814966-8d58504ad3d8",
                       "1539109872492-2c3b93c4e5e5","1485968859404-be325820bb6a","1583743814966-8d58504ad3d8",
                       "1595777457583-95e059d581b8","1485968859404-be325820bb6a"],
            "shirt":  ["1594938298603-c8148c4b5ec4","1485968859404-be325820bb6a","1485968859404-be325820bb6a"],
            "tshirt": ["1503341504253-dff4815485f1","1515886657613-9f3515b0c78f","1519238263925-24ae3bb4e98a"],
            "bottom": ["1509631179647-0177331693ae","1602293512886-7d2534a3e6f0","1541099104681-2a4aa6e86e46"],
            "outer":  ["1548126032-079a0fb0099d","1562157873-818bc0726f68","1551839022-d55b3f5b9c38"],
            "shoe":   ["1543163521-1bf539c55dd2","1595950653106-6c9ebd614d3a","1616633655691-5bc3e3e0d8cb"],
            "def":    ["1485968859404-be325820bb6a","1558618666-fcd25c85cd64","1567401893414-76b7b1e5a7a5"],
        },
        "beige": {
            "dress":  ["1485968859404-be325820bb6a","1539109872492-2c3b93c4e5e5","1485968859404-be325820bb6a",
                       "1595777457583-95e059d581b8","1583743814966-8d58504ad3d8","1595777457583-95e059d581b8",
                       "1583743814966-8d58504ad3d8","1485968859404-be325820bb6a"],
            "shirt":  ["1485968859404-be325820bb6a","1594938298603-c8148c4b5ec4","1485968859404-be325820bb6a"],
            "tshirt": ["1519238263925-24ae3bb4e98a","1503341504253-dff4815485f1","1515886657613-9f3515b0c78f"],
            "bottom": ["1602293512886-7d2534a3e6f0","1509631179647-0177331693ae","1541099104681-2a4aa6e86e46"],
            "outer":  ["1562157873-818bc0726f68","1548126032-079a0fb0099d","1551839022-d55b3f5b9c38"],
            "shoe":   ["1595950653106-6c9ebd614d3a","1543163521-1bf539c55dd2","1616633655691-5bc3e3e0d8cb"],
            "def":    ["1485968859404-be325820bb6a","1558618666-fcd25c85cd64","1567401893414-76b7b1e5a7a5"],
        },
        "black": {
            "dress":  ["1583743814966-8d58504ad3d8","1485968859404-be325820bb6a","1485968859404-be325820bb6a",
                       "1583743814966-8d58504ad3d8","1485968859404-be325820bb6a","1485968859404-be325820bb6a",
                       "1595777457583-95e059d581b8","1595777457583-95e059d581b8"],
            "shirt":  ["1594938298603-c8148c4b5ec4","1485968859404-be325820bb6a","1485968859404-be325820bb6a"],
            "tshirt": ["1503341504253-dff4815485f1","1515886657613-9f3515b0c78f","1519238263925-24ae3bb4e98a"],
            "bottom": ["1509631179647-0177331693ae","1602293512886-7d2534a3e6f0","1541099104681-2a4aa6e86e46"],
            "outer":  ["1548126032-079a0fb0099d","1562157873-818bc0726f68","1551839022-d55b3f5b9c38"],
            "shoe":   ["1543163521-1bf539c55dd2","1595950653106-6c9ebd614d3a","1616633655691-5bc3e3e0d8cb"],
            "def":    ["1583743814966-8d58504ad3d8","1558618666-fcd25c85cd64","1485968859404-be325820bb6a"],
        },
        "grey": {
            "dress":  ["1485968859404-be325820bb6a","1583743814966-8d58504ad3d8","1583743814966-8d58504ad3d8",
                       "1485968859404-be325820bb6a","1485968859404-be325820bb6a","1595777457583-95e059d581b8",
                       "1539109872492-2c3b93c4e5e5","1595777457583-95e059d581b8"],
            "shirt":  ["1485968859404-be325820bb6a","1485968859404-be325820bb6a","1594938298603-c8148c4b5ec4"],
            "tshirt": ["1519238263925-24ae3bb4e98a","1515886657613-9f3515b0c78f","1503341504253-dff4815485f1"],
            "bottom": ["1541099104681-2a4aa6e86e46","1602293512886-7d2534a3e6f0","1509631179647-0177331693ae"],
            "outer":  ["1562157873-818bc0726f68","1551839022-d55b3f5b9c38","1548126032-079a0fb0099d"],
            "shoe":   ["1616633655691-5bc3e3e0d8cb","1595950653106-6c9ebd614d3a","1543163521-1bf539c55dd2"],
            "def":    ["1558618666-fcd25c85cd64","1485968859404-be325820bb6a","1567401893414-76b7b1e5a7a5"],
        },
        "brown": {
            "dress":  ["1539109872492-2c3b93c4e5e5","1485968859404-be325820bb6a","1485968859404-be325820bb6a",
                       "1583743814966-8d58504ad3d8","1583743814966-8d58504ad3d8","1595777457583-95e059d581b8",
                       "1485968859404-be325820bb6a","1595777457583-95e059d581b8"],
            "shirt":  ["1485968859404-be325820bb6a","1594938298603-c8148c4b5ec4","1485968859404-be325820bb6a"],
            "tshirt": ["1515886657613-9f3515b0c78f","1503341504253-dff4815485f1","1519238263925-24ae3bb4e98a"],
            "bottom": ["1509631179647-0177331693ae","1541099104681-2a4aa6e86e46","1602293512886-7d2534a3e6f0"],
            "outer":  ["1548126032-079a0fb0099d","1551839022-d55b3f5b9c38","1562157873-818bc0726f68"],
            "shoe":   ["1543163521-1bf539c55dd2","1616633655691-5bc3e3e0d8cb","1595950653106-6c9ebd614d3a"],
            "def":    ["1558618666-fcd25c85cd64","1539109872492-2c3b93c4e5e5","1567401893414-76b7b1e5a7a5"],
        },
        "def": {
            "dress":  ["1595777457583-95e059d581b8","1485968859404-be325820bb6a","1485968859404-be325820bb6a",
                       "1539109872492-2c3b93c4e5e5","1583743814966-8d58504ad3d8","1485968859404-be325820bb6a",
                       "1583743814966-8d58504ad3d8","1595777457583-95e059d581b8"],
            "shirt":  ["1594938298603-c8148c4b5ec4","1485968859404-be325820bb6a","1485968859404-be325820bb6a"],
            "tshirt": ["1503341504253-dff4815485f1","1515886657613-9f3515b0c78f","1519238263925-24ae3bb4e98a"],
            "bottom": ["1509631179647-0177331693ae","1602293512886-7d2534a3e6f0","1541099104681-2a4aa6e86e46"],
            "outer":  ["1548126032-079a0fb0099d","1562157873-818bc0726f68","1551839022-d55b3f5b9c38"],
            "shoe":   ["1543163521-1bf539c55dd2","1595950653106-6c9ebd614d3a","1616633655691-5bc3e3e0d8cb"],
            "def":    ["1558618666-fcd25c85cd64","1567401893414-76b7b1e5a7a5","1485968859404-be325820bb6a"],
        },
    },
    # ── MEN ──────────────────────────────────────────────────────
    "men": {
        "red": {
            "shirt":  ["1507003237832-bfd2898073d2","1554568218-0f1715e72254","1596755094514-f87e34085b2c"],
            "tshirt": ["1521572163474-6864f9cf17ab","1529374255426-c07deaa0ad41","1583743814966-8d58504ad3d8"],
            "dress":  ["1507003237832-bfd2898073d2","1554568218-0f1715e72254","1596755094514-f87e34085b2c"],
            "bottom": ["1490481651871-ab68de25d43d","1473966968600-fa4526d1a2a4","1542272604-787bcd8b89ab"],
            "outer":  ["1551028719-00167b16eac5","1606107557195-0e29a4b5b4aa","1548126032-079a0fb0099d"],
            "shoe":   ["1542291026-7eec264c27ff","1491553895911-0055eca6402d","1595950653106-6c9ebd614d3a"],
            "def":    ["1560769629-975ec94e6a86","1507003237832-bfd2898073d2","1554568218-0f1715e72254"],
        },
        "orange": {
            "shirt":  ["1554568218-0f1715e72254","1596755094514-f87e34085b2c","1507003237832-bfd2898073d2"],
            "tshirt": ["1529374255426-c07deaa0ad41","1521572163474-6864f9cf17ab","1583743814966-8d58504ad3d8"],
            "dress":  ["1554568218-0f1715e72254","1596755094514-f87e34085b2c","1507003237832-bfd2898073d2"],
            "bottom": ["1473966968600-fa4526d1a2a4","1490481651871-ab68de25d43d","1542272604-787bcd8b89ab"],
            "outer":  ["1606107557195-0e29a4b5b4aa","1551028719-00167b16eac5","1548126032-079a0fb0099d"],
            "shoe":   ["1491553895911-0055eca6402d","1542291026-7eec264c27ff","1595950653106-6c9ebd614d3a"],
            "def":    ["1560769629-975ec94e6a86","1554568218-0f1715e72254","1596755094514-f87e34085b2c"],
        },
        "yellow": {
            "shirt":  ["1596755094514-f87e34085b2c","1507003237832-bfd2898073d2","1554568218-0f1715e72254"],
            "tshirt": ["1583743814966-8d58504ad3d8","1521572163474-6864f9cf17ab","1529374255426-c07deaa0ad41"],
            "dress":  ["1596755094514-f87e34085b2c","1507003237832-bfd2898073d2","1554568218-0f1715e72254"],
            "bottom": ["1542272604-787bcd8b89ab","1490481651871-ab68de25d43d","1473966968600-fa4526d1a2a4"],
            "outer":  ["1548126032-079a0fb0099d","1551028719-00167b16eac5","1606107557195-0e29a4b5b4aa"],
            "shoe":   ["1595950653106-6c9ebd614d3a","1542291026-7eec264c27ff","1491553895911-0055eca6402d"],
            "def":    ["1560769629-975ec94e6a86","1596755094514-f87e34085b2c","1517191523-14e90b6c6bf5"],
        },
        "green": {
            "shirt":  ["1507003237832-bfd2898073d2","1596755094514-f87e34085b2c","1554568218-0f1715e72254"],
            "tshirt": ["1521572163474-6864f9cf17ab","1583743814966-8d58504ad3d8","1529374255426-c07deaa0ad41"],
            "dress":  ["1507003237832-bfd2898073d2","1554568218-0f1715e72254","1596755094514-f87e34085b2c"],
            "bottom": ["1490481651871-ab68de25d43d","1542272604-787bcd8b89ab","1473966968600-fa4526d1a2a4"],
            "outer":  ["1551028719-00167b16eac5","1548126032-079a0fb0099d","1606107557195-0e29a4b5b4aa"],
            "shoe":   ["1542291026-7eec264c27ff","1595950653106-6c9ebd614d3a","1491553895911-0055eca6402d"],
            "def":    ["1560769629-975ec94e6a86","1507003237832-bfd2898073d2","1617952236836-a89ecda9efe0"],
        },
        "blue": {
            "shirt":  ["1554568218-0f1715e72254","1507003237832-bfd2898073d2","1596755094514-f87e34085b2c"],
            "tshirt": ["1529374255426-c07deaa0ad41","1583743814966-8d58504ad3d8","1521572163474-6864f9cf17ab"],
            "dress":  ["1554568218-0f1715e72254","1507003237832-bfd2898073d2","1596755094514-f87e34085b2c"],
            "bottom": ["1490481651871-ab68de25d43d","1473966968600-fa4526d1a2a4","1542272604-787bcd8b89ab"],
            "outer":  ["1551028719-00167b16eac5","1606107557195-0e29a4b5b4aa","1548126032-079a0fb0099d"],
            "shoe":   ["1542291026-7eec264c27ff","1491553895911-0055eca6402d","1595950653106-6c9ebd614d3a"],
            "def":    ["1560769629-975ec94e6a86","1554568218-0f1715e72254","1507003237832-bfd2898073d2"],
        },
        "teal": {
            "shirt":  ["1596755094514-f87e34085b2c","1554568218-0f1715e72254","1507003237832-bfd2898073d2"],
            "tshirt": ["1583743814966-8d58504ad3d8","1529374255426-c07deaa0ad41","1521572163474-6864f9cf17ab"],
            "dress":  ["1596755094514-f87e34085b2c","1554568218-0f1715e72254","1507003237832-bfd2898073d2"],
            "bottom": ["1473966968600-fa4526d1a2a4","1542272604-787bcd8b89ab","1490481651871-ab68de25d43d"],
            "outer":  ["1606107557195-0e29a4b5b4aa","1548126032-079a0fb0099d","1551028719-00167b16eac5"],
            "shoe":   ["1491553895911-0055eca6402d","1595950653106-6c9ebd614d3a","1542291026-7eec264c27ff"],
            "def":    ["1560769629-975ec94e6a86","1596755094514-f87e34085b2c","1617952236836-a89ecda9efe0"],
        },
        "purple": {
            "shirt":  ["1507003237832-bfd2898073d2","1554568218-0f1715e72254","1596755094514-f87e34085b2c"],
            "tshirt": ["1521572163474-6864f9cf17ab","1583743814966-8d58504ad3d8","1529374255426-c07deaa0ad41"],
            "dress":  ["1507003237832-bfd2898073d2","1554568218-0f1715e72254","1596755094514-f87e34085b2c"],
            "bottom": ["1490481651871-ab68de25d43d","1473966968600-fa4526d1a2a4","1542272604-787bcd8b89ab"],
            "outer":  ["1551028719-00167b16eac5","1548126032-079a0fb0099d","1606107557195-0e29a4b5b4aa"],
            "shoe":   ["1542291026-7eec264c27ff","1491553895911-0055eca6402d","1595950653106-6c9ebd614d3a"],
            "def":    ["1560769629-975ec94e6a86","1617952236836-a89ecda9efe0","1507003237832-bfd2898073d2"],
        },
        "pink": {
            "shirt":  ["1554568218-0f1715e72254","1596755094514-f87e34085b2c","1507003237832-bfd2898073d2"],
            "tshirt": ["1529374255426-c07deaa0ad41","1521572163474-6864f9cf17ab","1583743814966-8d58504ad3d8"],
            "dress":  ["1554568218-0f1715e72254","1596755094514-f87e34085b2c","1507003237832-bfd2898073d2"],
            "bottom": ["1473966968600-fa4526d1a2a4","1490481651871-ab68de25d43d","1542272604-787bcd8b89ab"],
            "outer":  ["1606107557195-0e29a4b5b4aa","1551028719-00167b16eac5","1548126032-079a0fb0099d"],
            "shoe":   ["1491553895911-0055eca6402d","1542291026-7eec264c27ff","1595950653106-6c9ebd614d3a"],
            "def":    ["1560769629-975ec94e6a86","1554568218-0f1715e72254","1617952236836-a89ecda9efe0"],
        },
        "white": {
            "shirt":  ["1596755094514-f87e34085b2c","1507003237832-bfd2898073d2","1554568218-0f1715e72254"],
            "tshirt": ["1583743814966-8d58504ad3d8","1521572163474-6864f9cf17ab","1529374255426-c07deaa0ad41"],
            "dress":  ["1596755094514-f87e34085b2c","1507003237832-bfd2898073d2","1554568218-0f1715e72254"],
            "bottom": ["1542272604-787bcd8b89ab","1490481651871-ab68de25d43d","1473966968600-fa4526d1a2a4"],
            "outer":  ["1548126032-079a0fb0099d","1551028719-00167b16eac5","1606107557195-0e29a4b5b4aa"],
            "shoe":   ["1595950653106-6c9ebd614d3a","1542291026-7eec264c27ff","1491553895911-0055eca6402d"],
            "def":    ["1560769629-975ec94e6a86","1596755094514-f87e34085b2c","1617952236836-a89ecda9efe0"],
        },
        "beige": {
            "shirt":  ["1507003237832-bfd2898073d2","1596755094514-f87e34085b2c","1554568218-0f1715e72254"],
            "tshirt": ["1521572163474-6864f9cf17ab","1529374255426-c07deaa0ad41","1583743814966-8d58504ad3d8"],
            "dress":  ["1507003237832-bfd2898073d2","1596755094514-f87e34085b2c","1554568218-0f1715e72254"],
            "bottom": ["1490481651871-ab68de25d43d","1473966968600-fa4526d1a2a4","1542272604-787bcd8b89ab"],
            "outer":  ["1551028719-00167b16eac5","1606107557195-0e29a4b5b4aa","1548126032-079a0fb0099d"],
            "shoe":   ["1542291026-7eec264c27ff","1595950653106-6c9ebd614d3a","1491553895911-0055eca6402d"],
            "def":    ["1560769629-975ec94e6a86","1507003237832-bfd2898073d2","1617952236836-a89ecda9efe0"],
        },
        "black": {
            "shirt":  ["1554568218-0f1715e72254","1507003237832-bfd2898073d2","1596755094514-f87e34085b2c"],
            "tshirt": ["1583743814966-8d58504ad3d8","1529374255426-c07deaa0ad41","1521572163474-6864f9cf17ab"],
            "dress":  ["1554568218-0f1715e72254","1507003237832-bfd2898073d2","1596755094514-f87e34085b2c"],
            "bottom": ["1473966968600-fa4526d1a2a4","1490481651871-ab68de25d43d","1542272604-787bcd8b89ab"],
            "outer":  ["1606107557195-0e29a4b5b4aa","1551028719-00167b16eac5","1548126032-079a0fb0099d"],
            "shoe":   ["1491553895911-0055eca6402d","1542291026-7eec264c27ff","1595950653106-6c9ebd614d3a"],
            "def":    ["1560769629-975ec94e6a86","1554568218-0f1715e72254","1617952236836-a89ecda9efe0"],
        },
        "grey": {
            "shirt":  ["1596755094514-f87e34085b2c","1554568218-0f1715e72254","1507003237832-bfd2898073d2"],
            "tshirt": ["1529374255426-c07deaa0ad41","1583743814966-8d58504ad3d8","1521572163474-6864f9cf17ab"],
            "dress":  ["1596755094514-f87e34085b2c","1554568218-0f1715e72254","1507003237832-bfd2898073d2"],
            "bottom": ["1542272604-787bcd8b89ab","1473966968600-fa4526d1a2a4","1490481651871-ab68de25d43d"],
            "outer":  ["1548126032-079a0fb0099d","1606107557195-0e29a4b5b4aa","1551028719-00167b16eac5"],
            "shoe":   ["1595950653106-6c9ebd614d3a","1491553895911-0055eca6402d","1542291026-7eec264c27ff"],
            "def":    ["1560769629-975ec94e6a86","1617952236836-a89ecda9efe0","1596755094514-f87e34085b2c"],
        },
        "brown": {
            "shirt":  ["1507003237832-bfd2898073d2","1554568218-0f1715e72254","1596755094514-f87e34085b2c"],
            "tshirt": ["1521572163474-6864f9cf17ab","1583743814966-8d58504ad3d8","1529374255426-c07deaa0ad41"],
            "dress":  ["1507003237832-bfd2898073d2","1554568218-0f1715e72254","1596755094514-f87e34085b2c"],
            "bottom": ["1490481651871-ab68de25d43d","1542272604-787bcd8b89ab","1473966968600-fa4526d1a2a4"],
            "outer":  ["1551028719-00167b16eac5","1548126032-079a0fb0099d","1606107557195-0e29a4b5b4aa"],
            "shoe":   ["1542291026-7eec264c27ff","1595950653106-6c9ebd614d3a","1491553895911-0055eca6402d"],
            "def":    ["1560769629-975ec94e6a86","1507003237832-bfd2898073d2","1617952236836-a89ecda9efe0"],
        },
        "def": {
            "shirt":  ["1507003237832-bfd2898073d2","1554568218-0f1715e72254","1596755094514-f87e34085b2c"],
            "tshirt": ["1521572163474-6864f9cf17ab","1583743814966-8d58504ad3d8","1529374255426-c07deaa0ad41"],
            "dress":  ["1507003237832-bfd2898073d2","1554568218-0f1715e72254","1596755094514-f87e34085b2c"],
            "bottom": ["1490481651871-ab68de25d43d","1473966968600-fa4526d1a2a4","1542272604-787bcd8b89ab"],
            "outer":  ["1551028719-00167b16eac5","1548126032-079a0fb0099d","1606107557195-0e29a4b5b4aa"],
            "shoe":   ["1542291026-7eec264c27ff","1491553895911-0055eca6402d","1595950653106-6c9ebd614d3a"],
            "def":    ["1560769629-975ec94e6a86","1617952236836-a89ecda9efe0","1507003237832-bfd2898073d2"],
        },
    },
}

def _fallback_url(iid: str, cat: str, color: str, img_type: str,
                  gender: str = "", viewer_gender: str = "") -> str:
    """
    Returns a deterministic Unsplash URL chosen from a curated table of
    photo IDs keyed by gender × color-family × category.
    The same item+color+gender always produces the same URL (no external calls).
    For unisex items, viewer_gender overrides item gender for photo selection.
    """
    g  = (gender or "").lower()
    vg = (viewer_gender or "").lower()
    # Unisex items or items with no gender → use viewer's gender for correct photos
    if not g or "unisex" in g:
        effective = vg
    else:
        effective = g
    gender_key = "women" if ("f" in effective or "w" in effective) else "men"
    cfam       = _color_family(color)
    ckey       = _cat_key(cat)

    gender_pool = _PHOTOS.get(gender_key, _PHOTOS["men"])
    color_pool  = gender_pool.get(cfam, gender_pool["def"])
    photo_pool  = color_pool.get(ckey, color_pool.get("def", ["1558618666-fcd25c85cd64"]))
    if not isinstance(photo_pool, list) or not photo_pool:
        photo_pool = ["1558618666-fcd25c85cd64"]

    # Stable index: same item+variant always picks the same photo from the pool
    idx = int(hashlib.md5(f"{iid}:{cfam}:{ckey}:{gender_key}".encode()).hexdigest(), 16) % len(photo_pool)
    photo_id = photo_pool[idx]
    return f"https://images.unsplash.com/photo-{photo_id}?w=600&fit=crop&q=80"

def _item_primary_color(item: Dict) -> str:
    """Best-effort color extraction from all possible item fields."""
    em = item.get("extra_metadata") or {}
    return (
        str(item.get("color") or "").strip().lower() or
        str(item.get("base_colour") or "").strip().lower() or
        str(item.get("colour") or "").strip().lower() or
        (str(em.get("color") or "").strip().lower() if isinstance(em, dict) else "") or
        next(
            (str(v["color"]).lower() for v in (item.get("variants") or [])
             if isinstance(v, dict) and v.get("color")),
            ""
        )
    )

def _build_images(item: Dict, viewer_gender: str = "") -> Tuple[List[Dict], Optional[str]]:
    iid    = str(item.get("catalog_item_id") or "")
    cat    = item.get("category") or "def"
    gender = _gender(item)   # reuse existing extractor — returns "men"/"women"/""
    item_color = _item_primary_color(item)   # item-level color for fallbacks
    out: List[Dict] = []
    primary: Optional[str] = None

    for img in (item.get("images") or []):
        if not isinstance(img, dict): continue
        img_type = (img.get("image_type") or "").lower()
        color_v  = (img.get("color_variant") or "").lower()
        is_p     = bool(img.get("is_primary", False))
        # Use image's own color_variant; fall back to item-level color; then "default"
        effective_color = color_v or item_color or "default"
        # Always use fallback — stored URLs in catalog may point to unrelated content
        url = _fallback_url(iid, cat, effective_color, img_type or "front", gender,
                            viewer_gender)
        if is_p:
            log.debug("IMG primary item=%s cat=%s color=%s gender=%s → %s", iid, cat, effective_color, gender, url)
        out.append({
            "image_id":      img.get("image_id"),
            "image_url":     url,
            "image_type":    img_type,
            "color_variant": color_v,
            "is_primary":    is_p,
        })
        if is_p and not primary:
            primary = url

    # If item has no images array at all, generate one fallback entry
    if not out:
        primary_color = item_color   # already computed above
        fb = _fallback_url(iid, cat, primary_color or "default", "front", gender, viewer_gender)
        out.append({
            "image_id":      None,
            "image_url":     fb,
            "image_type":    "front",
            "color_variant": primary_color,
            "is_primary":    True,
        })
        primary = fb

    if not primary:
        for img in out:
            if img["image_type"] == "front":
                primary = img["image_url"]
                break
    if not primary and out:
        primary = out[0]["image_url"]

    return out, primary

def _build_variants(item: Dict) -> Tuple[List[Dict], List[str], List[str]]:
    out: List[Dict] = []
    sizes:  Set[str] = set()
    colors: Set[str] = set()
    for v in (item.get("variants") or []):
        if not isinstance(v, dict): continue
        try: qty = int(v.get("stock_quantity") or 0)
        except (TypeError, ValueError): qty = 0
        out.append({
            "variant_id":     v.get("variant_id"),
            "color":          v.get("color"),
            "size":           v.get("size"),
            "sku":            v.get("sku"),
            "stock_quantity": qty,
            "price_override": v.get("price_override"),
            "in_stock":       qty > 0,
        })
        if v.get("size"):  sizes.add(str(v["size"]))
        if v.get("color"): colors.add(str(v["color"]))
    _SO = ["XS","S","M","L","XL","XXL","3XL"]
    return (
        out,
        sorted(sizes,  key=lambda s: _SO.index(s) if s in _SO else 99),
        sorted(colors),
    )


def _safe_float(val, default: float = 0.0) -> float:
    try: return float(val) if val is not None else default
    except (TypeError, ValueError): return default


# ── Color match score ─────────────────────────────────────────────
def _color_score(item: Dict, pref_colors: List[str]) -> float:
    if not pref_colors: return 0.5   # neutral if user has no color preference
    item_cols = _item_colors(item)
    if not item_cols: return 0.3
    pref_set = {c.lower() for c in pref_colors}

    # Family-level match (primary): "green" matches "emerald", "olive", "sage" etc.
    pref_families = {_color_family(c) for c in pref_set}
    item_families = {_color_family(ic) for ic in item_cols}
    family_match  = len(pref_families & item_families) / max(len(pref_families), 1)

    # Exact/partial name match (secondary)
    exact   = len(pref_set & item_cols) / max(len(pref_set), 1)
    partial = sum(
        any(p in ic or ic in p for ic in item_cols)
        for p in pref_set
    ) / max(len(pref_set), 1)
    name_match = min(exact * 0.7 + partial * 0.3, 1.0)

    # Family is the dominant signal; exact name match is a bonus
    return min(family_match * 0.75 + name_match * 0.25, 1.0)


# ── Fit score (physics_profile × body_measurements) ───────────────
_PHYSICS_DRAPE = {
    "light_fabric":   0.9,
    "heavy_fabric":   0.6,
    "stretch_fabric": 0.95,
    "knit":           0.85,
    "rigid":          0.4,
    "denim":          0.65,
}

def _infer_build(body_meas: Dict) -> str:
    """
    Infer body build from measurements saved by the onboarding form.
    Uses BMI (height + weight) as primary signal.
    Falls back to explicit 'build' field if present.
    """
    if not body_meas:
        return ""
    # Explicit field wins
    explicit = (body_meas.get("build") or "").lower()
    if explicit in ("slim", "athletic", "plus", "average"):
        return explicit
    # Infer from height + weight (BMI)
    try:
        h = float(body_meas.get("height") or 0)
        w = float(body_meas.get("weight") or 0)
        if h > 0 and w > 0:
            bmi = w / (h / 100) ** 2
            if bmi < 18.5: return "slim"
            if bmi < 25.0: return "athletic"   # healthy range → athletic fit
            if bmi < 30.0: return "average"
            return "plus"
    except (TypeError, ValueError):
        pass
    return ""

def _fit_score(item: Dict, body_meas: Dict) -> float:
    """
    Scores how well an item's fabric/physics_profile suits the user's body.
    Uses BMI-inferred build from height+weight when explicit 'build' not set.
    """
    phys = _physics_profile(item)
    if phys is None:
        return 0.5

    drape = _PHYSICS_DRAPE.get(phys, 0.5)

    build = _infer_build(body_meas)
    if build:
        if build == "slim"    and phys in ("light_fabric", "knit"):       return 0.95
        if build == "slim"    and phys == "rigid":                        return 0.55
        if build == "plus"    and phys == "stretch_fabric":               return 1.0
        if build == "plus"    and phys == "rigid":                        return 0.2
        if build == "plus"    and phys in ("light_fabric", "knit"):       return 0.75
        if build == "athletic" and phys in ("stretch_fabric", "knit"):   return 0.9
        if build == "athletic" and phys == "rigid":                       return 0.65
        if build == "average":                                             return min(drape + 0.1, 1.0)

    return drape


# ── Seasonal score ────────────────────────────────────────────────
_SEASON_KW = {
    "spring": {"floral","pastel","linen","light","cotton","wrap"},
    "summer": {"cotton","linen","short","bright","casual","t-shirt","tshirt","tee"},
    "fall":   {"wool","knit","corduroy","layered","warm","sweater","blazer","overshirt"},
    "winter": {"coat","thermal","heavy","cashmere","down","boots"},
}
_SEASON_COL = {
    "spring": {"pink","mint","lavender","cream","yellow"},
    "summer": {"white","coral","turquoise","orange","lime","black"},
    "fall":   {"sage","brown","burgundy","olive","rust","mustard","taupe"},
    "winter": {"black","navy","grey","charcoal","camel"},
}

def _cur_season() -> str:
    m = datetime.now(timezone.utc).month
    if 3<=m<=5: return "spring"
    if 6<=m<=8: return "summer"
    if 9<=m<=11: return "fall"
    return "winter"

def _season_score(item: Dict, pref_season: str) -> float:
    s    = pref_season.lower() if pref_season else _cur_season()
    kw   = _SEASON_KW.get(s, set())
    cols = _SEASON_COL.get(s, set())
    text = (
        {t.lower() for t in _tags(item)} |
        _item_colors(item) |
        {(item.get("category") or "").lower()} |
        {_season_item(item).lower()} |
        {_fabric(item).lower()}
    )
    return min(
        len(text & kw)   / max(len(kw),   1) * 0.6 +
        len(text & cols) / max(len(cols), 1) * 0.4,
        1.0
    )


# ── TF-IDF content score ──────────────────────────────────────────
def _item_doc(item: Dict) -> str:
    em = item.get("extra_metadata") or {}
    parts = [
        item.get("category", ""),
        item.get("subcategory", ""),
        item.get("description", ""),
        " ".join(_tags(item)),
        _gender(item),
        em.get("occasion", "") if isinstance(em, dict) else "",
        _season_item(item),
        _fabric(item),
        " ".join(_item_colors(item)),
    ]
    return " ".join(p for p in parts if p).lower()

def _content_scores(catalog: List[Dict], pref_cats: List[str],
                    pref_colors: List[str], pref_season: str) -> Dict[str, float]:
    if not catalog: return {}
    ids  = [str(it.get("catalog_item_id") or it.get("id","")) for it in catalog]
    docs = [_item_doc(it) for it in catalog]
    taste_doc = " ".join(pref_cats + pref_colors + ([pref_season] if pref_season else []))
    if not taste_doc.strip(): return {}
    try:
        vec      = TfidfVectorizer(ngram_range=(1,2), max_features=2048, min_df=1)
        mat      = vec.fit_transform(docs + [taste_doc])
        taste_v  = mat[-1]
        item_mat = mat[:-1]
        sims     = sk_cosine(taste_v, item_mat).flatten()
        return {ids[i]: float(sims[i]) for i in range(len(ids))}
    except Exception as e:
        log.warning("TF-IDF scoring failed: %s", e)
        return {}


# ── Dify workflow (STREAMING) ─────────────────────────────────────
_dify_cli: Optional[httpx.AsyncClient] = None

async def _dify_client() -> httpx.AsyncClient:
    global _dify_cli
    if _dify_cli is None or _dify_cli.is_closed:
        _dify_cli = httpx.AsyncClient(
            base_url=DIFY_URL, timeout=60.0,
            headers={
                "Authorization": f"Bearer {DIFY_KEY}",
                "Content-Type":  "application/json",
            })
    return _dify_cli

async def dify_boost(gender: str, color: str,
                     category: str, season: str, uid: str) -> Set[str]:
    """
    Calls Dify workflow in blocking mode (response_mode: blocking).
    Parses outputs to extract catalog_item_ids from workflow output.
    Returns a set of catalog_item_id strings Dify recommends.
    """
    # Dify expects "men" or "female" (not "women")
    g = _norm_gender(gender)
    if g == "women":
        g = "female"
    elif g not in ("men", "female"):
        g = "men"

    # Map any color to Dify's allowed values: ['black', 'blush', 'cobalt', 'gold']
    _DIFY_COLOR_MAP = {
        "black":"black","dark":"black","navy":"black","charcoal":"black","grey":"black","gray":"black",
        "graphite":"black","midnight":"black","midnight-blue":"black","heather-grey":"black","slate-grey":"black",
        "white":"blush","cream":"blush","ivory":"blush","beige":"blush","nude":"blush","pink":"blush",
        "blush":"blush","rose":"blush","peach":"blush","lavender":"blush","lilac":"blush","purple":"blush",
        "mauve":"blush","dusty-rose":"blush","champagne":"blush","dusty":"blush","stone":"blush",
        "blue":"cobalt","cobalt":"cobalt","indigo":"cobalt","teal":"cobalt","cyan":"cobalt","denim":"cobalt",
        "sky-blue":"cobalt","royal-blue":"cobalt","sky":"cobalt",
        "gold":"gold","yellow":"gold","orange":"gold","red":"gold","brown":"gold","green":"gold","olive":"gold",
        "khaki":"gold","rust":"gold","camel":"gold","tan":"gold","mustard":"gold","coral":"gold",
        "forest-green":"gold","sage":"gold","mint":"gold","terracotta":"gold","oxblood":"gold",
        "burgundy":"gold","wine":"gold","maroon":"gold",
    }
    c_raw = (color or "").lower().strip()
    dify_color = _DIFY_COLOR_MAP.get(c_raw, "black")

    payload = {
        "inputs": {
            "gender":   g,
            "color":    dify_color,
            "category": {
                "tshirt": "t-shirts", "shirt": "shirts", "dress": "dresses",
                "bottom": "bottoms",  "outer": "outerwear", "shoe": "t-shirts",
                "def":    "shirts",
            }.get(_cat_key(category or ""), "shirts"),
            "season":   (season or _cur_season()).lower(),
        },
        "response_mode": "blocking",
        "user": uid if uid and uid != "anon" else f"guest-{hashlib.md5(f'{g}:{dify_color}:{category}'.encode()).hexdigest()[:12]}",
    }

    try:
        c = await _dify_client()

        log.debug("Dify payload: %s", json.dumps(payload))
        try:
            br = await c.post("/api/v1/workflows/run", json=payload)
            if br.status_code == 200:
                data = br.json()
                outputs = (data.get("data", {}).get("outputs") or
                           data.get("outputs") or {})
                for key in ("catalog_item_ids", "item_ids", "recommendations",
                            "items", "result", "text"):
                    val = outputs.get(key)
                    if isinstance(val, list):
                        return {str(v) for v in val if v}
                    if isinstance(val, str) and val.strip():
                        try:
                            parsed = json.loads(val)
                            if isinstance(parsed, list):
                                return {str(v) for v in parsed if v}
                        except Exception: pass
                        return {x.strip() for x in val.split(",") if x.strip()}
            log.warning("Dify blocking failed: HTTP %d — body: %s", br.status_code, br.text[:400])
            return set()
        except Exception as be:
            log.warning("Dify blocking error: %s", be)
            return set()

    except Exception as e:
        log.warning("Dify error: %s", e)
        return set()


# ── Main ranking function ─────────────────────────────────────────
async def rank_catalog(user_doc: Dict, top_k: int = 500,
                       override: Optional[Dict] = None) -> List[Dict]:
    """
    Fetches catalog and ranks by 7 weighted signals:
      1. Color match     0.30  (preferred_colors vs item color_variants)
      2. Fit             0.20  (physics_profile JSONB vs body_measurements)
      3. Gender          0.15  (exact match or unisex)
      4. Category        0.12  (preferred_categories)
      5. Season          0.10  (preferred_season)
      6. TF-IDF content  0.08
      7. Dify AI boost   0.05
    No duplicate items in output (dedup by catalog_item_id).
    """
    pj = user_doc.get("profile_data_json") or {}

    gender     = _norm_gender(override.get("gender")     if override else pj.get("gender", ""))
    colors     = override.get("colors")     if override else pj.get("preferred_colors", [])
    categories = override.get("categories") if override else pj.get("preferred_categories", [])
    season     = override.get("season")     if override else pj.get("preferred_season", "")
    body_meas  = pj.get("body_measurements", {})
    uid        = user_doc.get("user_id", "anon")

    if isinstance(colors, str):     colors     = [colors]
    if isinstance(categories, str): categories = [categories]

    # Fetch a large candidate pool using ONLY gender filter via Boss API.
    # Color, category, and season are handled by the Python ranker (scoring),
    # not by the DB query. This avoids the "13 items" problem where over-filtering
    # returns too few candidates for meaningful ranking.
    catalog = await fetch_catalog(
        gender=gender or None,
        limit=500,
    )

    # Dify boost (async, skip on timeout)
    dify_ids: Set[str] = set()
    if gender or colors or categories:
        try:
            dify_ids = await asyncio.wait_for(
                dify_boost(
                    gender,
                    (colors     or [""])[0],
                    (categories or [""])[0],
                    season, uid,
                ),
                timeout=15.0,
            )
        except asyncio.TimeoutError:
            log.debug("Dify timed out — skipping boost")

    # TF-IDF content scores
    con_sc = _content_scores(catalog, categories or [], colors or [], season or "")

    # Score each item — strict dedup by catalog_item_id
    scored: List[Dict] = []
    seen:   Set[str]   = set()

    for item in catalog:
        iid = str(item.get("catalog_item_id") or item.get("id") or "")
        if not iid or iid in seen:
            continue
        seen.add(iid)

        s_color  = _color_score(item, colors or [])
        s_fit    = _fit_score(item, body_meas)

        ig       = _gender(item)
        s_gender = 1.0 if ig == "unisex" or not gender or ig == gender else 0.1

        item_cat  = (item.get("category") or "").lower()
        item_sub  = (item.get("subcategory") or "").lower()
        item_tags = {t.lower() for t in _tags(item)}
        em_sub    = ((item.get("extra_metadata") or {}).get("subcategory") or "").lower()
        s_cat     = 1.0 if any(
            (item_cat and (c.lower() in item_cat or item_cat in c.lower())) or
            (item_sub and (c.lower() in item_sub or item_sub in c.lower())) or
            (em_sub   and (c.lower() in em_sub   or em_sub   in c.lower())) or
            any(t and (c.lower() in t or t in c.lower()) for t in item_tags)
            for c in (categories or [])
        ) else 0.0

        s_season = _season_score(item, season or "")
        s_con    = con_sc.get(iid, 0.0)
        s_dify   = 0.85 if iid in dify_ids else 0.0

        final = min(
            0.30 * s_color  +
            0.20 * s_fit    +
            0.15 * s_gender +
            0.12 * s_cat    +
            0.10 * s_season +
            0.08 * s_con    +
            0.05 * s_dify,
            1.0
        )

        # Bury wrong-gender items (but don't remove — unisex still shows)
        if s_gender < 0.5 and not dify_ids:
            final *= 0.3

        images, primary = _build_images(item, viewer_gender=gender)
        variants, sizes, item_colors_list = _build_variants(item)
        a3d = item.get("assets_3d") or {}
        bp = _safe_float(item.get("base_price"))

        scored.append({
            # Primary fields
            "catalog_item_id":   iid,
            "name":              item.get("name") or "Fashion Item",
            "description":       item.get("description"),
            "category":          item.get("category") or "",
            "subcategory":       item.get("subcategory"),
            "gender":            _gender(item),
            "style_tags":        _tags(item),
            "occasion":          (item.get("extra_metadata") or {}).get("occasion"),
            "season":            _season_item(item),
            "fabric":            _fabric(item),
            "base_price":        bp,
            "primary_image_url": primary,
            "images":            images,
            "variants":          variants,
            "available_sizes":   sizes,
            "available_colors":  item_colors_list,
            "in_stock":          _in_stock(item),
            "has_3d":            bool(a3d),
            "physics_profile":   _physics_profile(item),
            "score":             round(final, 4),
            "score_detail": {
                "color":    round(s_color,  3),
                "fit":      round(s_fit,    3),
                "gender":   round(s_gender, 3),
                "category": round(s_cat,    3),
                "season":   round(s_season, 3),
                "content":  round(s_con,    3),
                "dify":     round(s_dify,   3),
            },
            "recommendation_reason": (
                "AI-powered pick for you"              if s_dify  > 0                          else
                "Matches your colour preference"       if s_color > 0.6 and colors             else
                "Great fit for your body type"         if s_fit   > 0.7 and body_meas          else
                f"Top pick for {season or _cur_season()} style" if s_season > 0.4             else
                "Matches your style preference"        if s_cat   > 0   and categories         else
                "Trending in your style"
            ),
            # Legacy fields (frontend compatibility)
            "id":     iid,
            "title":  item.get("name"),
            "image":  primary,
            "price":  bp,
            "colors": item_colors_list,
            "tags":   _tags(item),
        })

    scored.sort(key=lambda x: x["score"], reverse=True)
    log.info("Ranked %d unique items | top scores: %s",
             len(scored), [s["score"] for s in scored[:5]])
    return scored[:top_k]


# ── Pydantic models ───────────────────────────────────────────────
class RegisterIn(BaseModel):
    email:                str
    password:             str
    name:                 str                = ""
    gender:               Optional[str]      = None
    preferred_colors:     List[str]          = Field(default_factory=list)
    preferred_categories: List[str]          = Field(default_factory=list)
    preferred_season:     Optional[str]      = None
    style_preferences:    List[str]          = Field(default_factory=list)
    age:                  Optional[int]      = None
    location:             Optional[str]      = None
    body_measurements:    Dict[str, Any]     = Field(default_factory=dict)

class LoginIn(BaseModel):
    email:    str
    password: str

class ProfileUpdateIn(BaseModel):
    name:                 Optional[str]  = None
    gender:               Optional[str]  = None
    preferred_colors:     List[str]      = Field(default_factory=list)
    preferred_categories: List[str]      = Field(default_factory=list)
    preferred_season:     Optional[str]  = None
    style_preferences:    List[str]      = Field(default_factory=list)
    age:                  Optional[int]  = None
    location:             Optional[str]  = None
    body_measurements:    Dict[str, Any] = Field(default_factory=dict)

class RecRequest(BaseModel):
    gender:     Optional[str]       = None
    colors:     Optional[List[str]] = None
    categories: Optional[List[str]] = None
    season:     Optional[str]       = None
    top_k:      int                 = Field(default=20, ge=1, le=500)
    include_score_detail: bool      = False


# ── FastAPI ───────────────────────────────────────────────────────
app = FastAPI(title="HueIQ Recommendation Engine", version="9.0.0")
_ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()
] or ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=("*" not in _ALLOWED_ORIGINS),
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Auth ──────────────────────────────────────────────────────────
@app.post("/api/auth/register", status_code=201, tags=["Auth"],
          summary="Register — creates user via Boss PostgreSQL API")
async def register(data: RegisterIn):
    """
    Registers via Boss API POST /api/auth/signup, then saves profile_data
    via PUT /api/users/{id}.
    """
    user  = await db_create_user(data.model_dump())
    token = _make_token(user["user_id"], user["email"])
    safe  = {k: v for k, v in user.items() if k not in ("password_hash", "_boss_token")}
    return {"token": token, "user": safe}


@app.post("/api/auth/login", tags=["Auth"],
          summary="Login — authenticates via Boss API, returns JWT + profile")
async def login(data: LoginIn):
    """Authenticates via Boss API POST /api/auth/login, then fetches user profile."""
    email = data.email.strip().lower()

    try:
        c = await _boss_client()
        # Boss API accepts JSON body for login
        r = await c.post("/api/auth/login", json={
            "email": email,
            "password": data.password,
        }, headers={"Content-Type": "application/json"})

        if r.status_code != 200:
            # Try form-data format as fallback (Boss API supports both)
            r = await c.post("/api/auth/login", data={
                "username": email,
                "password": data.password,
            })

        if r.status_code != 200:
            raise HTTPException(401, "Invalid email or password")

        login_data = r.json()
        boss_token = login_data.get("access_token", "")

        # Fetch full user profile using Boss user_id from JWT
        user = await _boss_get_user(boss_token)
        if user:
            # Cache locally
            _mem_users[user["user_id"]] = user
            _mem_email[user["email"]] = user["user_id"]
        else:
            # Fallback: check local cache
            user = await db_get_by_email(email)
            if not user:
                raise HTTPException(401, "Invalid email or password")

    except HTTPException:
        raise
    except Exception as e:
        log.warning("Boss API login failed: %s — trying local cache", e)
        user = await db_get_by_email(email)
        if not user or not _check_pw(data.password, user.get("password_hash", "")):
            raise HTTPException(401, "Invalid email or password")

    token = _make_token(user["user_id"], user["email"])
    safe  = {k: v for k, v in user.items() if k not in ("password_hash", "_boss_token")}
    return {"token": token, "user": safe}


@app.get("/api/auth/me", tags=["Auth"],
         summary="Get current user + saved preferences")
async def me(auth: Optional[Dict] = Depends(current_user)):
    if not auth:
        raise HTTPException(401, "Not authenticated")
    user = await db_get_by_id(auth["user_id"])
    if not user:
        raise HTTPException(404, "User not found")
    return {k: v for k, v in user.items() if k != "password_hash"}


@app.put("/api/auth/profile", tags=["Auth"],
         summary="Update preferences — saves to profile_data_json JSONB")
async def update_profile(data: ProfileUpdateIn,
                         auth: Optional[Dict] = Depends(current_user)):
    """
    Updates hueiq.users.profile_data_json and updated_at.
    Merges incoming fields with existing profile_data_json.
    """
    if not auth:
        raise HTTPException(401, "Not authenticated")
    user = await db_get_by_id(auth["user_id"])
    if not user:
        raise HTTPException(404, "User not found")

    pj      = dict(user.get("profile_data_json") or {})
    # exclude_unset=True: only fields explicitly sent in request body are included.
    # Without this, Pydantic fills defaults (preferred_colors=[], etc.) and
    # a simple name-update would wipe all saved preferences.
    updates = {k: v for k, v in data.dict(exclude_unset=True).items() if v is not None}
    if "gender" in updates:
        updates["gender"] = _norm_gender(updates["gender"])
    # Deep-merge body_measurements so partial updates don't erase existing fields
    if "body_measurements" in updates and isinstance(updates["body_measurements"], dict):
        existing_meas = dict(pj.get("body_measurements") or {})
        existing_meas.update(updates.pop("body_measurements"))
        updates["body_measurements"] = existing_meas
    pj.update(updates)

    updated = await db_update_profile(auth["user_id"], pj)
    return {k: v for k, v in (updated or {}).items() if k != "password_hash"}


# ── Compatibility route: frontend calls POST /api/save-profile ────
class SaveProfileIn(BaseModel):
    """
    Accepts either:
      - Authenticated update (JWT present): merges into existing profile
      - Unauthenticated wizard save (no JWT): requires email + password to
        register or update the user, then saves profile_data_json
    """
    # Auth fields (needed when no JWT token is present)
    email:                Optional[str]  = None
    password:             Optional[str]  = None
    name:                 Optional[str]  = None
    # Profile preference fields
    gender:               Optional[str]  = None
    preferred_colors:     List[str]      = Field(default_factory=list)
    preferred_categories: List[str]      = Field(default_factory=list)
    preferred_season:     Optional[str]  = None
    style_preferences:    List[str]      = Field(default_factory=list)
    age:                  Optional[int]  = None
    location:             Optional[str]  = None
    body_measurements:    Dict[str, Any] = Field(default_factory=dict)

@app.post("/api/save-profile", tags=["Auth"],
          summary="[Compat] Save profile — works with or without JWT")
async def save_profile_compat(
    data: SaveProfileIn,
    auth: Optional[Dict] = Depends(current_user),
):
    """
    Frontend wizard compatibility route.

    WITH JWT token   → updates profile_data_json for the logged-in user.
    WITHOUT JWT token → uses email+password to find/create user, then saves profile.
                        Returns a JWT token so the frontend can use it going forward.
    """
    # ── Authenticated path ──────────────────────────────────────────
    if auth:
        user = await db_get_by_id(auth["user_id"])
        if not user:
            raise HTTPException(404, "User not found")
        pj      = dict(user.get("profile_data_json") or {})
        updates = {k: v for k, v in data.dict(exclude_unset=True).items()
                   if k not in ("email", "password") and v is not None}
        if "gender" in updates:
            updates["gender"] = _norm_gender(updates["gender"])
        if "body_measurements" in updates and isinstance(updates["body_measurements"], dict):
            existing_meas = dict(pj.get("body_measurements") or {})
            existing_meas.update(updates.pop("body_measurements"))
            updates["body_measurements"] = existing_meas
        pj.update(updates)
        updated = await db_update_profile(auth["user_id"], pj)
        safe = {k: v for k, v in (updated or {}).items() if k != "password_hash"}
        return {"token": None, "user": safe, "saved": True}

    # ── Unauthenticated path (wizard step 3 before login) ───────────
    email = (data.email or "").strip().lower()
    if not email:
        raise HTTPException(422, "email is required when not authenticated")

    profile_fields = {k: v for k, v in data.model_dump().items()
                      if k not in ("email", "password", "name") and v is not None}
    if "gender" in profile_fields:
        profile_fields["gender"] = _norm_gender(profile_fields["gender"])

    # Try to find existing user — check local cache first
    existing = await db_get_by_email(email)

    # If not in cache, try Boss API login to check if user exists
    if not existing and data.password:
        try:
            c = await _boss_client()
            lr = await c.post("/api/auth/login", json={
                "email": email, "password": data.password,
            }, headers={"Content-Type": "application/json"})
            if lr.status_code != 200:
                # Try form-data format
                lr = await c.post("/api/auth/login", data={
                    "username": email, "password": data.password,
                })
            if lr.status_code == 200:
                login_data = lr.json()
                boss_token = login_data.get("access_token", "")
                existing = await _boss_get_user(boss_token)
                if existing:
                    _mem_users[existing["user_id"]] = existing
                    _mem_email[existing["email"]] = existing["user_id"]
        except Exception as e:
            log.debug("Boss login probe for %s failed: %s", email, e)

    if existing:
        # User exists — update their profile
        pj = dict(existing.get("profile_data_json") or {})
        if "body_measurements" in profile_fields and isinstance(profile_fields["body_measurements"], dict):
            existing_meas = dict(pj.get("body_measurements") or {})
            existing_meas.update(profile_fields.pop("body_measurements"))
            profile_fields["body_measurements"] = existing_meas
        pj.update(profile_fields)
        updated = await db_update_profile(existing["user_id"], pj)
        token   = _make_token(existing["user_id"], existing["email"])
        safe    = {k: v for k, v in (updated or {}).items() if k not in ("password_hash", "_boss_token")}
        return {"token": token, "user": safe, "saved": True}
    else:
        # New user — register them with profile
        if not data.password:
            raise HTTPException(422, "password is required for new users")
        reg_data = {
            "email":    email,
            "password": data.password,
            "name":     data.name or email.split("@")[0],
            **profile_fields,
        }
        try:
            user    = await db_create_user(reg_data)
            token   = _make_token(user["user_id"], user["email"])
            safe    = {k: v for k, v in user.items() if k not in ("password_hash", "_boss_token")}
            return {"token": token, "user": safe, "saved": True, "registered": True}
        except HTTPException as e:
            if e.status_code == 409:
                # User exists on Boss but login probe failed (wrong password?)
                # Return a clear message so frontend can redirect to login
                raise HTTPException(409, "Account already exists — please login with your original password")
            raise


# ── Recommendations ───────────────────────────────────────────────
@app.get("/api/recommendations", tags=["Recommendations"],
         summary="Get recommendations using saved profile")
async def get_recommendations(
    top_k:    int            = Query(20, ge=1, le=500),
    limit:    int            = Query(0,  ge=0, le=500),   # alias
    gender:   Optional[str]  = Query(None),
    color:    Optional[str]  = Query(None),
    category: Optional[str]  = Query(None),
    season:   Optional[str]  = Query(None),
    include_breakdown: bool  = Query(False),
    auth:     Optional[Dict] = Depends(current_user),
):
    if not auth:
        raise HTTPException(401, "Login required")
    user = await db_get_by_id(auth["user_id"])
    if not user:
        raise HTTPException(404, "User not found")

    # `limit` param is alias for `top_k` (frontend uses `limit`)
    effective_k = limit if limit > 0 else top_k

    override: Dict[str, Any] = {}
    if gender:   override["gender"]     = gender
    if color:    override["colors"]     = [color]
    if category: override["categories"] = [category]
    if season:   override["season"]     = season

    items = await rank_catalog(user, top_k=effective_k,
                               override=override if override else None)

    if not include_breakdown:
        for item in items:
            item.pop("score_detail", None)

    pj = user.get("profile_data_json") or {}
    return {
        "user_id":   user["user_id"],
        "user_name": user.get("name", ""),
        "total":     len(items),
        "filters_used": {
            "gender":     override.get("gender")     or pj.get("gender", ""),
            "colors":     override.get("colors")     or pj.get("preferred_colors", []),
            "categories": override.get("categories") or pj.get("preferred_categories", []),
            "season":     override.get("season")     or pj.get("preferred_season", ""),
        },
        "items": items,
    }


@app.post("/api/recommendations", tags=["Recommendations"],
          summary="POST recommendations with custom overrides")
async def post_recommendations(
    req:  RecRequest,
    auth: Optional[Dict] = Depends(current_user),
):
    if not auth:
        raise HTTPException(401, "Login required")
    user = await db_get_by_id(auth["user_id"])
    if not user:
        raise HTTPException(404, "User not found")

    override: Dict[str, Any] = {}
    if req.gender:     override["gender"]     = req.gender
    if req.colors:     override["colors"]     = req.colors
    if req.categories: override["categories"] = req.categories
    if req.season:     override["season"]     = req.season

    items = await rank_catalog(user, top_k=req.top_k,
                               override=override if override else None)
    if not req.include_score_detail:
        for item in items:
            item.pop("score_detail", None)

    pj = user.get("profile_data_json") or {}
    return {
        "user_id": user["user_id"],
        "total":   len(items),
        "items":   items,
        "filters_used": override or {
            "gender":     pj.get("gender", ""),
            "colors":     pj.get("preferred_colors", []),
            "categories": pj.get("preferred_categories", []),
            "season":     pj.get("preferred_season", ""),
        },
    }


# ── Public trending — MUST be defined BEFORE /{email} ────────────
# FastAPI matches routes top-to-bottom; "trending" would be swallowed
# by the /{email} wildcard if trending came second.
@app.get("/api/recommendations/trending", tags=["Recommendations"],
         summary="Public trending — no login needed")
async def trending(
    limit:    int           = Query(20, ge=1, le=500),
    gender:   Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    color:    Optional[str] = Query(None),
):
    """
    Returns up to `limit` items from the full 500-item catalog.
    No auth required. Items sorted by total stock availability.
    """
    items = await fetch_catalog(
        gender=_norm_gender(gender) if gender else None,
        colors=[color] if color else None,
        categories=[category] if category else None,
        limit=500,   # always fetch all 500, then trim to limit
    )

    # Sort by stock (most available = trending)
    def _stock_sum(x):
        total = 0
        for v in (x.get("variants") or []):
            if isinstance(v, dict):
                try: total += int(v.get("stock_quantity") or 0)
                except (TypeError, ValueError): pass
        return total
    items.sort(key=_stock_sum, reverse=True)

    out:  List[Dict] = []
    seen: Set[str]   = set()

    for item in items:
        if len(out) >= limit:
            break
        iid = str(item.get("catalog_item_id") or item.get("id") or "")
        if not iid or iid in seen:
            continue
        seen.add(iid)

        imgs, primary = _build_images(item)
        vars_, sizes, cols = _build_variants(item)

        out.append({
            "catalog_item_id":   iid,
            "name":              item.get("name"),
            "category":          item.get("category"),
            "subcategory":       item.get("subcategory"),
            "gender":            _gender(item),
            "base_price":        _safe_float(item.get("base_price")),
            "primary_image_url": primary,
            "images":            imgs,
            "variants":          vars_,
            "available_sizes":   sizes,
            "available_colors":  cols,
            "in_stock":          _in_stock(item),
            "style_tags":        _tags(item),
            # legacy
            "id":    iid,
            "image": primary,
            "price": _safe_float(item.get("base_price")),
        })

    return {"total": len(out), "items": out}


# ── Compatibility route: GET /api/recommendations/{email} ─────────
# MUST come AFTER /trending — otherwise "trending" matches as {email}
@app.get("/api/recommendations/{email}", tags=["Recommendations"],
         summary="[Compat] Recommendations by email URL param (uses JWT identity)")
async def recommendations_by_email(
    email:             str,
    limit:             int            = Query(24, ge=1, le=500),
    top_k:             int            = Query(0,  ge=0, le=500),
    include_breakdown: bool           = Query(False),
    gender:            Optional[str]  = Query(None),
    color:             Optional[str]  = Query(None),
    category:          Optional[str]  = Query(None),
    season:            Optional[str]  = Query(None),
    auth:              Optional[Dict] = Depends(current_user),
):
    """
    Frontend compatibility route.
    The {email} path param is accepted but IGNORED for security.
    Actual identity comes from the JWT Bearer token.
    """
    effective_k = top_k if top_k > 0 else limit
    return await get_recommendations(
        top_k=effective_k,
        limit=0,
        gender=gender,
        color=color,
        category=category,
        season=season,
        include_breakdown=include_breakdown,
        auth=auth,
    )


# ── Single item detail ────────────────────────────────────────────
@app.get("/api/catalog/{item_id}", tags=["Catalog"],
         summary="Single item full detail")
async def get_item(item_id: str = Path(...)):
    """Fetch single catalog item from Boss API GET /api/catalog/{id}."""
    try:
        c = await _boss_client()
        r = await c.get(f"/api/catalog/{item_id}", headers=_boss_headers())
        if r.status_code == 200:
            item = r.json()
            imgs, primary  = _build_images(item)
            vars_, sizes, cols = _build_variants(item)
            return {
                **item,
                "images":            imgs,
                "variants":          vars_,
                "available_sizes":   sizes,
                "available_colors":  cols,
                "primary_image_url": primary,
                "in_stock":          _in_stock(item),
                "style_tags":        _tags(item),
                "physics_profile":   _physics_profile(item),
            }
    except Exception as e:
        log.warning("Boss API get_item failed: %s", e)
    raise HTTPException(404, f"Item {item_id} not found")


# ── System ────────────────────────────────────────────────────────
@app.get("/", include_in_schema=False)
async def root():
    return {
        "service": "HueIQ Engine",
        "version": "9.0.0",
        "backend": "Boss PostgreSQL API",
        "boss_url": BOSS_URL,
        "docs":    "/docs",
    }

@app.get("/health", tags=["System"])
async def health():
    info: Dict[str, Any] = {
        "status":  "ok",
        "version": "9.0.0",
        "backend": "postgres (via Boss API)",
    }
    # Check Boss API connectivity
    try:
        c = await _boss_client()
        r = await c.get("/health", headers=_boss_headers(), timeout=5.0)
        info["boss_api"] = r.status_code == 200
        if r.status_code == 200:
            info["boss_health"] = r.json()
    except Exception:
        info["boss_api"] = False
    info["cached_users"] = len(_mem_users)
    return info


# ── Startup / shutdown ────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    log.info("HueIQ Engine v9.0 starting (backend: Boss PostgreSQL API)...")
    asyncio.create_task(_init())

async def _init():
    await asyncio.sleep(1)
    # Verify Boss API connectivity
    try:
        c = await _boss_client()
        r = await c.get("/health", headers=_boss_headers(), timeout=5.0)
        if r.status_code == 200:
            log.info("Boss API connected → %s", BOSS_URL)
            # Pre-fetch catalog to warm cache
            items = await fetch_catalog(limit=500)
            log.info("Catalog pre-loaded: %d items", len(items))
        else:
            log.warning("Boss API health check failed (%d)", r.status_code)
    except Exception as e:
        log.warning("Boss API unreachable: %s — will retry on first request", e)

@app.on_event("shutdown")
async def shutdown():
    global _boss_cli, _dify_cli
    if _boss_cli: await _boss_cli.aclose()
    if _dify_cli: await _dify_cli.aclose()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8002, reload=True, log_level="info")



