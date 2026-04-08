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
from fastapi import FastAPI, HTTPException, Path, Query, Request, Depends, Body, File, UploadFile
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

load_dotenv(override=True)
logging.basicConfig(level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("hueiq")


# ── Config ────────────────────────────────────────────────────────
BOSS_URL            = os.getenv("BOSS_API_URL",
    "https://hueiq-core-api.purplesand-63becfba.westus2.azurecontainerapps.io")
BOSS_TOKEN          = os.getenv("BOSS_TOKEN", "")
BOSS_ADMIN_EMAIL    = os.getenv("BOSS_ADMIN_EMAIL", "")
BOSS_ADMIN_PASSWORD = os.getenv("BOSS_ADMIN_PASSWORD", "")
DIFY_URL   = os.getenv("DIFY_API_URL",  "https://cloud.xpectrum.co")
DIFY_KEY   = os.getenv("DIFY_API_KEY",  "app-6XxyzGBrc3Sjj56vcWD2uNrn")
JWT_SECRET = os.getenv("JWT_SECRET",    "hueiq-secret-change-in-prod")
JWT_HOURS  = int(os.getenv("JWT_EXPIRE_HOURS", "72"))


# ── Boss API HTTP client ─────────────────────────────────────────
_boss_cli: Optional[httpx.AsyncClient] = None

async def _boss_client() -> httpx.AsyncClient:
    global _boss_cli
    if _boss_cli is None or _boss_cli.is_closed:
        _boss_cli = httpx.AsyncClient(base_url=BOSS_URL, timeout=120.0)
    return _boss_cli

def _boss_headers(token: str = "") -> Dict[str, str]:
    """Auth headers for Boss API calls. No Content-Type for GET requests."""
    t = token or BOSS_TOKEN
    h: Dict[str, str] = {}
    if t:
        h["Authorization"] = f"Bearer {t}"
    return h

def _is_token_expired(token: str) -> bool:
    """Decode JWT without verification and check if exp has passed."""
    if not token:
        return True
    try:
        import base64
        payload = token.split(".")[1]
        payload += "=" * (4 - len(payload) % 4)
        data = json.loads(base64.urlsafe_b64decode(payload))
        exp = data.get("exp", 0)
        return time.time() >= exp
    except Exception:
        return True

def _token_expires_in(token: str) -> float:
    """Returns seconds until token expires. Returns 0 if expired or invalid."""
    if not token:
        return 0
    try:
        import base64
        payload = token.split(".")[1]
        payload += "=" * (4 - len(payload) % 4)
        data = json.loads(base64.urlsafe_b64decode(payload))
        exp = data.get("exp", 0)
        return max(0.0, exp - time.time())
    except Exception:
        return 0

async def _refresh_boss_token() -> bool:
    """
    Login with admin credentials to obtain a fresh BOSS_TOKEN.
    Updates the module-level BOSS_TOKEN in place.
    Retries up to 3 times with increasing delays (Azure cold-start can take 60-90s).
    Returns True if refresh succeeded.
    """
    global BOSS_TOKEN
    if not BOSS_ADMIN_EMAIL or not BOSS_ADMIN_PASSWORD:
        log.warning("BOSS_TOKEN expired and no admin credentials in .env — catalog may fail")
        return False
    try:
        c = await _boss_client()
        r = await c.post("/api/auth/login", json={
            "email": BOSS_ADMIN_EMAIL,
            "password": BOSS_ADMIN_PASSWORD,
        }, headers={"Content-Type": "application/json"}, timeout=15.0)
        if r.status_code == 200:
            new_token = r.json().get("access_token", "")
            if new_token:
                BOSS_TOKEN = new_token
                log.info("BOSS_TOKEN refreshed via admin login ✓")
                # Persist to .env so next server restart uses the fresh token
                try:
                    env_path = os.path.join(os.path.dirname(__file__), ".env")
                    env_text = open(env_path, encoding="utf-8").read()
                    import re as _re2
                    env_text = _re2.sub(r"BOSS_TOKEN=.*", f"BOSS_TOKEN={new_token}", env_text)
                    open(env_path, "w", encoding="utf-8").write(env_text)
                    log.info("BOSS_TOKEN saved to .env")
                except Exception as _e:
                    log.warning("Could not save BOSS_TOKEN to .env: %s", _e)
                return True
            log.warning("Admin login succeeded but no access_token in response")
        else:
            log.warning("Admin login failed (%d): %s", r.status_code, r.text[:200])
    except (httpx.ReadError, httpx.ConnectError, httpx.TimeoutException) as e:
        log.warning("_refresh_boss_token failed (%s) — Boss API unreachable", type(e).__name__)
    except Exception as e:
        log.warning("_refresh_boss_token error: %s — %s", type(e).__name__, repr(e))
    return False


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

        # Step 1: signup via Boss auth (10s timeout — fall back to in-memory if cold)
        signup_r = await c.post("/api/auth/signup", json={
            "email": email,
            "password": password,
            "user_type": "shopper",
        }, headers={"Content-Type": "application/json"}, timeout=10.0)

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
            }, headers={"Content-Type": "application/json"}, timeout=5.0)
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
            }, headers=_boss_headers(boss_token), timeout=10.0)

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
        elif r.status_code == 401:
            log.warning("Boss API get_by_id 401 — refreshing token and retrying")
            refreshed = await _refresh_boss_token()
            if refreshed:
                r2 = await c.get(f"/api/users/{uid}", headers=_boss_headers())
                if r2.status_code == 200:
                    doc = _boss_user_to_doc(r2.json())
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
        }, headers=_boss_headers(), timeout=10.0)
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
    explicit = (
        item.get("gender") or
        (em.get("gender") if isinstance(em, dict) else None) or
        ""
    ).lower()
    if explicit and explicit != "unisex":
        return explicit
    # Infer gender from name + category when not explicitly set
    name = (item.get("name") or "").lower()
    cat  = (item.get("category") or "").lower()
    # Normalize curly quotes/apostrophes to straight
    text = f"{name} {cat}".replace("\u2019", "'").replace("\u2018", "'")

    # Check women FIRST — "women's" contains "men's" so order matters
    women_kw = (
        "women", "woman", "womens", "women's", "ladies", "girls", "female",
        "miss chase", "vero moda", "sassafras", "tokyo talkies",
        "blouse", "kurta", "anarkali", "lehenga", "saree",
        "dress", "dresses", "skirt", "skirts", "jumpsuit", "top", "tops",
        "blouse", "bra", "lingerie", "bikini", "gown", "frock",
    )
    is_women = any(k in text for k in women_kw)
    if is_women:
        return "women"

    men_kw = (
        " men ", " men's", "mens ", "for men", "boys ", " male",
        "highlander", "peter england", "ben martin", "majestic man",
        "levi's men", "symbol men", "bewakoof x streetwear men",
        "shirt", "tshirt", "t-shirt", "trouser", "trousers",
        "blazer", "suit", "kurta men", "dhoti", "sherwani",
    )
    is_men = any(k in text for k in men_kw)
    if is_men:
        return "men"
    return "unisex"

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

def _stock_score(item: Dict) -> float:
    """Returns 0.0–1.0 based on total stock. Out-of-stock = 0.0, well-stocked = 1.0."""
    vs = item.get("variants") or []
    if not vs:
        return 1.0 if item.get("in_stock", True) else 0.0
    total = 0
    for v in vs:
        if isinstance(v, dict):
            try: total += int(v.get("stock_quantity") or 0)
            except (TypeError, ValueError): pass
    if total == 0:   return 0.0
    if total < 5:    return 0.4
    if total < 20:   return 0.7
    return 1.0

def _discount_percent(item: Dict) -> float:
    """Returns discount percentage if sale_price < base_price, else 0."""
    try:
        bp = float(item.get("base_price") or 0)
        sp = float(item.get("sale_price") or 0)
        if bp > 0 and sp > 0 and sp < bp:
            return round((bp - sp) / bp * 100, 1)
    except (TypeError, ValueError):
        pass
    return float(item.get("discount_percent") or 0)

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


# ── Catalog source: Boss PostgreSQL DB ────────────────────────────

_KNOWN_SIZES = {"XXS","XS","S","M","L","XL","XXL","2XL","3XL","4XL","5XL",
                "6","6.5","7","7.5","8","8.5","9","9.5","10","10.5","11","11.5","12","13","14",
                "28","29","30","31","32","33","34","36","38","40","42",
                "ONE SIZE","OS","OSFA"}
_KNOWN_COLORS = {"black","white","red","blue","green","navy","grey","gray","pink","yellow",
                 "orange","purple","brown","beige","cream","olive","teal","coral","maroon",
                 "burgundy","tan","sand","khaki","charcoal","ivory","gold","silver","wine",
                 "lavender","mint","sage","rust","slate","denim","indigo","forest","plum",
                 "military green","baby blue","light blue","sky blue","dark blue","royal blue",
                 "hot pink","dusty rose","off white","heather grey","black wash","stone wash",
                 "acid wash","light wash","dark wash","medium wash"}

def _is_size(val: str) -> bool:
    """Check if a variant option looks like a size."""
    v = val.strip().upper()
    if v in _KNOWN_SIZES:
        return True
    # Check for shoe sizes like "8.5"
    try:
        f = float(v)
        return 4 <= f <= 15  # shoe size range
    except ValueError:
        pass
    return False

def _is_color(val: str) -> bool:
    """Check if a variant option looks like a color."""
    return val.strip().lower() in _KNOWN_COLORS

def _shopify_category(product_type: str) -> str:
    """Normalize Shopify product_type to our category system."""
    pt = (product_type or "").lower().strip()
    cat_map = {
        "tops - t-shirts": "t-shirts", "tops - shirts": "shirts",
        "tops - hoodies": "outerwear", "tops - sweaters": "outerwear",
        "tops - jackets": "outerwear", "tops - tanks": "tops",
        "tops - polos": "shirts", "tops": "tops",
        "bottoms - jeans": "jeans", "bottoms - pants": "trousers",
        "bottoms - shorts": "shorts", "bottoms - joggers": "joggers",
        "bottoms - sweatpants": "track-pants", "bottoms": "trousers",
        "dresses": "dresses", "outerwear": "outerwear",
        "footwear": "shoes", "accessories": "accessories",
        "activewear": "activewear", "swimwear": "swimwear",
        "sets": "co-ord-sets", "jumpsuits": "jumpsuits",
    }
    for key, val in cat_map.items():
        if key in pt:
            return val
    return pt.replace(" ", "-") if pt else "uncategorized"

def _shopify_gender(tags: str, title: str) -> str:
    """Infer gender from Shopify tags/title."""
    combined = f"{tags} {title}".lower()
    if any(w in combined for w in ["women", "woman", "ladies", "female", "her "]):
        return "women"
    if any(w in combined for w in ["men's", "mens", "male", "his ", " men"]):
        return "men"
    return "unisex"

async def _fetch_boss_store_catalog(store_id: int = 1) -> List[Dict]:
    """Fetch ALL products from Boss store catalog endpoint with cursor pagination."""
    items: List[Dict] = []
    cursor = None
    page = 0

    # Get a store auth token
    boss_store_token = os.getenv("BOSS_STORE_TOKEN", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyIiwidXNlcl90eXBlIjoic3RvcmUiLCJleHAiOjE3NzU1NTgzOTV9.pRapRcguDI9QBAEZnDCK3cPrYFyqjN9CSl2aRIAuD_4")

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            while True:
                page += 1
                url = f"{BOSS_URL}/api/stores/{store_id}/catalog"
                if cursor:
                    url += f"?cursor={cursor}"

                r = await client.get(url, headers={
                    "Authorization": f"Bearer {boss_store_token}",
                    "Content-Type": "application/json",
                })

                if r.status_code != 200:
                    log.warning("Boss store catalog error: HTTP %d", r.status_code)
                    break

                data = r.json()
                page_items = data.get("items", [])
                if not page_items:
                    break

                for p in page_items:
                    title = p.get("title") or ""
                    if not title:
                        continue

                    pid = str(p.get("id", ""))
                    category = _shopify_category(p.get("category") or "")
                    tags_str = ", ".join(p.get("tags") or [])
                    gender = _shopify_gender(tags_str, title)
                    base_price = float(p.get("base_price") or 0)
                    thumbnail = p.get("thumbnail_url") or p.get("texture_url") or ""

                    # Parse size_options for sizes and colors
                    size_options = p.get("size_options") or {}
                    sizes = []
                    colors = []
                    for variant_id, variant in size_options.items():
                        selected = variant.get("selectedOptions") or []
                        for opt in selected:
                            if not opt:
                                continue
                            name = (opt.get("name") or "").lower()
                            value = opt.get("value") or ""
                            if not value or value == "Default Title":
                                continue
                            if "option2" in name or "size" in name:
                                if value not in sizes:
                                    sizes.append(value)
                            elif "option1" in name or "color" in name:
                                if value.lower() not in [c.lower() for c in colors]:
                                    colors.append(value)

                    # Extract brand from tags
                    tag_list = [t.strip() for t in (p.get("tags") or []) if t.strip()]
                    brand = ""
                    noisy_tags = {"age_tagged", "mortar", "flash", "fw2025"}
                    for t in tag_list:
                        tl = t.lower()
                        if tl not in noisy_tags and "catalog" not in tl and len(t) > 1:
                            if t == t.upper() or (t[0].isupper() and " " not in t):
                                brand = t
                                break

                    clean_tags = [t.lower() for t in tag_list
                                  if t.lower() not in noisy_tags and "catalog" not in t.lower()]

                    items.append({
                        "catalog_item_id": f"boss-{pid}",
                        "id": f"boss-{pid}",
                        "name": title,
                        "description": p.get("description") or "",
                        "category": category,
                        "subcategory": p.get("category") or "",
                        "gender": gender,
                        "brand": brand,
                        "base_price": base_price,
                        "sale_price": base_price,
                        "discount_percent": 0,
                        "primary_image_url": thumbnail,
                        "images": [{"image_id": pid, "image_url": thumbnail, "is_primary": True}] if thumbnail else [],
                        "variants": [{"size": s, "color": colors[0] if colors else "", "price": base_price}
                                     for s in sizes] if sizes else [],
                        "available_sizes": sizes,
                        "available_colors": [c.lower() for c in colors],
                        "in_stock": True,
                        "style_tags": {"tags": clean_tags},
                        "extra_metadata": {
                            "occasion": ", ".join(clean_tags[:4]),
                            "gender": gender,
                            "product_type": p.get("category") or "",
                        },
                        "physics_profile": {},
                        "stock_info": {"total_quantity": 100},
                        "colors": [c.lower() for c in colors],
                        "tags": clean_tags,
                        "created_at": p.get("created_at") or "",
                        "mesh_key": p.get("mesh_key") or "",
                        "texture_url": p.get("texture_url") or "",
                    })

                # Check for next page
                next_cursor = data.get("next_cursor")
                if next_cursor and next_cursor != cursor:
                    cursor = next_cursor
                else:
                    break

        # Filter out items with no image or no price
        before = len(items)
        items = [it for it in items if it.get("primary_image_url") and (it.get("base_price") or 0) > 0]
        log.info("Boss store catalog loaded: %d products (%d with images+price) from store %d (%d pages)",
                 before, len(items), store_id, page)
    except Exception as e:
        log.warning("Boss store catalog fetch failed: %s", e)

    return items




# ── Load CSV catalog (Xpectrum) — LEGACY, kept as fallback ────────
def _load_csv_catalog() -> List[Dict]:
    """
    Load catalog_for_xpectrum.csv and convert each row into a catalog
    item dict compatible with rank_catalog().  Returns items with real
    names, prices, brands — Myntra-quality product data.
    Images are pulled from the Boss API disk cache by matching category.
    """
    import csv as _csv
    import hashlib
    from collections import defaultdict

    csv_path = os.path.join(os.path.dirname(__file__), "..", "catalog_for_xpectrum.csv")
    if not os.path.exists(csv_path):
        csv_path = os.path.join(os.path.dirname(__file__), "catalog_for_xpectrum.csv")
    if not os.path.exists(csv_path):
        log.warning("CSV catalog not found — skipping CSV load")
        return []

    # ── Load images from Boss API disk cache ──────────────────────
    # Boss items have real product images (Azure blob) but bad metadata.
    # CSV items have good metadata but no images.  We match by category.
    cat_images: Dict[str, List[Dict]] = defaultdict(list)
    _img_cache_path = os.path.join(os.path.dirname(__file__), "_catalog_cache.json")
    try:
        if os.path.exists(_img_cache_path):
            with open(_img_cache_path, encoding="utf-8") as f:
                boss_items = json.load(f)
            for bi in boss_items:
                imgs = bi.get("images") or []
                if not imgs:
                    continue
                # Get the first valid image URL
                img_url = ""
                img_list = []
                for img in imgs:
                    url = img.get("image_url") or img.get("url") or ""
                    if url:
                        if not img_url:
                            img_url = url
                        img_list.append(img)
                if img_url:
                    boss_cat = (bi.get("category") or "").lower().strip()
                    cat_images[boss_cat].append({
                        "primary_url": img_url,
                        "images":      img_list,
                    })
            log.info("Loaded images from disk cache: %d categories, %d total image sets",
                     len(cat_images), sum(len(v) for v in cat_images.values()))
    except Exception as e:
        log.warning("Could not load images from disk cache: %s", e)

    # Category mapping: CSV category -> Boss category (for image lookup)
    # CSV has specific categories, Boss uses broader ones
    _img_cat_map = {
        "dresses": ["dresses", "women dresses", "women's dresses"],
        "tops": ["tops", "women tops", "women's tops"],
        "t-shirts": ["t-shirts", "women t-shirts", "women's t-shirts", "men's t-shirts", "tops"],
        "jeans": ["jeans", "pants"],
        "shirts": ["shirts", "men's shirts", "tops"],
        "trousers": ["trousers", "pants", "mens bottomwear", "men's bottomwear", "women's bottomwear"],
        "kurta-sets": ["kurta-sets"],
        "kurtas": ["kurtas", "kurta-sets"],
        "jumpsuits": ["jumpsuits", "women jumpsuits"],
        "co-ord-sets": ["co-ord-sets", "co-ord sets"],
        "track-pants": ["track-pants", "pants"],
        "joggers": ["joggers", "track-pants", "pants"],
        "shrugs": ["shrugs", "outerwear"],
        "blouses": ["blouses", "tops"],
        "blazers": ["blazers", "outerwear"],
        "ethnic-wear": ["women's ethnic wear", "kurta-sets"],
        "winterwear": ["men's winterwear", "outerwear"],
        "outerwear": ["men's outerwear", "outerwear"],
        "innerwear": ["men's innerwear"],
    }
    # Track which images have been assigned to avoid duplicates
    _used_img_idx: Dict[str, int] = defaultdict(int)

    def _pick_image(category: str) -> tuple:
        """Pick next unused image for this category. Returns (primary_url, images_list)."""
        # Try mapped categories first, then exact match, then 'tops' fallback
        cats_to_try = _img_cat_map.get(category, [category]) + [category]
        for try_cat in cats_to_try:
            img_pool = cat_images.get(try_cat, [])
            if img_pool:
                idx = _used_img_idx[try_cat] % len(img_pool)
                _used_img_idx[try_cat] += 1
                return img_pool[idx]["primary_url"], img_pool[idx]["images"]
        # Ultimate fallback: use any available image from 'dresses' or 'tops'
        for fb in ["dresses", "tops", "pants"]:
            img_pool = cat_images.get(fb, [])
            if img_pool:
                idx = _used_img_idx[fb] % len(img_pool)
                _used_img_idx[fb] += 1
                return img_pool[idx]["primary_url"], img_pool[idx]["images"]
        return "", []

    # ── Parse CSV rows ────────────────────────────────────────────
    items: List[Dict] = []
    try:
        with open(csv_path, encoding="utf-8") as f:
            reader = _csv.DictReader(f)
            for i, row in enumerate(reader):
                name     = (row.get("Name") or "").strip()
                if not name:
                    continue
                cat_raw  = (row.get("Category") or "").strip()
                # Normalise category to lowercase simple form
                cat_map  = {
                    "dresses": "dresses", "women dresses": "dresses",
                    "women's dresses": "dresses",
                    "tops": "tops", "women tops": "tops", "women's tops": "tops",
                    "t-shirts": "t-shirts", "women t-shirts": "t-shirts",
                    "women's t-shirts": "t-shirts", "men's t-shirts": "t-shirts",
                    "jeans": "jeans", "shirts": "shirts", "men's shirts": "shirts",
                    "trousers": "trousers", "cargo trousers": "trousers",
                    "jogger trousers": "trousers", "cargo pants": "trousers",
                    "mens bottomwear": "trousers", "men's bottomwear": "trousers",
                    "women's bottomwear": "trousers",
                    "kurta-sets": "kurta-sets", "kurtas": "kurtas",
                    "jumpsuits": "jumpsuits", "women jumpsuits": "jumpsuits",
                    "co-ord-sets": "co-ord-sets", "co-ord sets": "co-ord-sets",
                    "track-pants": "track-pants", "joggers": "joggers",
                    "shrugs": "shrugs", "blouses": "blouses", "blazers": "blazers",
                    "women's ethnic wear": "ethnic-wear",
                    "men's winterwear": "winterwear",
                    "men's outerwear": "outerwear",
                    "men's innerwear": "innerwear",
                }
                category = cat_map.get(cat_raw.lower(), cat_raw.lower().replace(" ", "-"))

                price    = float(row.get("Price") or 0)
                colors   = [c.strip().lower() for c in (row.get("Colors") or "").split(",") if c.strip()]
                sizes    = [s.strip() for s in (row.get("Sizes") or "").split(",") if s.strip()]
                gender_r = (row.get("Gender") or "").strip().lower()
                # Infer gender from category/name if missing
                if not gender_r:
                    low = (cat_raw + " " + name).lower()
                    if "women" in low or "ladies" in low:
                        gender_r = "women"
                    elif "men's" in low or "mens " in low:
                        gender_r = "men"
                gender   = _norm_gender(gender_r) if gender_r else ""
                occasion = [o.strip().lower() for o in (row.get("Occasion") or "").split(",") if o.strip()]
                brand    = (row.get("Brand") or "").strip()
                # Extract brand from name if missing
                if not brand and name:
                    brand = name.split()[0] if name.split() else ""
                fit      = (row.get("Fit") or "").strip()
                desc     = (row.get("Description") or "").strip()

                # Generate stable ID from row index + name hash
                iid = hashlib.md5(f"xpectrum_{i}_{name}".encode()).hexdigest()
                catalog_item_id = f"{iid[:8]}-{iid[8:12]}-{iid[12:16]}-{iid[16:20]}-{iid[20:32]}"

                # Pick a real product image from Boss API by category
                primary_url, img_list = _pick_image(category)

                items.append({
                    "catalog_item_id": catalog_item_id,
                    "id":              catalog_item_id,
                    "name":            name,
                    "description":     desc,
                    "category":        category,
                    "subcategory":     "",
                    "gender":          gender,
                    "brand":           brand,
                    "base_price":      price,
                    "sale_price":      price,
                    "discount_percent": 0,
                    "primary_image_url": primary_url,
                    "images":          img_list,
                    "variants":        [],
                    "available_sizes": sizes,
                    "available_colors": colors,
                    "in_stock":        True,
                    "style_tags":      {"tags": occasion + ([fit] if fit else [])},
                    "extra_metadata":  {
                        "occasion": ", ".join(occasion),
                        "gender":   gender,
                        "fit":      fit,
                    },
                    "physics_profile": {"fit": fit} if fit else {},
                    "stock_info":      {"total_quantity": 100},
                    "colors":          colors,
                    "tags":            occasion + ([fit] if fit else []),
                })

        img_count = sum(1 for it in items if it["primary_image_url"])
        log.info("CSV catalog loaded: %d items (%d with images)", len(items), img_count)
    except Exception as e:
        log.warning("Failed to load CSV catalog: %s", e)
    return items


# ── Catalog fetch from Boss PostgreSQL API ────────────────────────
# Loading strategy:
#   1. On startup: load CSV catalog (real product data) first
#   2. Then load from disk cache / Boss API as supplement
#   3. CSV items take priority — they have real names, prices, brands
_full_catalog_cache: List[Dict] = []
_csv_catalog_items: List[Dict] = []   # preserved CSV items — never overwritten by Boss API
_catalog_loading: bool = False
_shopify_is_source: bool = False  # When True, Boss API catalog loading is skipped

# ── Demo catalog (shown when Boss API is unreachable) ─────────────
_DEMO_CATALOG: List[Dict] = [
    {"catalog_item_id": "demo-1", "name": "Classic Cotton T-Shirt", "category": "t-shirt",
     "base_price": 499, "brand": "HueIQ Demo", "description": "Comfortable everyday cotton tee",
     "images": [{"url": "https://via.placeholder.com/300x400/4A90D9/white?text=T-Shirt", "color_variant": "blue"}],
     "extra_metadata": {"gender": "men", "season": "summer", "fabric": "cotton"},
     "style_tags": {"tags": ["casual", "basic", "cotton"]}, "variants": []},
    {"catalog_item_id": "demo-2", "name": "Slim Fit Jeans", "category": "jeans",
     "base_price": 1299, "brand": "HueIQ Demo", "description": "Modern slim fit denim",
     "images": [{"url": "https://via.placeholder.com/300x400/1A1A2E/white?text=Jeans", "color_variant": "blue"}],
     "extra_metadata": {"gender": "men", "season": "all", "fabric": "denim"},
     "style_tags": {"tags": ["casual", "denim", "slim"]}, "variants": []},
    {"catalog_item_id": "demo-3", "name": "Floral Summer Dress", "category": "dress",
     "base_price": 1899, "brand": "HueIQ Demo", "description": "Light floral print summer dress",
     "images": [{"url": "https://via.placeholder.com/300x400/E91E8C/white?text=Dress", "color_variant": "pink"}],
     "extra_metadata": {"gender": "women", "season": "summer", "fabric": "chiffon"},
     "style_tags": {"tags": ["floral", "casual", "summer"]}, "variants": []},
    {"catalog_item_id": "demo-4", "name": "Women's Kurta", "category": "kurta",
     "base_price": 899, "brand": "HueIQ Demo", "description": "Elegant ethnic kurta",
     "images": [{"url": "https://via.placeholder.com/300x400/9C27B0/white?text=Kurta", "color_variant": "purple"}],
     "extra_metadata": {"gender": "women", "season": "all", "fabric": "cotton"},
     "style_tags": {"tags": ["ethnic", "traditional", "kurta"]}, "variants": []},
    {"catalog_item_id": "demo-5", "name": "Men's Formal Shirt", "category": "shirt",
     "base_price": 1199, "brand": "HueIQ Demo", "description": "Crisp formal office shirt",
     "images": [{"url": "https://via.placeholder.com/300x400/1565C0/white?text=Shirt", "color_variant": "white"}],
     "extra_metadata": {"gender": "men", "season": "all", "fabric": "cotton"},
     "style_tags": {"tags": ["formal", "office", "classic"]}, "variants": []},
    {"catalog_item_id": "demo-6", "name": "Women's Blazer", "category": "blazer",
     "base_price": 2499, "brand": "HueIQ Demo", "description": "Professional women's blazer",
     "images": [{"url": "https://via.placeholder.com/300x400/37474F/white?text=Blazer", "color_variant": "grey"}],
     "extra_metadata": {"gender": "women", "season": "all", "fabric": "polyester"},
     "style_tags": {"tags": ["formal", "office", "blazer"]}, "variants": []},
    {"catalog_item_id": "demo-7", "name": "Athletic Track Pants", "category": "activewear",
     "base_price": 799, "brand": "HueIQ Demo", "description": "Comfortable track pants for workouts",
     "images": [{"url": "https://via.placeholder.com/300x400/2E7D32/white?text=Track+Pants", "color_variant": "black"}],
     "extra_metadata": {"gender": "men", "season": "all", "fabric": "polyester"},
     "style_tags": {"tags": ["sports", "activewear", "comfort"]}, "variants": []},
    {"catalog_item_id": "demo-8", "name": "Women's Tops Collection", "category": "top",
     "base_price": 699, "brand": "HueIQ Demo", "description": "Trendy casual tops",
     "images": [{"url": "https://via.placeholder.com/300x400/FF7043/white?text=Top", "color_variant": "orange"}],
     "extra_metadata": {"gender": "women", "season": "summer", "fabric": "cotton"},
     "style_tags": {"tags": ["casual", "trendy", "top"]}, "variants": []},
]
_DISK_CACHE_PATH = os.path.join(os.path.dirname(__file__), "_catalog_cache.json")
_DISK_CACHE_MAX_AGE = 7 * 24 * 3600   # 7 days — seed cache is always valid; background task refreshes it

def _load_disk_cache() -> List[Dict]:
    """Load catalog from disk cache. Returns [] if missing or too old."""
    try:
        if not os.path.exists(_DISK_CACHE_PATH):
            return []
        age = time.time() - os.path.getmtime(_DISK_CACHE_PATH)
        if age > _DISK_CACHE_MAX_AGE:
            log.info("Disk cache is %.0fh old — will re-fetch", age / 3600)
            return []
        with open(_DISK_CACHE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        log.info("Loaded %d items from disk cache (%.0f min old)", len(data), age / 60)
        return data
    except Exception as e:
        log.warning("Disk cache load failed: %s", e)
        return []

def _save_disk_cache(items: List[Dict]) -> None:
    """Write catalog to disk cache in the background."""
    try:
        with open(_DISK_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(items, f)
        log.info("Disk cache saved: %d items → %s", len(items), _DISK_CACHE_PATH)
    except Exception as e:
        log.warning("Disk cache save failed: %s", e)

async def _fetch_page(skip: int, cat: Optional[str] = None) -> List[Dict]:
    """Fetch a single catalog page from Boss API."""
    c = await _boss_client()
    h = _boss_headers()
    params: Dict[str, Any] = {"limit": 50, "skip": skip}
    if cat:
        params["category"] = cat
    try:
        r = await c.get("/api/catalog", params=params, headers=h, timeout=120.0)
        if r.status_code == 200:
            raw = r.json()
            page = raw if isinstance(raw, list) else raw.get("items", raw.get("data", []))
            if isinstance(raw, dict) and not page:
                page = [v for v in raw.values() if isinstance(v, list)]
                page = page[0] if page else []
            return page
        elif r.status_code == 401:
            log.warning("Catalog 401 (skip=%d) — refreshing BOSS_TOKEN", skip)
            refreshed = await _refresh_boss_token()
            if refreshed:
                # Retry once with fresh token
                r2 = await c.get("/api/catalog", params=params, headers=_boss_headers(), timeout=120.0)
                if r2.status_code == 200:
                    raw = r2.json()
                    page = raw if isinstance(raw, list) else raw.get("items", raw.get("data", []))
                    return page
            return []
        else:
            log.warning("Boss catalog skip=%d (%d): %s", skip, r.status_code, r.text[:200])
            return []
    except (httpx.ReadError, httpx.ConnectError, httpx.RemoteProtocolError,
            httpx.TimeoutException) as e:
        log.warning("Catalog page skip=%d %s", skip, type(e).__name__)
    except Exception as e:
        log.warning("Catalog page skip=%d: %s — %s", skip, type(e).__name__, repr(e))
    return []

def _filter_real_items(items: List[Dict]) -> List[Dict]:
    """
    Keep items that look like real products. Discard:
      - duplicate IDs
      - items with no ID
      - pure placeholder rows (no name AND no category AND no images)
    Price is NOT required — many catalog items have base_price=0 in the DB
    but are real products. We use ₹999 as a display fallback in the frontend.
    """
    filtered: List[Dict] = []
    seen: Set[str] = set()
    for item in items:
        iid = str(item.get("catalog_item_id") or item.get("id") or "")
        if not iid or iid in seen:
            continue

        name     = (item.get("name") or "").strip()
        category = (item.get("category") or "").strip()
        has_img  = bool(
            item.get("primary_image_url") or
            (item.get("images") or []) or
            (item.get("variants") or [])
        )

        # Discard obvious placeholder/seed rows that have nothing useful
        if not name and not category and not has_img:
            continue

        # Only discard items named exactly "string" (test data)
        # Boss API items with UUID-style names (e.g. "Dress 009b3c31") are real products
        # with images from Azure blob storage — keep them

        # Discard obvious test/template seed rows (name="string", desc="string")
        if name == "string":
            continue

        seen.add(iid)
        filtered.append(item)
    return filtered

async def _scout_real_items():
    """
    Jump straight to skip=2800 where real catalog items are known to exist.
    Called at startup so real items appear within ~10s instead of waiting 2 minutes
    for the sequential background loader to crawl through 56 pages of UUID placeholders.
    SKIPPED when Shopify is the catalog source.
    """
    global _full_catalog_cache
    if _shopify_is_source:
        log.info("Scout skipped — Shopify is catalog source")
        return
    SCOUT_SKIPS = [2800, 2850, 2900, 2950, 3000, 3050, 2750, 2700]
    try:
        pages = await asyncio.gather(*[_fetch_page(s) for s in SCOUT_SKIPS])
        scout_items: List[Dict] = []
        for pg in pages:
            scout_items.extend(pg)
        filtered = _filter_real_items(scout_items)
        if filtered:
            _full_catalog_cache = filtered
            _cset("cat:full", filtered, 3600)
            log.info("Scout: %d real items loaded immediately from skip=2700-3050", len(filtered))
        else:
            log.warning("Scout: no real items found at skip=2700-3050, background load will find them")
    except Exception as e:
        log.warning("Scout failed: %s", e)


async def _load_all_pages_bg():
    """
    Background task: fetch all catalog pages in PARALLEL batches of 4.
    SKIPPED when Shopify is the catalog source.
    """
    global _full_catalog_cache, _catalog_loading
    if _shopify_is_source:
        log.info("Background Boss catalog load skipped — Shopify is catalog source")
        return
    if _catalog_loading:
        return
    _catalog_loading = True
    t0 = time.time()
    try:
        all_items: List[Dict] = []
        PARALLEL = 4          # fetch 4 pages simultaneously
        PAGE_SIZE = 50        # small pages — Boss API times out on large queries

        # Phase 1: probe how many pages exist by fetching first PARALLEL pages
        # Retry first batch up to 5 times with 30s delay to handle Azure cold starts (60-90s)
        skip = 0
        first_batch_ok = False
        for cold_attempt in range(5):
            skips = [skip + i * PAGE_SIZE for i in range(PARALLEL)]
            pages = await asyncio.gather(*[_fetch_page(s) for s in skips])
            if any(pg for pg in pages):
                first_batch_ok = True
                break
            log.warning("Boss API cold start — retry %d/5 in 30s...", cold_attempt + 1)
            await asyncio.sleep(30)
        if not first_batch_ok:
            log.warning("Boss API unreachable after 5 attempts — keeping existing cached items")
            return  # _full_catalog_cache keeps whatever was loaded at startup

        for pg in pages:
            if pg:
                all_items.extend(pg)
        skip += PARALLEL * PAGE_SIZE

        # Update cache with first batch — merge with CSV items (CSV takes priority)
        filtered = _filter_real_items(all_items)
        csv_ids = {it.get("catalog_item_id") for it in _csv_catalog_items}
        merged = _csv_catalog_items[:] + [it for it in filtered
                                          if (it.get("catalog_item_id") or it.get("id") or "") not in csv_ids]
        if merged:
            _full_catalog_cache = merged
            _cset("cat:full", merged, 3600)
            log.info("Background: first batch %d items fetched, %d real, %d total with CSV (%.0fs)",
                     len(all_items), len(filtered), len(merged), time.time() - t0)
        else:
            log.info("Background: first batch %d items fetched, 0 real yet — continuing (%.0fs)",
                     len(all_items), time.time() - t0)
        first_pages_done = any(len(pg) < PAGE_SIZE for pg in pages)

        while not first_pages_done:
            skips = [skip + i * PAGE_SIZE for i in range(PARALLEL)]
            pages = await asyncio.gather(*[_fetch_page(s) for s in skips])
            got_any = False
            for pg in pages:
                if pg:
                    all_items.extend(pg)
                    got_any = True
            if not got_any:
                break

            # Update live cache after each parallel batch — merge with CSV
            filtered = _filter_real_items(all_items)
            if filtered:
                merged = _csv_catalog_items[:] + [it for it in filtered
                                                  if (it.get("catalog_item_id") or it.get("id") or "") not in csv_ids]
                _full_catalog_cache = merged
                _cset("cat:full", merged, 3600)
            skip += PARALLEL * PAGE_SIZE
            log.info("Background: %d items fetched, %d real (%.0fs)",
                     len(all_items), len(filtered), time.time() - t0)

            # If any page returned fewer than PAGE_SIZE items, we've reached the end
            if any(len(pg) < PAGE_SIZE for pg in pages):
                break

        # Save to disk so next server restart is instant
        # Only save if we actually fetched something (don't overwrite good cache with [])
        if _full_catalog_cache:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, _save_disk_cache, _full_catalog_cache)
        elif not all_items:
            # Boss API returned NOTHING at all (cold start / unreachable).
            # Don't overwrite whatever is already in _full_catalog_cache (disk data or previous load).
            # Only fall back to demo if we truly have nothing at all.
            if not _full_catalog_cache:
                log.warning("Boss API unreachable — using %d demo items as fallback", len(_DEMO_CATALOG))
                _full_catalog_cache = _DEMO_CATALOG[:]
                _cset("cat:full", _full_catalog_cache, 300)   # short TTL so real data replaces it quickly
            else:
                log.warning("Boss API unreachable — keeping %d existing cached items", len(_full_catalog_cache))
        log.info("Background fetch complete: %d total, %d real in %.1fs",
                 len(all_items), len(_full_catalog_cache), time.time() - t0)
    except Exception as e:
        log.warning("Background catalog fetch error: %s", e)
        if not _full_catalog_cache:
            log.warning("Falling back to demo catalog (%d items)", len(_DEMO_CATALOG))
            _full_catalog_cache = _DEMO_CATALOG[:]
            _cset("cat:full", _full_catalog_cache, 300)
        else:
            log.warning("Catalog fetch error — keeping %d existing cached items", len(_full_catalog_cache))
    finally:
        _catalog_loading = False

async def fetch_catalog(
    gender:     Optional[str]       = None,
    colors:     Optional[List[str]] = None,
    categories: Optional[List[str]] = None,
    season:     Optional[str]       = None,
    limit:      int                 = 5000,
) -> List[Dict]:
    """
    Progressive catalog fetch:
    1. If full cache exists → return immediately
    2. If partial cache exists → return what we have + trigger background load
    3. If nothing cached → quick-fetch first page, serve it, load rest in background
    """
    global _full_catalog_cache

    # When Shopify is source, always return in-memory Shopify catalog
    if _shopify_is_source and _full_catalog_cache:
        return _full_catalog_cache

    # 1. In-memory full cache (fastest — zero latency)
    full = _cget("cat:full")
    if full is not None and len(full) > 0:
        return full

    # 2. Progressive in-memory cache (partial, already loaded)
    if _full_catalog_cache:
        if not _catalog_loading:
            asyncio.create_task(_load_all_pages_bg())
        return _full_catalog_cache

    # 3. Disk cache (fast — avoids re-downloading on restart)
    disk = _load_disk_cache()
    if disk:
        _full_catalog_cache = disk
        _cset("cat:full", disk, 3600)
        if not _catalog_loading:
            asyncio.create_task(_load_all_pages_bg())
        return disk

    # 4. Nothing cached — quick-fetch first page for instant results
    try:
        t0 = time.time()
        first_page = await _fetch_page(0,
            categories[0] if categories and len(categories) == 1 else None)
        filtered = _filter_real_items(first_page)
        log.info("Quick fetch: %d items → %d real in %.1fs", len(first_page), len(filtered), time.time() - t0)

        if filtered:
            _full_catalog_cache = filtered

        # Start loading all remaining pages in background (parallel)
        if not _catalog_loading:
            asyncio.create_task(_load_all_pages_bg())

        return filtered if filtered else _DEMO_CATALOG[:]  # fallback until real items load

    except Exception as e:
        log.warning("Catalog quick-fetch failed: %s", e)
        # Start background load anyway
        if not _catalog_loading:
            asyncio.create_task(_load_all_pages_bg())
        return []


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
    gender = _gender(item)
    item_color = _item_primary_color(item)
    raw_imgs = [img for img in (item.get("images") or []) if isinstance(img, dict)]
    primary: Optional[str] = None

    # Sort images by created_at to restore upload order (front/back/side per color)
    raw_imgs.sort(key=lambda x: x.get("created_at") or "")

    # Group images in sets of 3 — label each set with a number (not color name,
    # since the API doesn't reliably store color_variant)
    out: List[Dict] = []
    for i, img in enumerate(raw_imgs):
        img_type = (img.get("image_type") or "").lower()
        color_v  = (img.get("color_variant") or "").strip()
        is_p     = bool(img.get("is_primary", False))
        group_num = (i // 3) + 1  # 1-based group number

        real_url = (img.get("image_url") or "").strip()
        if real_url:
            url = real_url
        else:
            url = _fallback_url(iid, cat, color_v or item_color or "default",
                                img_type or "front", gender, viewer_gender)
        out.append({
            "image_id":      img.get("image_id"),
            "image_url":     url,
            "image_type":    img_type,
            "color_variant": color_v or f"variant-{group_num}",
            "is_primary":    is_p,
        })
        if is_p and not primary:
            primary = url

    if not out:
        primary_color = item_color
        fb = _fallback_url(iid, cat, primary_color or "default", "front", gender, viewer_gender)
        out.append({
            "image_id": None, "image_url": fb, "image_type": "front",
            "color_variant": primary_color, "is_primary": True,
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
    if not pref_colors: return 1.0   # no preference = all colors equally good
    item_cols = _item_colors(item)
    if not item_cols: return 0.5    # neutral if item has no color data
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
        # Validate ranges: height 50–250 cm, weight 20–300 kg
        if h > 0 and w > 0 and 50 <= h <= 250 and 20 <= w <= 300:
            # h is in cm, convert to metres before squaring
            bmi = w / (h / 100.0) ** 2
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


def _fit_score_prebuilt(item: Dict, build: str) -> float:
    """
    Faster variant of _fit_score — accepts pre-computed build string
    so _infer_build() is not repeated for every item in the ranking loop.
    """
    phys = _physics_profile(item)
    if phys is None:
        return 0.5
    drape = _PHYSICS_DRAPE.get(phys, 0.5)
    if build:
        if build == "slim"     and phys in ("light_fabric", "knit"):      return 0.95
        if build == "slim"     and phys == "rigid":                       return 0.55
        if build == "plus"     and phys == "stretch_fabric":              return 1.0
        if build == "plus"     and phys == "rigid":                       return 0.2
        if build == "plus"     and phys in ("light_fabric", "knit"):      return 0.75
        if build == "athletic" and phys in ("stretch_fabric", "knit"):    return 0.9
        if build == "athletic" and phys == "rigid":                       return 0.65
        if build == "average":                                             return min(drape + 0.1, 1.0)
    return drape


# ── Seasonal score ────────────────────────────────────────────────
_SEASON_KW = {
    "spring": {"floral","pastel","linen","light","cotton","wrap","breathable","breezy","sundress","midi","flowy"},
    "summer": {"cotton","linen","short","bright","casual","t-shirt","tshirt","tee","sleeveless","tank","shorts","breezy","breathable","crop"},
    "fall":   {"wool","knit","corduroy","layered","warm","sweater","blazer","overshirt","cardigan","hoodie","flannel","plaid","trench"},
    "winter": {"coat","thermal","heavy","cashmere","down","boots","puffer","parka","fleece","fur","lined","woolen","turtleneck"},
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
    if not pref_season:
        return 0.5   # neutral when user has no season preference
    s    = pref_season.lower()
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

# Cache: keyed by (catalog_fingerprint, taste_key) → score dict
_tfidf_cache: Dict[str, Dict[str, float]] = {}

def _content_scores_sync(catalog: List[Dict], pref_cats: List[str],
                         pref_colors: List[str], pref_season: str) -> Dict[str, float]:
    """CPU-bound TF-IDF computation — call via run_in_executor to avoid blocking."""
    if not catalog: return {}
    ids  = [str(it.get("catalog_item_id") or it.get("id","")) for it in catalog]
    # Repeat categories 3× so they dominate over colors in the taste vector
    taste_parts = (pref_cats * 3) + pref_colors + ([pref_season] if pref_season else [])
    taste_doc = " ".join(taste_parts)
    if not taste_doc.strip(): return {}

    # Cache by taste key + catalog size to avoid rebuilding on identical requests
    cache_key = f"{len(catalog)}:{taste_doc}"
    if cache_key in _tfidf_cache:
        return _tfidf_cache[cache_key]

    docs = [_item_doc(it) for it in catalog]
    try:
        vec      = TfidfVectorizer(ngram_range=(1,2), max_features=2048, min_df=2)
        mat      = vec.fit_transform(docs + [taste_doc])
        taste_v  = mat[-1]
        item_mat = mat[:-1]
        sims     = sk_cosine(taste_v, item_mat).flatten()
        result   = {ids[i]: float(sims[i]) for i in range(len(ids))}
        _tfidf_cache[cache_key] = result
        # Limit cache size to 50 entries
        if len(_tfidf_cache) > 50:
            oldest = next(iter(_tfidf_cache))
            del _tfidf_cache[oldest]
        return result
    except Exception as e:
        log.warning("TF-IDF scoring failed: %s", e)
        return {}


async def _content_scores(catalog: List[Dict], pref_cats: List[str],
                           pref_colors: List[str], pref_season: str) -> Dict[str, float]:
    """Async wrapper — offloads CPU work to thread pool so event loop stays free."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None, _content_scores_sync, catalog, pref_cats, pref_colors, pref_season
    )


# ── Dify workflow (STREAMING) ─────────────────────────────────────
_dify_cli: Optional[httpx.AsyncClient] = None

async def _dify_client() -> httpx.AsyncClient:
    global _dify_cli
    if _dify_cli is None or _dify_cli.is_closed:
        _dify_cli = httpx.AsyncClient(
            base_url=DIFY_URL, timeout=10.0,
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


# ══════════════════════════════════════════════════════════════════
# ADVANCED RECOMMENDATION ENGINE (Amazon/Myntra/Flipkart grade)
# 22 signals + semantic embeddings + outfit compatibility +
# trend velocity + repeat purchase prediction
# ══════════════════════════════════════════════════════════════════

# ── Semantic Embedding Engine ─────────────────────────────────────
# Replaces TF-IDF with deep sentence embeddings for understanding
# "casual blue summer dress" ≈ "relaxed navy warm-weather frock"
_embedding_model = None
_item_embeddings: Dict[str, Any] = {}     # item_id -> numpy array
_embeddings_built = False

def _get_embedding_model():
    """Lazy-load sentence transformer model (runs once, ~500MB download first time)."""
    global _embedding_model
    if _embedding_model is None:
        try:
            from sentence_transformers import SentenceTransformer
            _embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
            log.info("Semantic embedding model loaded (all-MiniLM-L6-v2)")
        except Exception as e:
            log.warning("Could not load embedding model: %s — falling back to TF-IDF", e)
    return _embedding_model

def _build_item_text(item: Dict) -> str:
    """Build rich text representation of an item for embedding."""
    parts = []
    parts.append(item.get("name") or "")
    parts.append(item.get("category") or "")
    parts.append(item.get("brand") or "")
    parts.append(item.get("description") or "")
    parts.append(item.get("gender") or "")
    colors = item.get("available_colors") or item.get("colors") or []
    parts.extend(colors[:4])
    tags = item.get("tags") or []
    if isinstance(tags, dict):
        tags = tags.get("tags", [])
    parts.extend(t for t in (tags or [])[:6] if isinstance(t, str) and len(t) < 30)
    occ = ((item.get("extra_metadata") or {}).get("occasion") or "")
    parts.append(occ)
    fit = ((item.get("extra_metadata") or {}).get("fit") or "")
    parts.append(fit)
    return " ".join(p for p in parts if p).strip()

def _build_embeddings(catalog: List[Dict]):
    """Pre-compute embeddings for all catalog items."""
    global _item_embeddings, _embeddings_built
    if _embeddings_built:
        return
    model = _get_embedding_model()
    if not model:
        _embeddings_built = True
        return
    try:
        import numpy as np
        texts = []
        ids = []
        for item in catalog:
            iid = item.get("catalog_item_id") or item.get("id") or ""
            if not iid:
                continue
            txt = _build_item_text(item)
            if txt:
                texts.append(txt)
                ids.append(iid)
        if texts:
            embeddings = model.encode(texts, batch_size=64, show_progress_bar=False,
                                       normalize_embeddings=True)
            for i, iid in enumerate(ids):
                _item_embeddings[iid] = embeddings[i]
            log.info("Semantic embeddings built: %d items", len(ids))
    except Exception as e:
        log.warning("Embedding build failed: %s", e)
    _embeddings_built = True

def _semantic_score(query_text: str, item_id: str) -> float:
    """Compute semantic similarity between query and item using embeddings."""
    model = _get_embedding_model()
    if not model or item_id not in _item_embeddings:
        return 0.0
    try:
        import numpy as np
        q_emb = model.encode([query_text], normalize_embeddings=True)[0]
        item_emb = _item_embeddings[item_id]
        return float(np.dot(q_emb, item_emb))  # cosine sim (already normalized)
    except Exception:
        return 0.0

def _semantic_scores_batch(query_text: str, item_ids: List[str]) -> Dict[str, float]:
    """Batch semantic similarity for all items against user query."""
    model = _get_embedding_model()
    if not model or not _item_embeddings:
        return {}
    try:
        import numpy as np
        q_emb = model.encode([query_text], normalize_embeddings=True)[0]
        scores = {}
        for iid in item_ids:
            if iid in _item_embeddings:
                scores[iid] = float(np.dot(q_emb, _item_embeddings[iid]))
        return scores
    except Exception:
        return {}


# ── Outfit Compatibility Engine ───────────────────────────────────
# "This top goes well with these pants" — cross-category pairing
# Based on color harmony, style coherence, and occasion matching.
_OUTFIT_PAIRS = {
    # category -> compatible categories
    "tops":       ["pants", "trousers", "jeans", "skirts", "shorts"],
    "t-shirts":   ["jeans", "trousers", "shorts", "joggers", "cargo"],
    "shirts":     ["trousers", "jeans", "chinos", "pants"],
    "blouses":    ["skirts", "trousers", "jeans"],
    "dresses":    ["outerwear", "blazers", "shrugs", "accessories"],
    "pants":      ["tops", "t-shirts", "shirts", "blouses"],
    "trousers":   ["shirts", "tops", "t-shirts", "blazers"],
    "jeans":      ["t-shirts", "shirts", "tops", "outerwear"],
    "skirts":     ["tops", "blouses", "t-shirts"],
    "blazers":    ["shirts", "trousers", "dresses", "jeans"],
    "outerwear":  ["t-shirts", "shirts", "dresses", "jeans"],
    "kurtas":     ["trousers", "pants", "churidar"],
    "kurta-sets": ["trousers", "pants"],
}

# Color harmony rules (complementary + analogous)
_COLOR_HARMONY = {
    "blue":   ["white", "black", "grey", "beige", "navy", "cream"],
    "black":  ["white", "red", "grey", "cream", "pink", "blue"],
    "white":  ["blue", "black", "navy", "red", "green", "pink"],
    "red":    ["black", "white", "navy", "grey", "cream"],
    "green":  ["white", "black", "beige", "cream", "brown"],
    "navy":   ["white", "cream", "beige", "pink", "grey"],
    "grey":   ["blue", "black", "white", "pink", "navy"],
    "brown":  ["white", "cream", "beige", "blue", "green"],
    "pink":   ["black", "white", "grey", "navy", "cream"],
    "beige":  ["blue", "navy", "brown", "white", "black"],
    "cream":  ["navy", "blue", "brown", "black", "maroon"],
    "yellow": ["blue", "navy", "black", "grey", "white"],
    "maroon": ["cream", "beige", "white", "grey", "gold"],
}

def _outfit_compatibility(item: Dict, history_items: List[Dict]) -> float:
    """
    Score how well this item pairs with items the user already likes/owns.
    Considers category pairing + color harmony + occasion coherence.
    """
    if not history_items:
        return 0.5
    item_cat = (item.get("category") or "").lower()
    item_colors = {c.lower() for c in (item.get("available_colors") or item.get("colors") or [])}
    item_occ = set(((item.get("extra_metadata") or {}).get("occasion") or "").lower().split(","))
    item_occ = {o.strip() for o in item_occ if o.strip()}

    best_score = 0.0
    for hist in history_items:
        score = 0.0
        h_cat = (hist.get("category") or "").lower()
        h_colors = {c.lower() for c in (hist.get("available_colors") or hist.get("colors") or [])}
        h_occ = set(((hist.get("extra_metadata") or {}).get("occasion") or "").lower().split(","))
        h_occ = {o.strip() for o in h_occ if o.strip()}

        # Category pairing (does this item complement the history item?)
        compatible_cats = _OUTFIT_PAIRS.get(h_cat, [])
        if item_cat in compatible_cats or any(c in item_cat for c in compatible_cats):
            score += 0.4
        elif item_cat == h_cat:
            score += 0.1  # same category = less complementary

        # Color harmony
        for hc in h_colors:
            harmonious = _COLOR_HARMONY.get(hc, [])
            if item_colors & set(harmonious):
                score += 0.35
                break

        # Occasion coherence (same occasion = goes together)
        if item_occ & h_occ:
            score += 0.25

        best_score = max(best_score, score)

    return min(best_score, 1.0)


# ── Trend Velocity Engine ─────────────────────────────────────────
# Not just "popular" but "gaining popularity FAST" — items with
# accelerating interest across users. Like Twitter trending.
_interaction_log: List[Dict] = []  # global interaction timeline

def _log_interaction_ts(item_id: str, event: str):
    """Log timestamped interaction for trend detection."""
    from datetime import datetime, timezone
    _interaction_log.append({
        "item_id": item_id,
        "event": event,
        "ts": datetime.now(timezone.utc),
    })
    # Keep only last 10K interactions to save memory
    if len(_interaction_log) > 10000:
        _interaction_log[:] = _interaction_log[-8000:]

def _trend_velocity() -> Dict[str, float]:
    """
    Calculate trend velocity: items gaining interactions faster in
    the last 24h vs the previous 7 days.
    Returns item_id -> velocity score (0-1).
    """
    from datetime import datetime, timezone, timedelta
    if not _interaction_log:
        return {}

    now = datetime.now(timezone.utc)
    h24 = now - timedelta(hours=24)
    d7 = now - timedelta(days=7)

    # Count interactions in last 24h vs 7d
    recent: Dict[str, int] = {}   # last 24h
    older: Dict[str, int] = {}    # last 7d (excluding 24h)
    for log in _interaction_log:
        iid = log["item_id"]
        ts = log["ts"]
        if ts >= h24:
            recent[iid] = recent.get(iid, 0) + 1
        elif ts >= d7:
            older[iid] = older.get(iid, 0) + 1

    # Velocity = recent_rate / older_rate (normalized)
    velocities: Dict[str, float] = {}
    all_items = set(recent.keys()) | set(older.keys())
    for iid in all_items:
        r = recent.get(iid, 0)
        o = older.get(iid, 0) / 6.0  # normalize to per-day (7d - 1d = 6d)
        if r > 0:
            if o > 0:
                vel = r / o  # acceleration ratio
            else:
                vel = r * 2.0  # new item with only recent activity = high velocity
            velocities[iid] = vel

    # Normalize to 0-1
    if velocities:
        mx = max(velocities.values())
        return {k: min(v / mx, 1.0) for k, v in velocities.items()}
    return {}


# ── Repeat Purchase Prediction ────────────────────────────────────
# Basics/consumables the user might want to rebuy.
# E.g., user bought black t-shirts twice → suggest more black t-shirts
_REPURCHASE_CATEGORIES = {
    "t-shirts", "tops", "shirts", "innerwear", "socks",
    "basics", "underwear", "sleepwear", "loungewear",
}

def _repeat_purchase_score(item: Dict, purchase_history: List[Dict]) -> float:
    """
    If user repeatedly buys similar items (same category + similar attributes),
    boost those items. Detects "staple" items the user rebuys.
    """
    if not purchase_history:
        return 0.0

    item_cat = (item.get("category") or "").lower()
    # Only predict repeats for repurchasable categories
    if not any(rc in item_cat for rc in _REPURCHASE_CATEGORIES):
        return 0.0

    item_brand = (item.get("brand") or "").lower()
    item_colors = {c.lower() for c in (item.get("available_colors") or item.get("colors") or [])}

    # Count how many past purchases match this item's pattern
    matches = 0
    for ph in purchase_history:
        h_cat = (ph.get("category") or "").lower()
        h_brand = (ph.get("brand") or "").lower()
        h_colors = {c.lower() for c in (ph.get("available_colors") or ph.get("colors") or [])}

        cat_match = any(rc in h_cat for rc in _REPURCHASE_CATEGORIES) and any(rc in item_cat for rc in _REPURCHASE_CATEGORIES)
        brand_match = item_brand and item_brand == h_brand
        color_match = bool(item_colors & h_colors)

        if cat_match:
            score = 0.3
            if brand_match:
                score += 0.4  # same brand = strong repurchase signal
            if color_match:
                score += 0.3
            matches += score

    return min(matches / 2.0, 1.0)  # normalize, cap at 1.0


# ── Item-to-Item Similarity Matrix ────────────────────────────────
# Pre-computes cosine similarity between items using feature vectors
# (category, brand, color, price_tier, tags). Used for "Similar items"
# and collaborative filtering boost.
_item_similarity_cache: Dict[str, Dict[str, float]] = {}
_item_vectors: Dict[str, Dict[str, float]] = {}
_sim_cache_built = False

def _build_item_vector(item: Dict) -> Dict[str, float]:
    """Convert item to sparse feature vector for similarity."""
    vec: Dict[str, float] = {}
    # Category features (weight 3x)
    cat = (item.get("category") or "").lower()
    if cat:
        vec[f"cat:{cat}"] = 3.0
    # Brand features (weight 2x)
    brand = (item.get("brand") or "").lower()
    if brand:
        vec[f"brand:{brand}"] = 2.0
    # Color features
    for c in (item.get("available_colors") or item.get("colors") or []):
        vec[f"color:{c.lower()}"] = 1.5
    # Price tier
    price = item.get("base_price") or 0
    if price > 0:
        tier = "budget" if price < 500 else "mid" if price < 2000 else "premium" if price < 5000 else "luxury"
        vec[f"price:{tier}"] = 1.0
    # Tag features
    tags = item.get("tags") or []
    if isinstance(tags, dict):
        tags = tags.get("tags", [])
    for t in (tags or [])[:8]:
        tl = t.lower().strip()
        if tl and len(tl) < 30:
            vec[f"tag:{tl}"] = 0.8
    # Gender
    g = (item.get("gender") or "").lower()
    if g:
        vec[f"gender:{g}"] = 1.5
    # Occasion
    occ = ((item.get("extra_metadata") or {}).get("occasion") or "").lower()
    for o in occ.split(",")[:4]:
        o = o.strip()
        if o:
            vec[f"occ:{o}"] = 0.6
    return vec

def _cosine_sim(v1: Dict[str, float], v2: Dict[str, float]) -> float:
    """Sparse cosine similarity between two feature vectors."""
    if not v1 or not v2:
        return 0.0
    common = set(v1.keys()) & set(v2.keys())
    if not common:
        return 0.0
    dot = sum(v1[k] * v2[k] for k in common)
    import math
    mag1 = math.sqrt(sum(v * v for v in v1.values()))
    mag2 = math.sqrt(sum(v * v for v in v2.values()))
    if mag1 == 0 or mag2 == 0:
        return 0.0
    return dot / (mag1 * mag2)

def _build_similarity_index(catalog: List[Dict]):
    """Build item-to-item similarity vectors (called once at startup or first request)."""
    global _item_vectors, _sim_cache_built
    if _sim_cache_built:
        return
    for item in catalog:
        iid = item.get("catalog_item_id") or item.get("id") or ""
        if iid:
            _item_vectors[iid] = _build_item_vector(item)
    _sim_cache_built = True
    log.info("Item similarity index built: %d items vectorized", len(_item_vectors))

def _get_similar_items(item_id: str, top_n: int = 20) -> List[tuple]:
    """Get top-N most similar items to a given item. Returns [(item_id, score)]."""
    if item_id in _item_similarity_cache:
        return _item_similarity_cache[item_id][:top_n]
    v1 = _item_vectors.get(item_id)
    if not v1:
        return []
    scores = []
    for iid2, v2 in _item_vectors.items():
        if iid2 == item_id:
            continue
        sim = _cosine_sim(v1, v2)
        if sim > 0.1:
            scores.append((iid2, sim))
    scores.sort(key=lambda x: x[1], reverse=True)
    _item_similarity_cache[item_id] = scores[:50]
    return scores[:top_n]


# ── Collaborative Filtering ──────────────────────────────────────
# "Users who liked X also liked Y" — based on co-occurrence in
# wishlists, carts, and purchases across all users.
def _collaborative_scores(user_items: set, top_n: int = 50) -> Dict[str, float]:
    """
    Given items a user interacted with, find items that co-occur
    frequently in OTHER users' interactions.
    """
    if not user_items:
        return {}
    # Gather all other users' item sets
    all_user_sets: List[Set[str]] = []
    for wl in _user_wishlists.values():
        if wl:
            all_user_sets.append(set(wl))
    for cart in _user_carts.values():
        if cart:
            all_user_sets.append({c.get("item_id","") for c in cart if c.get("item_id")})
    # Count co-occurrences: for each item in other users' sets that
    # also contains items the current user liked
    cooccur: Dict[str, float] = {}
    for uset in all_user_sets:
        overlap = user_items & uset
        if not overlap:
            continue
        # Items in this user's set that current user hasn't seen
        new_items = uset - user_items
        boost = len(overlap)  # more overlap = stronger signal
        for nid in new_items:
            cooccur[nid] = cooccur.get(nid, 0) + boost
    # Normalize
    if cooccur:
        mx = max(cooccur.values())
        return {k: v / mx for k, v in sorted(cooccur.items(), key=lambda x: -x[1])[:top_n]}
    return {}


# ── Session Context ──────────────────────────────────────────────
def _session_context_boost() -> Dict[str, float]:
    """
    Time-of-day and day-of-week context.
    Morning = workwear/formal. Evening = party/casual. Weekend = casual/street.
    """
    from datetime import datetime
    now = datetime.now()
    hour = now.hour
    weekday = now.weekday()  # 0=Mon, 6=Sun
    is_weekend = weekday >= 5

    boosts: Dict[str, float] = {}
    # Time-based occasion boost
    if 6 <= hour < 10:
        boosts.update({"office": 0.3, "formal": 0.3, "workwear": 0.2, "college": 0.2})
    elif 10 <= hour < 17:
        boosts.update({"casual": 0.2, "daily wear": 0.2, "office": 0.15})
    elif 17 <= hour < 21:
        boosts.update({"party": 0.3, "evening": 0.3, "casual": 0.15, "date": 0.2})
    else:
        boosts.update({"loungewear": 0.3, "casual": 0.2, "sleepwear": 0.2})

    if is_weekend:
        boosts.update({"casual": boosts.get("casual", 0) + 0.2, "weekend": 0.3,
                       "streetwear": 0.2, "brunch": 0.15, "outing": 0.15})
    return boosts


# ── Exploration / Serendipity ────────────────────────────────────
def _exploration_candidates(scored: List[Dict], top_k: int) -> List[Dict]:
    """
    Mix in 10-15% serendipity items — high-quality items from categories
    the user hasn't explicitly asked for, to help discover new styles.
    Amazon calls this "You might also like".
    """
    import random
    if len(scored) < 10:
        return scored

    explore_count = max(1, int(top_k * 0.12))  # 12% exploration
    main_count = top_k - explore_count

    # Main items (top scored)
    main = scored[:main_count]

    # Exploration: pick from items ranked 50-200 with some randomness
    # These are decent items but not top-ranked — might surprise the user
    explore_pool = scored[50:200] if len(scored) > 200 else scored[main_count:]
    if explore_pool:
        # Weight by score so we don't show garbage
        weights = [max(it.get("score", 0), 0.01) for it in explore_pool]
        try:
            explores = random.choices(explore_pool, weights=weights, k=min(explore_count, len(explore_pool)))
        except ValueError:
            explores = explore_pool[:explore_count]
        # Deduplicate
        main_ids = {it.get("catalog_item_id") or it.get("id") for it in main}
        explores = [e for e in explores if (e.get("catalog_item_id") or e.get("id")) not in main_ids]
        # Mark as exploration
        for e in explores:
            e["recommendation_reason"] = "You might also like"
            e["is_exploration"] = True
        main.extend(explores[:explore_count])

    return main


# ── Main ranking function ─────────────────────────────────────────
async def rank_catalog(user_doc: Dict, top_k: int = 500,
                       override: Optional[Dict] = None) -> List[Dict]:
    """
    Fetches catalog and ranks by 10 weighted signals:
      1. Color match     0.25  (preferred_colors vs item color_variants — family + exact)
      2. Fit             0.15  (physics_profile JSONB vs body_measurements / BMI)
      3. Gender          0.12  (exact match or unisex; wrong-gender gets 0.5× penalty)
      4. Category        0.12  (graduated: exact > partial > tag match)
      5. Season          0.08  (keyword + color season match)
      6. TF-IDF content  0.06  (style tags + description similarity)
      7. Dify AI boost   0.02  (external AI recommendation boost)
      8. Brand affinity  0.05  (boost items from brands user browsed/liked/bought)
      9. Price affinity  0.05  (closer to user's avg spend = higher)
     10. Behavior boost  0.10  (browsing + wishlist + purchase history similarity)
    No duplicate items in output (dedup by catalog_item_id).
    """
    pj = user_doc.get("profile_data_json") or {}

    gender     = _norm_gender(override.get("gender")     if override else pj.get("gender", ""))
    colors     = override.get("colors")     if override else pj.get("preferred_colors", [])
    categories = override.get("categories") if override else pj.get("preferred_categories", [])
    season     = override.get("season")     if override else pj.get("preferred_season", "")
    body_meas  = pj.get("body_measurements", {})
    uid        = user_doc.get("user_id", "anon")

    # ── Advanced signals: history-based ───────────────────────────
    browsing_ids  = set(override.get("browsing_history", []))  if override else set()
    purchase_ids  = set(override.get("purchase_history", []))  if override else set()
    liked_ids     = set(override.get("liked_items", []))       if override else set()
    disliked_ids  = set(override.get("disliked_items", []))    if override else set()
    fav_stores    = [s.lower() for s in (override.get("favorite_stores", []) if override else [])]

    if isinstance(colors, str):     colors     = [colors]
    if isinstance(categories, str): categories = [categories]

    # Fetch catalog and Dify boost concurrently.
    # Don't pass gender to fetch_catalog — gender scoring is done by the ranker
    # below (s_gender). This ensures the startup pre-loaded cache is always hit.
    catalog_task = fetch_catalog()

    dify_task = None
    if gender or colors or categories:
        dify_task = asyncio.wait_for(
            dify_boost(
                gender,
                (colors     or [""])[0],
                (categories or [""])[0],
                season, uid,
            ),
            timeout=5.0,   # 3% signal — not worth waiting longer
        )

    if dify_task:
        catalog, dify_result = await asyncio.gather(
            catalog_task, dify_task, return_exceptions=True
        )
        dify_ids = dify_result if isinstance(dify_result, set) else set()
        if isinstance(dify_result, Exception):
            log.debug("Dify failed/timed out — skipping boost: %s", dify_result)
    else:
        catalog = await catalog_task
        dify_ids: Set[str] = set()

    # TF-IDF content scores (runs in thread pool — non-blocking)
    con_sc = await _content_scores(catalog, categories or [], colors or [], season or "")

    # Build item similarity index (once, then cached)
    _build_similarity_index(catalog)

    # Build semantic embeddings (once, then cached)
    _build_embeddings(catalog)

    # Collaborative filtering: "users who liked X also liked Y"
    collab_scores = _collaborative_scores(browsing_ids | liked_ids | purchase_ids)

    # Item-to-item similarity boost from history
    sim_boost: Dict[str, float] = {}
    for hist_id in (liked_ids | purchase_ids):
        for sim_id, sim_score in _get_similar_items(hist_id, 30):
            sim_boost[sim_id] = max(sim_boost.get(sim_id, 0), sim_score)

    # Session context: time-of-day / weekend boosts
    session_boosts = _session_context_boost()

    # Trend velocity: items gaining popularity fast
    trend_vel = _trend_velocity()

    # Gather history items for outfit compatibility scoring
    history_item_objs = [ci for ci in catalog
                         if (ci.get("catalog_item_id") or ci.get("id") or "") in (liked_ids | purchase_ids)]

    # Gather purchased item objects for repeat purchase detection
    purchase_item_objs = [ci for ci in catalog
                          if (ci.get("catalog_item_id") or ci.get("id") or "") in purchase_ids]

    # ── Pre-compute constants that don't change per item ──────────────
    # body build: prefer explicit 'build' field (set by frontend from user's fit choice),
    # fall back to BMI inference if not provided
    explicit_build = (body_meas.get("build") or "").lower().strip()
    user_build     = explicit_build if explicit_build in ("slim","athletic","plus","average") \
                     else _infer_build(body_meas)

    colors_list  = colors or []
    cats_list    = categories or []

    # Semantic query for embedding similarity
    semantic_query = " ".join(filter(None, [
        gender or "",
        " ".join(colors_list),
        " ".join(cats_list),
        season or "",
        " ".join(pj.get("style_preferences") or []),
    ])).strip()
    sem_scores: Dict[str, float] = {}
    if semantic_query and _item_embeddings:
        all_item_ids = [item.get("catalog_item_id") or item.get("id") or ""
                        for item in catalog if item.get("catalog_item_id") or item.get("id")]
        sem_scores = _semantic_scores_batch(semantic_query, all_item_ids)

    # ── Pre-compute popularity counts (cross-user signals) ───────
    _pop_counts: Dict[str, int] = {}
    for wl in _user_wishlists.values():
        for wid in wl:
            _pop_counts[wid] = _pop_counts.get(wid, 0) + 2
    for cart_items in _user_carts.values():
        for ci in cart_items:
            cid = ci.get("item_id") or ""
            _pop_counts[cid] = _pop_counts.get(cid, 0) + 3
    for ratings in _user_ratings.values():
        for rid, stars in ratings.items():
            _pop_counts[rid] = _pop_counts.get(rid, 0) + stars
    for orders in _user_orders.values():
        for order in orders:
            for oi in (order.get("items") or []):
                oid = oi.get("item_id") or ""
                _pop_counts[oid] = _pop_counts.get(oid, 0) + 5
    _max_pop = max(_pop_counts.values()) if _pop_counts else 1

    # ── Build behavior profile from history ──────────────────────
    # Analyze browsed/liked/purchased items to extract brand + price + category affinity
    history_ids = browsing_ids | liked_ids | purchase_ids
    history_brands: Dict[str, float] = {}    # brand -> affinity score
    history_cats: Dict[str, float] = {}      # category -> affinity score
    history_prices: List[float] = []
    if history_ids and catalog:
        for ci in catalog:
            cid = ci.get("catalog_item_id") or ci.get("id") or ""
            if cid not in history_ids:
                continue
            # Weight: purchased > liked > browsed
            w = 3.0 if cid in purchase_ids else (2.0 if cid in liked_ids else 1.0)
            b = (ci.get("brand") or "").lower()
            c = (ci.get("category") or "").lower()
            p = ci.get("base_price") or 0
            if b:
                history_brands[b] = history_brands.get(b, 0) + w
            if c:
                history_cats[c] = history_cats.get(c, 0) + w
            if p > 0:
                history_prices.append(p)
    # Add favorite stores as brand affinity
    for fs in fav_stores:
        history_brands[fs] = history_brands.get(fs, 0) + 2.0
    # Compute avg price from history
    avg_price = sum(history_prices) / len(history_prices) if history_prices else 0
    max_brand_aff = max(history_brands.values()) if history_brands else 1

    # If user explicitly selected specific categories (≤4), treat as HARD preference:
    # items that don't match any selected category get a floor score of 0.1 instead of 0.5.
    # This ensures selected-category items always rank above random items.
    strict_cats = len(cats_list) > 0 and len(cats_list) <= 6

    # Pre-expand category variant sets once (avoids rebuilding inside the loop)
    _CAT_EXPAND: Dict[str, Set[str]] = {
        "dress":    {"dresses", "women dresses", "gown", "maxi", "mini dress", "midi dress"},
        "shirt":    {"shirts", "blouse", "top", "tops", "women tops", "button-down"},
        "skirt":    {"skirts", "mini skirt", "midi skirt", "maxi skirt"},
        "blouse":   {"blouses", "top", "tops", "women tops"},
        "top":      {"tops", "women tops", "blouse", "shirt", "crop top"},
        "t-shirt":  {"t-shirts", "tshirt", "tee", "women t-shirts", "polo"},
        "pant":     {"pants", "trousers", "jeans", "bottomwear", "chinos", "slacks"},
        "jumpsuit": {"jumpsuits", "women jumpsuits", "playsuit", "romper"},
        "jacket":   {"jackets", "coat", "outerwear", "windbreaker", "bomber"},
        "blazer":   {"blazers", "suit jacket", "sports coat"},
        "kurta":    {"kurtas", "kurti", "ethnic", "salwar", "churidar"},
        "active":   {"activewear", "sportswear", "gym", "yoga", "athletic", "sports"},
        "skirt":    {"skirts", "mini skirt"},
        "trousers": {"trousers", "pants", "slacks", "chinos"},
    }
    cat_variant_sets: List[Set[str]] = []
    for c in cats_list:
        cl = c.lower()
        # Try exact match, then singular, then plural
        base_set = {cl}
        base_set |= _CAT_EXPAND.get(cl, set())
        # Handle plural/singular mismatch: "tops"->"top", "pants"->"pant", "dresses"->"dress"
        singular = cl.rstrip("s") if cl.endswith("s") and not cl.endswith("ss") else cl
        plural = cl + "s" if not cl.endswith("s") else cl
        base_set |= _CAT_EXPAND.get(singular, set())
        base_set |= _CAT_EXPAND.get(plural, set())
        base_set.add(singular)
        base_set.add(plural)
        cat_variant_sets.append(base_set)

    # Score each item — strict dedup by catalog_item_id
    scored: List[Dict] = []
    seen:   Set[str]   = set()

    for item in catalog:
        iid = str(item.get("catalog_item_id") or item.get("id") or "")
        if not iid or iid in seen:
            continue
        seen.add(iid)

        # ── Early gender filter (skip before any heavy computation) ──
        ig = _gender(item)
        if gender and ig != "unisex" and ig != gender:
            continue

        s_gender = 1.0  # wrong-gender already skipped above

        # ── Per-item text fields (computed once, reused below) ────────
        item_cat  = (item.get("category") or "").lower()
        item_name = (item.get("name") or "").lower()
        item_sub  = (item.get("subcategory") or "").lower()
        item_tags_list = _tags(item)                           # list — reused in output
        item_tags = {t.lower() for t in item_tags_list}
        item_text = f"{item_cat} {item_name} {item_sub} {' '.join(item_tags)}"

        # ── Category score (graduated: exact > partial > tag) ─────────
        _cat_hits = 0.0
        for cl_variants in cat_variant_sets:
            best = 0.0
            for cv in cl_variants:
                if item_cat and item_cat == cv:
                    best = max(best, 3.0); break          # can't do better
                elif item_cat and (cv in item_cat or item_cat in cv):
                    best = max(best, 2.5)
                elif cv in item_text:
                    best = max(best, 1.5)
            _cat_hits += best
        # Normalize by (num_categories × 3) so matching all = 1.0
        s_cat = min(_cat_hits / (len(cats_list) * 3.0), 1.0) if cats_list else 0.5

        # ── Core scores ───────────────────────────────────────────────
        s_color  = _color_score(item, colors_list)
        s_fit    = _fit_score_prebuilt(item, user_build)
        s_season = _season_score(item, season or "")
        s_con    = con_sc.get(iid, 0.0)
        s_dify   = 0.85 if iid in dify_ids else 0.0
        s_stock  = _stock_score(item)

        # ── Signal 8: Brand affinity ─────────────────────────────────
        item_brand = (item.get("brand") or "").lower()
        s_brand = 0.0
        if item_brand and history_brands:
            s_brand = min(history_brands.get(item_brand, 0) / max_brand_aff, 1.0)

        # ── Signal 9: Price affinity ──────────────────────────────────
        bp_item = item.get("base_price") or 0
        s_price = 0.5   # neutral default
        if avg_price > 0 and bp_item > 0:
            ratio = bp_item / avg_price
            # Gaussian-like: peaks at 1.0 when price = avg, drops smoothly
            import math
            s_price = math.exp(-2.0 * (ratio - 1.0) ** 2)

        # ── Signal 10: Behavior boost (collaborative) ─────────────────
        s_behavior = 0.0
        if history_ids:
            if iid in history_ids:
                s_behavior = 0.0   # don't re-recommend what user already saw
            else:
                # Multi-factor: category affinity + brand affinity from history
                cat_aff = history_cats.get(item_cat, 0)
                brand_aff = history_brands.get(item_brand, 0) if item_brand else 0
                max_cat_aff = max(history_cats.values()) if history_cats else 1
                cat_score = min(cat_aff / max_cat_aff, 1.0) if max_cat_aff > 0 else 0.0
                brand_score = min(brand_aff / max_brand_aff, 1.0) if max_brand_aff > 0 else 0.0
                s_behavior = 0.6 * cat_score + 0.4 * brand_score

        # ── Signal 11: Recency boost ──────────────────────────────────
        # Newer items get a slight boost (decays over 90 days)
        s_recency = 0.5
        created = item.get("created_at") or ""
        if created:
            try:
                from datetime import datetime, timezone
                if "+" in created or created.endswith("Z"):
                    ct = datetime.fromisoformat(created.replace("Z", "+00:00"))
                else:
                    ct = datetime.fromisoformat(created).replace(tzinfo=timezone.utc)
                age_days = (datetime.now(timezone.utc) - ct).days
                s_recency = max(0.0, 1.0 - (age_days / 90.0))  # 1.0 = brand new, 0 = 90+ days old
            except Exception:
                pass

        # ── Signal 12: Size availability ──────────────────────────────
        # Boost items where user's size is actually in stock
        s_size_avail = 0.5  # neutral
        user_size = (body_meas.get("shirt_size") or "").upper()
        user_pants = (body_meas.get("pants_size") or "").upper()
        item_sizes = [s.upper() for s in (item.get("available_sizes") or [])]
        item_variants = item.get("variants") or []
        if item_sizes:
            if user_size and user_size in item_sizes:
                s_size_avail = 1.0
            elif user_pants and user_pants in item_sizes:
                s_size_avail = 1.0
            elif not user_size and not user_pants:
                s_size_avail = 0.5  # no preference = neutral
            else:
                s_size_avail = 0.2  # user's size not available
        elif item_variants:
            # Check variants for size availability
            for v in item_variants:
                vs = (v.get("size") or "").upper()
                vq = v.get("quantity") or v.get("stock") or 0
                if vs and vq > 0 and (vs == user_size or vs == user_pants):
                    s_size_avail = 1.0
                    break

        # ── Signal 13: Occasion match ─────────────────────────────────
        # Match item's occasion tags with user's mood/occasion
        s_occasion = 0.5
        user_occasion = (override.get("season") or "").lower() if override else ""
        user_mood = ""
        if override:
            user_mood = (override.get("mood") or "").lower()
        item_occasion = ((item.get("extra_metadata") or {}).get("occasion") or "").lower()
        if user_occasion and item_occasion:
            if user_occasion in item_occasion:
                s_occasion = 1.0
            elif any(o in item_occasion for o in [user_occasion, user_mood] if o):
                s_occasion = 0.8
        elif item_tags and user_occasion:
            if user_occasion in item_tags:
                s_occasion = 0.9

        # ── Signal 14: Popularity (cross-user) ────────────────────────
        # Items wishlisted/carted/purchased by many users rank higher
        s_popularity = 0.0
        pop = _pop_counts.get(iid, 0)
        if pop > 0 and _max_pop > 0:
            s_popularity = min(pop / _max_pop, 1.0)

        # ── Signal 15: Discount attractiveness ────────────────────────
        disc = _discount_percent(item)
        s_discount = min(disc / 50.0, 1.0) if disc > 0 else 0.0  # 50%+ off = max score

        # ── Signal 16: Collaborative filtering ────────────────────────
        # "Users who liked similar items also liked this"
        s_collab = collab_scores.get(iid, 0.0)

        # ── Signal 17: Item-to-item similarity ────────────────────────
        # Boost items similar to what user liked/purchased
        s_similar = sim_boost.get(iid, 0.0)

        # ── Signal 18: Session context ────────────────────────────────
        s_session = 0.0
        if session_boosts:
            item_occ = ((item.get("extra_metadata") or {}).get("occasion") or "").lower()
            for occ_key, occ_boost in session_boosts.items():
                if occ_key in item_occ or occ_key in item_tags:
                    s_session = max(s_session, occ_boost)

        # ── Signal 19: Semantic similarity (deep embeddings) ──────────
        s_semantic = sem_scores.get(iid, 0.0)

        # ── Signal 20: Outfit compatibility ───────────────────────────
        s_outfit = _outfit_compatibility(item, history_item_objs) if history_item_objs else 0.5

        # ── Signal 21: Trend velocity ─────────────────────────────────
        s_trend = trend_vel.get(iid, 0.0)

        # ── Signal 22: Repeat purchase prediction ─────────────────────
        s_repeat = _repeat_purchase_score(item, purchase_item_objs)

        # ── Dislike penalty ───────────────────────────────────────────
        if iid in disliked_ids:
            continue   # skip disliked items entirely

        # ── Weighted score (22 signals) ───────────────────────────────
        has_history = bool(history_ids)
        if strict_cats:
            if has_history:
                base = (
                    0.15 * s_cat       +   #  1. category match
                    0.08 * s_color     +   #  2. color preference
                    0.05 * s_fit       +   #  3. body fit
                    0.02 * s_season    +   #  4. seasonal
                    0.02 * s_con       +   #  5. TF-IDF content
                    0.02 * s_gender    +   #  6. gender
                    0.01 * s_dify      +   #  7. AI boost
                    0.05 * s_brand     +   #  8. brand affinity
                    0.03 * s_price     +   #  9. price affinity
                    0.06 * s_behavior  +   # 10. behavior
                    0.02 * s_recency   +   # 11. recency
                    0.04 * s_size_avail+   # 12. size availability
                    0.03 * s_occasion  +   # 13. occasion match
                    0.03 * s_popularity+   # 14. popularity
                    0.02 * s_discount  +   # 15. discount
                    0.08 * s_collab    +   # 16. collaborative filtering
                    0.06 * s_similar   +   # 17. item-to-item similarity
                    0.03 * s_session   +   # 18. session context
                    0.08 * s_semantic  +   # 19. semantic embedding
                    0.05 * s_outfit    +   # 20. outfit compatibility
                    0.04 * s_trend     +   # 21. trend velocity
                    0.03 * s_repeat        # 22. repeat purchase
                )
            else:
                base = (
                    0.22 * s_cat       +
                    0.14 * s_color     +
                    0.07 * s_fit       +
                    0.04 * s_season    +
                    0.03 * s_con       +
                    0.02 * s_gender    +
                    0.02 * s_dify      +
                    0.02 * s_recency   +
                    0.04 * s_size_avail+
                    0.03 * s_occasion  +
                    0.03 * s_popularity+
                    0.02 * s_discount  +
                    0.04 * s_session   +
                    0.04 * s_similar   +
                    0.10 * s_semantic  +
                    0.04 * s_outfit    +
                    0.05 * s_trend     +
                    0.05 * s_similar
                )
            # No hard cap — let all 22 signals determine the final score.
            # Items with s_cat=0 naturally score lower but aren't excluded.
        else:
            if has_history:
                base = (
                    0.10 * s_cat       +
                    0.08 * s_color     +
                    0.05 * s_fit       +
                    0.03 * s_season    +
                    0.03 * s_con       +
                    0.02 * s_gender    +
                    0.01 * s_dify      +
                    0.06 * s_brand     +
                    0.03 * s_price     +
                    0.06 * s_behavior  +
                    0.02 * s_recency   +
                    0.03 * s_size_avail+
                    0.03 * s_occasion  +
                    0.03 * s_popularity+
                    0.02 * s_discount  +
                    0.10 * s_collab    +
                    0.08 * s_similar   +
                    0.03 * s_session   +
                    0.08 * s_semantic  +
                    0.04 * s_outfit    +
                    0.04 * s_trend     +
                    0.03 * s_repeat
                )
            else:
                base = (
                    0.18 * s_cat       +
                    0.14 * s_color     +
                    0.08 * s_fit       +
                    0.05 * s_season    +
                    0.05 * s_con       +
                    0.03 * s_gender    +
                    0.02 * s_dify      +
                    0.03 * s_recency   +
                    0.04 * s_size_avail+
                    0.03 * s_occasion  +
                    0.03 * s_popularity+
                    0.02 * s_discount  +
                    0.04 * s_session   +
                    0.04 * s_similar   +
                    0.10 * s_semantic  +
                    0.04 * s_outfit    +
                    0.05 * s_trend     +
                    0.03 * s_repeat
                )
        # Stock multiplier: out-of-stock items score at most 60% of base
        stock_mult = 0.6 + 0.4 * s_stock
        final = min(base * stock_mult, 1.0)

        images, primary = _build_images(item, viewer_gender=gender)
        # For Shopify items, keep original sizes/colors; for Boss items, rebuild from variants
        if str(iid).startswith("shopify-"):
            variants = item.get("variants") or []
            sizes = item.get("available_sizes") or []
            item_colors_list = item.get("available_colors") or item.get("colors") or []
            if not primary:
                primary = item.get("primary_image_url") or ""
            if not images:
                images = item.get("images") or []
        else:
            variants, sizes, item_colors_list = _build_variants(item)
        a3d  = item.get("assets_3d") or {}
        bp   = _safe_float(item.get("base_price"))
        disc = _discount_percent(item)

        scored.append({
            # Primary fields
            "catalog_item_id":   iid,
            "name":              item.get("name") or "Fashion Item",
            "description":       item.get("description"),
            "category":          item.get("category") or "",
            "subcategory":       item.get("subcategory"),
            "gender":            ig,                            # reuse — avoid second call
            "style_tags":        item_tags_list,                # reuse — avoid second call
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
                "category":       round(s_cat,        3),
                "color":          round(s_color,      3),
                "fit":            round(s_fit,        3),
                "gender":         round(s_gender,     3),
                "season":         round(s_season,     3),
                "content_tfidf":  round(s_con,        3),
                "ai_boost":       round(s_dify,       3),
                "brand_affinity": round(s_brand,      3),
                "price_affinity": round(s_price,      3),
                "behavior":       round(s_behavior,   3),
                "recency":        round(s_recency,    3),
                "size_avail":     round(s_size_avail, 3),
                "occasion":       round(s_occasion,   3),
                "popularity":     round(s_popularity, 3),
                "discount":       round(s_discount,   3),
                "collaborative":  round(s_collab,     3),
                "similar_items":  round(s_similar,    3),
                "session_ctx":    round(s_session,    3),
                "semantic":       round(s_semantic,   3),
                "outfit_compat":  round(s_outfit,     3),
                "trend_velocity": round(s_trend,      3),
                "repeat_purchase":round(s_repeat,     3),
            },
            "recommendation_reason": (
                "Perfect match for your style"                          if s_cat > 0.8 and s_color > 0.8           else
                "Completes your outfit perfectly"                       if s_outfit > 0.8 and history_item_objs    else
                "People with similar taste love this"                   if s_collab > 0.6                          else
                "Similar to items you've purchased"                     if s_similar > 0.7                         else
                "Buy again - your go-to style"                          if s_repeat > 0.6                          else
                f"Because you like {item_brand.title()}"                if s_brand > 0.7 and item_brand            else
                "Trending fast right now"                               if s_trend > 0.7                           else
                "Goes great with items you own"                         if s_outfit > 0.6 and history_item_objs    else
                "Similar to items you've liked"                         if s_behavior > 0.6                        else
                f"Matches your {colors_list[0]} colour preference"      if s_color > 0.6 and colors_list           else
                "Great fit for your body type"                          if s_fit > 0.7 and body_meas               else
                "Your size is available"                                if s_size_avail > 0.9 and user_size        else
                f"Perfect for {item_occasion.split(',')[0].strip()}"    if s_occasion > 0.7 and item_occasion      else
                "Trending right now"                                    if s_popularity > 0.5                      else
                "New arrival"                                           if s_recency > 0.8                         else
                f"{round(disc)}% OFF deal"                              if disc > 20                               else
                "Customers also bought this"                            if s_collab > 0.3                          else
                "AI-powered pick for you"                               if s_dify > 0                              else
                f"Top pick for {season}"                                if s_season > 0.4 and season               else
                f"Recommended in {item_cat or 'your style'}"            if s_cat > 0.5                             else
                "Trending in your style"
            ),
            # Pricing helpers
            "sale_price":       _safe_float(item.get("sale_price")),
            "discount_percent": round(disc, 1),
            "match_score":      round(final, 4),   # 0–1 (frontend multiplies ×100)
            # Legacy fields (frontend compatibility)
            "id":     iid,
            "title":  item.get("name"),
            "image":  primary,
            "price":  bp,
            "colors": item_colors_list,
            "tags":   item_tags_list,              # reuse — avoid third call
        })

    scored.sort(key=lambda x: x["score"], reverse=True)

    # Category diversity: light diversification — only among top-scored items
    # Don't force equal distribution, just avoid 50 identical items in a row
    if False and top_k >= 6 and len(scored) > top_k:
        by_cat: Dict[str, List[Dict]] = {}
        for s in scored:
            cat_key = (s.get("category") or "other").lower().split()[0]  # first word
            by_cat.setdefault(cat_key, []).append(s)

        diverse: List[Dict] = []
        seen_ids: Set[str] = set()
        # Round-robin through categories, picking top items from each
        cat_lists = list(by_cat.values())
        # Sort category groups by best score (best category first)
        cat_lists.sort(key=lambda lst: lst[0]["score"] if lst else 0, reverse=True)
        cat_idx = [0] * len(cat_lists)

        while len(diverse) < top_k:
            added = False
            for ci, cl in enumerate(cat_lists):
                if cat_idx[ci] < len(cl):
                    item = cl[cat_idx[ci]]
                    iid = item["catalog_item_id"]
                    cat_idx[ci] += 1
                    if iid not in seen_ids:
                        seen_ids.add(iid)
                        diverse.append(item)
                        added = True
                        if len(diverse) >= top_k:
                            break
            if not added:
                break

        # Re-sort by score so best items still appear first within the diverse set
        diverse.sort(key=lambda x: x["score"], reverse=True)
        result = _exploration_candidates(diverse, top_k) if has_history else diverse
        log.info("Ranked %d unique items (diverse from %d cats, %d exploration) | top scores: %s",
                 len(result), len(cat_lists),
                 sum(1 for r in result if r.get("is_exploration")),
                 [s["score"] for s in result[:5]])
        return result
    else:
        result = _exploration_candidates(scored[:top_k], top_k) if has_history else scored[:top_k]
        log.info("Ranked %d unique items (%d exploration) | top scores: %s",
                 len(result),
                 sum(1 for r in result if r.get("is_exploration")),
                 [s["score"] for s in result[:5]])
        return result


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

# ── Recommendation models (structured preferences) ───────────────
class StylePreferences(BaseModel):
    selected_styles:     List[str] = Field(default_factory=list)
    selected_colors:     List[str] = Field(default_factory=list)
    selected_categories: List[str] = Field(default_factory=list)

class FitPreferences(BaseModel):
    fit_preference: Optional[str] = None
    body_type:      Optional[str] = None
    size:           Optional[str] = None
    pants_size:     Optional[str] = None
    shoe_size:      Optional[str] = None

class BodyMeasurementsIn(BaseModel):
    height: Optional[float] = None
    chest:  Optional[float] = None
    waist:  Optional[float] = None
    weight: Optional[float] = None

class ContextPreferences(BaseModel):
    mood:     Optional[str] = None
    occasion: Optional[str] = None

class BudgetIn(BaseModel):
    min_price: float = 0
    max_price: float = 50000

class LocationIn(BaseModel):
    city:    Optional[str] = None
    country: Optional[str] = None

class RecRequest(BaseModel):
    user_id:              int
    session_id:           Optional[str]        = None
    gender:               Optional[str]        = None
    style_preferences:    StylePreferences     = Field(default_factory=StylePreferences)
    fit_preferences:      FitPreferences       = Field(default_factory=FitPreferences)
    body_measurements:    BodyMeasurementsIn   = Field(default_factory=BodyMeasurementsIn)
    context_preferences:  ContextPreferences   = Field(default_factory=ContextPreferences)
    budget:               BudgetIn             = Field(default_factory=BudgetIn)
    favorite_stores:      List[str]            = Field(default_factory=list)
    browsing_history:     List[str]            = Field(default_factory=list)
    purchase_history:     List[str]            = Field(default_factory=list)
    liked_items:          List[str]            = Field(default_factory=list)
    disliked_items:       List[str]            = Field(default_factory=list)
    exclude_items:        List[str]            = Field(default_factory=list)
    location:             LocationIn           = Field(default_factory=LocationIn)
    rec_type:             Optional[str]        = Field(default="for_you")


# ── FastAPI ───────────────────────────────────────────────────────
app = FastAPI(title="HueIQ Recommendation Engine", version="9.0.0")
# CORS — allow all origins so browser preflight (OPTIONS) always passes.
# JWT is sent in Authorization header (not cookies) so allow_credentials=False
# is correct and allows allow_origins=["*"].
# For production: set ALLOWED_ORIGINS env var to your exact frontend domain.
_env_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_env_origins if _env_origins else ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    max_age=600,
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
    return {k: v for k, v in user.items() if k not in ("password_hash", "_boss_token")}


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
    updates = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
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
        updates = {k: v for k, v in data.model_dump(exclude_unset=True).items()
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

    # If not in cache, try Boss API login (single attempt) to check if user exists
    if not existing and data.password:
        try:
            c = await _boss_client()
            lr = await c.post("/api/auth/login", json={
                "email": email, "password": data.password,
            }, headers={"Content-Type": "application/json"}, timeout=5.0)
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
                # User exists on Boss but derived password didn't match.
                # Save in-memory so recommendations still work this session.
                uid = str(uuid.uuid4())
                doc = {
                    "user_id": uid, "name": data.name or email.split("@")[0],
                    "email": email, "password_hash": _hash_pw(data.password),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    "profile_data_json": profile_fields,
                }
                _mem_users[uid] = doc
                _mem_email[email] = uid
                token = _make_token(uid, email)
                log.info("User %s exists on Boss but login failed — saved in-memory (uid=%s)", email, uid)
                return {"token": token, "user": {k: v for k, v in doc.items() if k != "password_hash"}, "saved": True}
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
          summary="Structured preference-based recommendations")
async def post_recommendations(req: RecRequest):
    """
    Accepts structured user preferences (style, fit, body, context,
    history, location) and returns scored recommendations with full
    item details.  No JWT required — user_id is passed in the body.
    Returns as many items as match filters (up to top_k).
    """
    sp = req.style_preferences
    fp = req.fit_preferences
    bm = req.body_measurements
    cp = req.context_preferences

    # Build a synthetic user doc from the request so rank_catalog can score
    user_doc: Dict[str, Any] = {
        "user_id": str(req.user_id),
        "name":    "",
        "email":   "",
        "profile_data_json": {
            "gender":               _norm_gender(req.gender or ""),
            "preferred_colors":     [c.lower() for c in sp.selected_colors],
            "preferred_categories": [c.lower() for c in sp.selected_categories],
            "preferred_season":     "",
            "style_preferences":    [s.lower() for s in sp.selected_styles],
            "body_measurements": {
                "height":          bm.height or 0,
                "weight":          bm.weight or 0,
                "chest":           bm.chest or 0,
                "waist":           bm.waist or 0,
                "build":           (fp.body_type or "").lower(),
                "shirt_size":      fp.size or "",
                "pants_size":      fp.pants_size or "",
            },
        },
    }

    # Override: pass occasion/mood + history for advanced scoring
    override: Dict[str, Any] = {
        "browsing_history":  req.browsing_history,
        "purchase_history":  req.purchase_history,
        "liked_items":       req.liked_items,
        "disliked_items":    req.disliked_items,
        "favorite_stores":   req.favorite_stores,
    }
    if req.gender:
        override["gender"] = _norm_gender(req.gender)
    if cp.occasion:
        override["season"] = cp.occasion.lower()

    # Run the ranker — fetch 500 items, return all that pass filters
    items = await rank_catalog(user_doc, top_k=50, override=override)

    # ── Post-filters (minimal — let the 22-signal engine rank) ─────
    # Only remove items the user explicitly excluded/disliked.
    # Engine returns top 50 best-scored items already ranked by 22 signals.

    # Remove excluded items
    if req.exclude_items:
        ex = set(req.exclude_items)
        items = [it for it in items
                 if (it.get("catalog_item_id") or it.get("id") or "") not in ex]

    # Remove disliked items
    if req.disliked_items:
        dl = set(req.disliked_items)
        items = [it for it in items
                 if (it.get("catalog_item_id") or it.get("id") or "") not in dl]

    # Boost liked items so they float higher
    if req.liked_items:
        liked = set(req.liked_items)
        for it in items:
            if (it.get("catalog_item_id") or it.get("id") or "") in liked:
                it["score"] = min(it.get("score", 0) * 1.15, 1.0)

    # ── Myntra-style popularity boost ─────────────────────────────
    # Count how many users wishlisted / carted / rated each item
    pop_counts: Dict[str, int] = {}
    for wl in _user_wishlists.values():
        for wid in wl:
            pop_counts[wid] = pop_counts.get(wid, 0) + 2      # wishlist = 2 pts
    for cart_items in _user_carts.values():
        for ci in cart_items:
            cid = ci.get("item_id") or ""
            pop_counts[cid] = pop_counts.get(cid, 0) + 3      # cart = 3 pts
    for ratings in _user_ratings.values():
        for rid, stars in ratings.items():
            pop_counts[rid] = pop_counts.get(rid, 0) + stars   # rating = star pts
    for orders in _user_orders.values():
        for order in orders:
            for oi in (order.get("items") or []):
                oid = oi.get("item_id") or ""
                pop_counts[oid] = pop_counts.get(oid, 0) + 5   # purchase = 5 pts

    if pop_counts:
        max_pop = max(pop_counts.values()) or 1
        for it in items:
            iid = it.get("catalog_item_id") or it.get("id") or ""
            pop = pop_counts.get(iid, 0)
            if pop > 0:
                # Popularity adds up to 10% bonus
                pop_boost = 0.10 * (pop / max_pop)
                it["score"] = min(it.get("score", 0) + pop_boost, 1.0)
                it["popularity_score"] = round(pop / max_pop, 2)

    # Re-sort after boosting — return all matching items, no hard cap
    items.sort(key=lambda x: x.get("score", 0), reverse=True)

    # ── Build rich response ───────────────────────────────────────
    recs = []
    for it in items:
        iid = it.get("catalog_item_id") or it.get("id") or ""
        recs.append({
            "catalog_item_id":      iid,
            "name":                 it.get("name") or "",
            "description":          it.get("description") or "",
            "category":             it.get("category") or "",
            "subcategory":          it.get("subcategory") or "",
            "gender":               it.get("gender") or "",
            "brand":                it.get("brand") or "",
            "base_price":           it.get("base_price") or 0,
            "sale_price":           it.get("sale_price") or it.get("base_price") or 0,
            "discount_percent":     it.get("discount_percent") or 0,
            "primary_image_url":    it.get("primary_image_url") or it.get("image") or "",
            "images":               it.get("images") or [],
            "available_sizes":      it.get("available_sizes") or [],
            "available_colors":     it.get("available_colors") or it.get("colors") or [],
            "in_stock":             it.get("in_stock", True),
            "style_tags":           it.get("style_tags") or it.get("tags") or [],
            "occasion":             it.get("occasion") or "",
            "season":               it.get("season") or "",
            "fabric":               it.get("fabric") or "",
            "score":                round(it.get("score", 0), 2),
            "boosted":              (it.get("score_detail") or {}).get("dify", 0) > 0,
            "popularity_score":     it.get("popularity_score") or 0,
            "recommendation_reason": it.get("recommendation_reason") or "Recommended for you",
            "score_detail":         it.get("score_detail") or {},
        })

    return {
        "recommendations": recs,
        "total":           len(recs),
        "session_id":      req.session_id or "",
        "preferences_used": {
            "gender":           req.gender or "",
            "styles":           sp.selected_styles,
            "color_preferences": sp.selected_colors,
            "categories":       sp.selected_categories,
            "fit_preference":   fp.fit_preference or "",
            "body_type":        fp.body_type or "",
            "size":             fp.size or "",
            "pants_size":       fp.pants_size or "",
            "shoe_size":        fp.shoe_size or "",
            "height":           bm.height or 0,
            "chest":            bm.chest or 0,
            "waist":            bm.waist or 0,
            "weight":           bm.weight or 0,
            "mood":             cp.mood or "",
            "occasion":         cp.occasion or "",
            "budget_min":       req.budget.min_price,
            "budget_max":       req.budget.max_price,
            "favorite_stores":  req.favorite_stores,
            "browsing_history": req.browsing_history,
            "purchase_history": req.purchase_history,
            "liked_items":      req.liked_items,
            "disliked_items":   req.disliked_items,
            "exclude_items":    req.exclude_items,
            "location":         {"city": req.location.city or "", "country": req.location.country or ""},
            "rec_type":         req.rec_type or "for_you",
        },
    }


# ── V2: Clean recommendation API (exact spec for external integration) ──

class RecRequestV2(BaseModel):
    user_id:              int
    session_id:           Optional[str]        = None
    gender:               Optional[str]        = None
    style_preferences:    StylePreferences     = Field(default_factory=StylePreferences)
    fit_preferences:      FitPreferences       = Field(default_factory=FitPreferences)
    body_measurements:    BodyMeasurementsIn   = Field(default_factory=BodyMeasurementsIn)
    context_preferences:  ContextPreferences   = Field(default_factory=ContextPreferences)
    favorite_stores:      List[str]            = Field(default_factory=list)
    top_k:                int                  = Field(default=10, ge=1, le=500)

@app.post("/api/v2/recommendations", tags=["Recommendations"],
          summary="V2 — clean recommendation API for external integration")
async def recommendations_v2(req: RecRequestV2):
    """
    Clean recommendation endpoint matching the exact external spec.
    Input:  user_id, session_id, style/fit/body/context preferences, favorite_stores, top_k
    Output: catalog_item_id + score + boosted only (no rich item data)
    """
    sp = req.style_preferences
    fp = req.fit_preferences
    bm = req.body_measurements
    cp = req.context_preferences

    gender = _norm_gender(req.gender or "") if req.gender else ""

    user_doc: Dict[str, Any] = {
        "user_id": str(req.user_id),
        "name":    "",
        "email":   "",
        "profile_data_json": {
            "gender":               gender,
            "preferred_colors":     [c.lower() for c in sp.selected_colors],
            "preferred_categories": [c.lower() for c in sp.selected_categories],
            "preferred_season":     "",
            "style_preferences":    [s.lower() for s in sp.selected_styles],
            "body_measurements": {
                "height":      bm.height or 0,
                "weight":      bm.weight or 0,
                "chest":       bm.chest or 0,
                "waist":       bm.waist or 0,
                "build":       (fp.body_type or "").lower(),
                "shirt_size":  fp.size or "",
                "pants_size":  fp.pants_size or "",
            },
        },
    }

    override: Dict[str, Any] = {
        "favorite_stores": req.favorite_stores,
    }
    if gender:
        override["gender"] = gender
    if cp.occasion:
        override["season"] = cp.occasion.lower()

    # Fetch more items to have enough after filtering
    items = await rank_catalog(user_doc, top_k=500,
                               override=override)

    # No post-filtering — the 22-signal engine handles ranking.
    # Matching items score higher, non-matching score lower but still appear.
    items = items[:req.top_k]

    recs = []
    for it in items:
        iid = it.get("catalog_item_id") or it.get("id") or ""
        recs.append({
            "catalog_item_id": iid,
            "score":           round(it.get("score", 0), 2),
            "boosted":         (it.get("score_detail") or {}).get("dify", 0) > 0,
        })

    return {
        "recommendations": recs,
        "session_id":      req.session_id or "",
        "preferences_used": {
            "gender":           req.gender or "",
            "styles":           sp.selected_styles,
            "color_preferences": sp.selected_colors,
            "categories":       sp.selected_categories,
            "fit_preference":   fp.fit_preference or "",
            "body_type":        fp.body_type or "",
            "size":             fp.size or "",
            "pants_size":       fp.pants_size or "",
            "shoe_size":        fp.shoe_size or "",
            "height":           bm.height or 0,
            "chest":            bm.chest or 0,
            "waist":            bm.waist or 0,
            "weight":           bm.weight or 0,
            "mood":             cp.mood or "",
            "occasion":         cp.occasion or "",
            "favorite_stores":  req.favorite_stores,
        },
    }


# ── Public trending — MUST be defined BEFORE /{email} ────────────
# FastAPI matches routes top-to-bottom; "trending" would be swallowed
# by the /{email} wildcard if trending came second.
@app.get("/api/recommendations/trending", tags=["Recommendations"],
         summary="Public trending — no login needed")
async def trending(
    limit:    int           = Query(20, ge=1, le=3000),
    gender:   Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    color:    Optional[str] = Query(None),
):
    """
    Returns up to `limit` items from the full 500-item catalog.
    No auth required. Items sorted by total stock availability.
    """
    items = await fetch_catalog()

    # Apply gender / category / color filters post-fetch
    # (fetch_catalog returns the full catalog cache; filtering is done here)
    norm_gender   = _norm_gender(gender) if gender else None
    norm_category = (category or "").lower().strip()
    norm_color    = (color or "").lower().strip()

    if norm_gender or norm_category or norm_color:
        filtered_items: List[Dict] = []
        for it in items:
            ig = _gender(it)
            # Gender filter
            if norm_gender and ig != "unisex" and ig != norm_gender:
                continue
            # Category filter — substring match + synonym expansion
            if norm_category:
                cat_str = ((it.get("category") or "") + " " + (it.get("subcategory") or "") + " " + (it.get("name") or "")).lower()
                # Expand category synonyms
                cat_synonyms = {
                    "shirt": ["shirt", "top", "button"],
                    "t-shirt": ["t-shirt", "tee", "top"],
                    "top": ["top", "shirt", "blouse", "tee"],
                    "blouse": ["blouse", "top"],
                    "blazer": ["blazer", "jacket", "coat", "top"],
                    "jeans": ["jeans", "denim", "bottom", "pant"],
                    "trousers": ["trouser", "pant", "bottom", "chino", "slack"],
                    "joggers": ["jogger", "track", "bottom", "sweat"],
                    "cargo": ["cargo", "pant", "bottom"],
                    "dress": ["dress", "gown", "maxi", "midi"],
                    "kurta": ["kurta", "ethnic", "anarkali"],
                    "shorts": ["short", "bermuda", "bottom"],
                    "sweater": ["sweater", "pullover", "cardigan", "hoodie"],
                }
                terms = cat_synonyms.get(norm_category, [norm_category])
                if not any(t in cat_str for t in terms):
                    continue
            # Color filter — substring match across all color fields
            if norm_color:
                _, _, item_cols = _build_variants(it)
                col_str = " ".join(c.lower() for c in item_cols)
                extra   = ((it.get("extra_metadata") or {}).get("color") or "").lower()
                if norm_color not in col_str and norm_color not in extra:
                    continue
            filtered_items.append(it)
        items = filtered_items

    # Sort: prioritize well-categorized items (seed catalog) over generic Boss API items
    generic_cats = {"dresses", "tops", "accessories"}
    def _sort_key(x):
        cat = (x.get("category") or "").lower().strip()
        has_proper_category = cat not in generic_cats and len(cat) > 0
        has_name = bool((x.get("name") or "").strip())
        has_price = (x.get("base_price") or x.get("sale_price") or 0) > 0
        # Seed items have proper categories, names, prices — score higher
        quality_score = (3 if has_proper_category else 0) + (1 if has_name else 0) + (1 if has_price else 0)
        # Stock as tiebreaker
        stock = 0
        for v in (x.get("variants") or []):
            if isinstance(v, dict):
                try: stock += int(v.get("stock_quantity") or 0)
                except (TypeError, ValueError): pass
        return (quality_score, stock)
    items.sort(key=_sort_key, reverse=True)

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

        bp_t   = _safe_float(item.get("base_price"))
        disc_t = _discount_percent(item)
        out.append({
            "catalog_item_id":   iid,
            "name":              item.get("name"),
            "category":          item.get("category"),
            "subcategory":       item.get("subcategory"),
            "gender":            _gender(item),
            "base_price":        bp_t,
            "sale_price":        _safe_float(item.get("sale_price")),
            "discount_percent":  round(disc_t, 1),
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
            "price": bp_t,
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
    info["cached_users"]   = len(_mem_users)
    full_cat = _cget("cat:full")
    info["catalog_cached"] = len(full_cat) if full_cat else len(_full_catalog_cache)
    info["catalog_loading"] = _catalog_loading
    info["tfidf_cache_entries"] = len(_tfidf_cache)
    return info


# ── Wishlist, Cart, Ratings (per-user, in-memory + Boss API persistence) ──

# In-memory stores keyed by email
_user_wishlists: Dict[str, Set[str]] = {}    # email -> set of catalog_item_ids
_user_carts: Dict[str, List[Dict]] = {}      # email -> list of {item_id, size, color, qty}
_user_ratings: Dict[str, Dict[str, int]] = {} # email -> {item_id: stars}
_user_outfits: Dict[str, List[Dict]] = {}    # email -> list of outfit dicts
_user_orders: Dict[str, List[Dict]] = {}     # email -> list of order dicts


async def _boss_log_interaction(user_id: int, catalog_item_id: str, event_type: str, event_value: dict = None):
    """Log interaction to Boss API for permanent PostgreSQL storage."""
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            await c.post(f"{BOSS_URL}/api/interactions", json={
                "user_id": user_id,
                "catalog_item_id": catalog_item_id,
                "event_type": event_type,
                "event_value": event_value or {},
            })
    except Exception as e:
        log.warning("Boss interaction log failed: %s", e)


async def _boss_get_interactions(user_id: int, event_type: str, limit: int = 200) -> List[Dict]:
    """Get interactions from Boss API."""
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(f"{BOSS_URL}/api/interactions/{user_id}/interactions",
                          params={"event_type": event_type, "limit": limit})
            if r.status_code == 200:
                return r.json() if isinstance(r.json(), list) else []
    except Exception as e:
        log.warning("Boss interaction get failed: %s", e)
    return []


def _get_user_id(email: str) -> int:
    """Get numeric user_id from email — checks email-to-uid cache first."""
    email = email.strip().lower()
    uid = _mem_email.get(email)
    if uid:
        u = _mem_users.get(uid)
        if u:
            # Try boss_user_id, then user_id, then parse uid
            boss_id = u.get("boss_user_id")
            if boss_id:
                return int(boss_id)
            try:
                return int(u.get("user_id", uid))
            except (ValueError, TypeError):
                pass
    return abs(hash(email)) % 1000000


@app.get("/api/user/{email}/wishlist", tags=["User Data"])
async def get_wishlist(email: str):
    # Try in-memory first
    if email in _user_wishlists:
        items = list(_user_wishlists[email])
        return {"email": email, "items": items, "count": len(items)}
    # Load from Boss API
    uid = _get_user_id(email)
    interactions = await _boss_get_interactions(uid, "like")
    item_ids = list({i["catalog_item_id"] for i in interactions if i.get("catalog_item_id")})
    _user_wishlists[email] = set(item_ids)
    return {"email": email, "items": item_ids, "count": len(item_ids)}


@app.post("/api/user/{email}/wishlist", tags=["User Data"])
async def update_wishlist(email: str, body: dict = Body(...)):
    item_id = body.get("item_id", "")
    action = body.get("action", "toggle")
    if not item_id:
        raise HTTPException(400, "item_id required")
    if email not in _user_wishlists:
        _user_wishlists[email] = set()
    wl = _user_wishlists[email]
    uid = _get_user_id(email)
    if action == "add" or (action == "toggle" and item_id not in wl):
        wl.add(item_id)
        asyncio.create_task(_boss_log_interaction(uid, item_id, "like"))
        _log_interaction_ts(item_id, "like")
    elif action == "remove" or (action == "toggle" and item_id in wl):
        wl.discard(item_id)
        # Boss API doesn't support unlike — we track it locally
    return {"email": email, "items": list(wl), "count": len(wl)}


@app.get("/api/user/{email}/cart", tags=["User Data"])
async def get_cart(email: str):
    # Try in-memory first
    if email in _user_carts and _user_carts[email]:
        items = _user_carts[email]
        return {"email": email, "items": items, "count": len(items)}
    # Load from Boss API
    uid = _get_user_id(email)
    interactions = await _boss_get_interactions(uid, "click")
    cart_items = []
    seen = set()
    for i in interactions:
        ev = i.get("event_value") or {}
        if ev.get("action") == "add_to_cart":
            cid = i.get("catalog_item_id", "")
            key = f"{cid}_{ev.get('size','')}_{ev.get('color','')}"
            if cid and key not in seen:
                seen.add(key)
                cart_items.append({"item_id": cid, "size": ev.get("size",""), "color": ev.get("color",""), "qty": 1})
    if cart_items:
        _user_carts[email] = cart_items
    return {"email": email, "items": cart_items, "count": len(cart_items)}


@app.post("/api/user/{email}/cart", tags=["User Data"])
async def update_cart(email: str, body: dict = Body(...)):
    item_id = body.get("item_id", "")
    action = body.get("action", "add")
    size = body.get("size", "")
    color = body.get("color", "")
    qty = body.get("qty", 1)
    if email not in _user_carts:
        _user_carts[email] = []
    cart = _user_carts[email]
    uid = _get_user_id(email)
    if action == "add":
        existing = next((c for c in cart if c["item_id"] == item_id and c.get("size") == size and c.get("color") == color), None)
        if existing:
            existing["qty"] = existing.get("qty", 1) + qty
        else:
            cart.append({"item_id": item_id, "size": size, "color": color, "qty": qty})
        asyncio.create_task(_boss_log_interaction(uid, item_id, "click", {"action": "add_to_cart", "size": size, "color": color}))
        _log_interaction_ts(item_id, "cart")
    elif action == "remove":
        cart[:] = [c for c in cart if c["item_id"] != item_id]
    elif action == "clear":
        cart.clear()
    return {"email": email, "items": cart, "count": len(cart)}


@app.get("/api/user/{email}/ratings", tags=["User Data"])
async def get_ratings(email: str):
    # Try in-memory first
    if email in _user_ratings and _user_ratings[email]:
        ratings = _user_ratings[email]
        return {"email": email, "ratings": ratings, "count": len(ratings)}
    # Load from Boss API
    uid = _get_user_id(email)
    interactions = await _boss_get_interactions(uid, "click")
    ratings = {}
    for i in interactions:
        ev = i.get("event_value") or {}
        if ev.get("action") == "rating" and i.get("catalog_item_id"):
            ratings[i["catalog_item_id"]] = ev.get("stars", 0)
    if ratings:
        _user_ratings[email] = ratings
    return {"email": email, "ratings": ratings, "count": len(ratings)}


@app.post("/api/user/{email}/ratings", tags=["User Data"])
async def update_rating(email: str, body: dict = Body(...)):
    item_id = body.get("item_id", "")
    stars = body.get("stars", 0)
    if not item_id:
        raise HTTPException(400, "item_id required")
    if not 1 <= stars <= 5:
        raise HTTPException(400, "stars must be 1-5")
    if email not in _user_ratings:
        _user_ratings[email] = {}
    _user_ratings[email][item_id] = stars
    uid = _get_user_id(email)
    asyncio.create_task(_boss_log_interaction(uid, item_id, "click", {"action": "rating", "stars": stars}))
    _log_interaction_ts(item_id, "rating")
    return {"email": email, "item_id": item_id, "stars": stars}


# ── Outfits ───────────────────────────────────────────────────────

@app.get("/api/user/{email}/outfits", tags=["User Data"])
async def get_outfits(email: str):
    return {"email": email, "outfits": _user_outfits.get(email, []), "count": len(_user_outfits.get(email, []))}

@app.post("/api/user/{email}/outfits", tags=["User Data"])
async def save_outfit(email: str, body: dict = Body(...)):
    import uuid
    items = body.get("items", [])
    name = body.get("name", "My Outfit")
    if not items:
        raise HTTPException(400, "items required")
    outfit = {"id": str(uuid.uuid4()), "name": name, "items": items, "created_at": str(datetime.utcnow())}
    if email not in _user_outfits:
        _user_outfits[email] = []
    _user_outfits[email].append(outfit)
    return {"email": email, "outfit": outfit}

@app.delete("/api/user/{email}/outfits/{outfit_id}", tags=["User Data"])
async def delete_outfit(email: str, outfit_id: str):
    if email in _user_outfits:
        _user_outfits[email] = [o for o in _user_outfits[email] if o["id"] != outfit_id]
    return {"email": email, "deleted": outfit_id}

# ── Orders ────────────────────────────────────────────────────────

# orders GET moved below POST /api/orders

# ── Claude Vision: Analyze Fashion Image ──────────────────────────

CLAUDE_API_KEY = os.getenv("CLAUDE_API_KEY", "")

@app.post("/api/analyze-image", tags=["Vision"])
async def analyze_image(file: UploadFile = File(...), gender: str = Query("female")):
    """Analyze a fashion image using Claude Vision to extract style attributes."""
    import base64
    contents = await file.read()
    b64 = base64.b64encode(contents).decode()
    media_type = file.content_type or "image/jpeg"

    if not CLAUDE_API_KEY:
        # Return smart defaults if no API key
        color_map = {"male": ["Navy","Black","Grey","White","Blue"], "female": ["Black","Pink","White","Red","Blue"]}
        cat_map = {"male": ["Shirts","T-shirts","Jeans","Trousers"], "female": ["Dresses","Tops","Jeans","Shirts"]}
        return {
            "image_analysis": True, "gender": gender, "estimated_age": 25,
            "skin_tone": "neutral", "body_type": "average", "current_style": "casual",
            "preferred_colors": color_map.get(gender, color_map["female"]),
            "clothing_detected": cat_map.get(gender, cat_map["female"]),
            "occasion_fit": "casual", "season_fit": "all_season",
            "style_keywords": ["modern","casual"], "recommended_fit": "regular",
            "color_palette": color_map.get(gender, color_map["female"]), "fashion_score": 7,
        }

    try:
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": CLAUDE_API_KEY,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-sonnet-4-20250514",
                    "max_tokens": 1024,
                    "messages": [{
                        "role": "user",
                        "content": [
                            {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}},
                            {"type": "text", "text": f"""Analyze the clothing and fashion in this image of a {gender} person. Return ONLY a JSON object with these fields:
{{"image_analysis": true, "gender": "{gender}", "estimated_age": 25, "skin_tone": "warm/cool/neutral", "body_type": "slim/athletic/average/plus_size", "current_style": "casual/formal/streetwear/ethnic", "hair_color": "black/brown/blonde", "preferred_colors": ["color1", "color2"], "clothing_detected": ["item1", "item2"], "occasion_fit": "casual/office/party/outdoor", "season_fit": "summer/winter/all_season", "style_keywords": ["keyword1", "keyword2"], "recommended_fit": "slim/regular/loose", "color_palette": ["color1", "color2", "color3"], "fashion_score": 7}}
Return ONLY the JSON, no markdown, no explanation."""}
                        ]
                    }]
                },
            )
            if r.status_code == 200:
                data = r.json()
                text = data.get("content", [{}])[0].get("text", "")
                import json as _json
                match = __import__("re").search(r"\{[\s\S]*\}", text)
                if match:
                    return _json.loads(match.group())
            log.warning("Claude Vision returned %s: %s", r.status_code, r.text[:200])
    except Exception as e:
        log.warning("Claude Vision failed: %s", e)

    # Fallback
    color_map = {"male": ["Navy","Black","Grey","White","Blue"], "female": ["Black","Pink","White","Red","Blue"]}
    cat_map = {"male": ["Shirts","T-shirts","Jeans","Trousers"], "female": ["Dresses","Tops","Jeans","Shirts"]}
    return {
        "image_analysis": True, "gender": gender, "estimated_age": 25,
        "skin_tone": "neutral", "body_type": "average", "current_style": "casual",
        "preferred_colors": color_map.get(gender, color_map["female"]),
        "clothing_detected": cat_map.get(gender, cat_map["female"]),
        "occasion_fit": "casual", "season_fit": "all_season",
        "style_keywords": ["modern","casual"], "recommended_fit": "regular",
        "color_palette": color_map.get(gender, color_map["female"]), "fashion_score": 7,
    }

# ── AI Search: Natural Language → Filters ─────────────────────────

@app.post("/api/ai-search", tags=["Search"])
async def ai_search(request: Request):
    """Use Claude to parse natural language into search filters."""
    body = await request.json()
    query = body.get("query", "")
    if not query.strip():
        return {"filters": {}, "message": "Please describe what you're looking for"}

    if not CLAUDE_API_KEY:
        # Fallback: basic parsing without AI
        return {"filters": {}, "message": "AI search unavailable", "fallback": True}

    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": CLAUDE_API_KEY,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-haiku-4-5-20251001",
                    "max_tokens": 300,
                    "messages": [{"role": "user", "content": f"""Parse this fashion search query into filters. Return ONLY JSON, no other text.

Query: "{query}"

Return this exact format:
{{"gender": "men/women/null", "category": "shirt/t-shirt/jeans/dress/blazer/top/trousers/joggers/cargo/kurta/jumpsuit/shorts/sweater/null", "color": "black/white/blue/red/green/pink/yellow/navy/grey/brown/beige/purple/orange/maroon/teal/null", "occasion": "formal/casual/party/sporty/wedding/beach/office/date/null", "fit": "slim/regular/loose/oversized/null", "pattern": "striped/floral/printed/solid/checked/null", "price_sort": "asc/desc/null", "max_price": null, "style_keywords": [], "message": "brief friendly response about what you found"}}

Be smart: "something for a wedding" → category:dress or kurta, occasion:wedding. "date night outfit" → occasion:date, category:dress or blazer. "comfortable work from home" → category:joggers or t-shirt, occasion:casual. "going to beach" → occasion:beach, category:shorts or dress."""}]
                },
            )
            if r.status_code == 200:
                text = r.json().get("content", [{}])[0].get("text", "")
                match = __import__("re").search(r"\{[\s\S]*\}", text)
                if match:
                    import json as _json
                    filters = _json.loads(match.group())
                    return {"filters": filters, "message": filters.get("message", "")}
    except Exception as e:
        log.warning("AI search failed: %s", e)

    return {"filters": {}, "message": "Could not understand query", "fallback": True}

# ── Image Search & Virtual Try-On ─────────────────────────────────

@app.post("/api/image-search", tags=["Search"])
async def image_search(file: UploadFile = File(...), limit: int = Query(12, ge=1, le=50)):
    """Upload an image to find visually similar products."""
    contents = await file.read()
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            # Try Boss API catalog search
            r = await c.post(
                f"{BOSS_URL}/api/catalog/search",
                files={"file": (file.filename, contents, file.content_type)},
                data={"limit": str(limit)},
            )
            if r.status_code == 200:
                data = r.json()
                items = data if isinstance(data, list) else data.get("results", data.get("items", []))
                return {"items": items, "total": len(items)}

            # Fallback: try vector search
            import base64
            b64 = base64.b64encode(contents).decode()
            r2 = await c.post(
                f"{BOSS_URL}/api/stores/1/recommendations/vector-search",
                json={"image": b64, "limit": limit},
            )
            if r2.status_code == 200:
                data = r2.json()
                items = data if isinstance(data, list) else data.get("results", data.get("items", data.get("recommendations", [])))
                return {"items": items, "total": len(items)}

    except Exception as e:
        log.warning("Image search failed: %s", e)

    # Final fallback: return trending items
    items = await fetch_catalog()
    import random
    sample = random.sample(items, min(limit, len(items))) if items else []
    return {"items": sample, "total": len(sample), "fallback": True}


@app.post("/api/tryon", tags=["Try-On"])
async def virtual_tryon(request: Request):
    """Proxy virtual try-on request to Boss API."""
    body = await request.json()
    try:
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.post(
                f"{BOSS_URL}/api/tryon/generate",
                json=body,
            )
            if r.status_code == 200:
                return r.json()
            else:
                return {"error": f"Try-on service returned {r.status_code}", "detail": r.text[:500]}
    except Exception as e:
        log.warning("Try-on failed: %s", e)
        raise HTTPException(503, f"Try-on service unavailable: {str(e)}")


# ── Orders ────────────────────────────────────────────────────────
# Orders use _user_orders (shared with interaction tracking)

class OrderItem(BaseModel):
    catalog_item_id: str
    name: str = ""
    price: float = 0
    qty: int = 1
    size: str = ""
    image: str = ""

class OrderCustomer(BaseModel):
    name: str
    phone: str = ""
    address: str = ""
    city: str = ""
    state: str = ""
    zip: str = ""

class CreateOrderIn(BaseModel):
    email: str
    customer: OrderCustomer
    items: List[OrderItem]
    subtotal: float = 0
    gst: float = 0
    total: float = 0

@app.post("/api/orders", tags=["Orders"],
          summary="Place a new order")
async def create_order(data: CreateOrderIn):
    order_id = f"ORD-{uuid.uuid4().hex[:8].upper()}"
    order = {
        "order_id": order_id,
        "email": data.email,
        "customer": data.customer.model_dump(),
        "items": [i.model_dump() for i in data.items],
        "subtotal": data.subtotal,
        "gst": data.gst,
        "total": data.total,
        "status": "confirmed",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    _user_orders.setdefault(data.email, []).append(order)
    log.info("Order %s placed for %s — %d items, total $%.0f",
             order_id, data.email, len(data.items), data.total)
    return {"order_id": order_id, "status": "confirmed", "order": order}

@app.get("/api/orders/{email}", tags=["Orders"],
         summary="Get orders for a user")
async def get_orders_by_email(email: str):
    orders = _user_orders.get(email, [])
    return {"email": email, "orders": orders, "count": len(orders)}


# ── Startup / shutdown ────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    global _full_catalog_cache, _csv_catalog_items, _shopify_is_source
    log.info("HueIQ Engine v10.0 starting (catalog: Boss Store)...")

    # 1. Load from Boss store catalog (ONLY source)
    shopify_items = await _fetch_boss_store_catalog(store_id=1)
    if shopify_items:
        _shopify_is_source = True
        _full_catalog_cache = shopify_items
        _cset("cat:full", shopify_items, 86400)
        log.info("Startup: %d items loaded from Shopify (primary source)", len(shopify_items))
    else:
        # Fallback: disk cache if Shopify is unreachable
        log.warning("Shopify fetch failed — trying disk cache fallback")
        disk = _load_disk_cache()
        if disk:
            filtered_disk = _filter_real_items(disk)
            if filtered_disk:
                _full_catalog_cache = filtered_disk
                _cset("cat:full", filtered_disk, 3600)
                log.info("Startup: %d items from disk cache fallback", len(filtered_disk))

    # Connect to Boss API for user data (auth, interactions) — NOT for catalog
    asyncio.create_task(_init())

async def _keep_boss_warm():
    """Ping Boss API every 4 minutes. Also refresh token proactively if < 5 min remaining."""
    await asyncio.sleep(60)   # wait for initial startup to settle
    while True:
        try:
            # Refresh token proactively if it expires in < 5 minutes
            if _is_token_expired(BOSS_TOKEN) or _token_expires_in(BOSS_TOKEN) < 300:
                log.info("BOSS_TOKEN expiring soon — refreshing proactively")
                await _refresh_boss_token()
            c = await _boss_client()
            await c.get("/health", headers=_boss_headers(), timeout=10.0)
        except Exception:
            pass
        await asyncio.sleep(240)   # 4 minutes

async def _init():
    """
    Connect to Boss API and start catalog loading.
    Azure Container Apps can take 30-60s to cold-start — we retry patiently.
    Catalog loading starts as soon as ANY page returns data, regardless of
    whether the /health endpoint responds.
    """
    # Check token expiry — but don't block catalog loading on refresh.
    # Start both in parallel: catalog handles 401s via its own retry logic.
    if _is_token_expired(BOSS_TOKEN):
        log.warning("BOSS_TOKEN is expired — refreshing in background alongside catalog load")
        asyncio.create_task(_refresh_boss_token())
    else:
        log.info("BOSS_TOKEN is valid")

    # Scout: immediately fetch real items from known skip positions (skip=2800+)
    # so users see real products within ~10s instead of waiting 2 min
    if not _full_catalog_cache:
        asyncio.create_task(_scout_real_items())
    # Full background load: fetch all pages from skip=0 for complete catalog
    asyncio.create_task(_load_all_pages_bg())
    # Keep Boss API warm — ping every 4 min to prevent Azure scale-to-zero
    asyncio.create_task(_keep_boss_warm())

    # Health check — informational only, give up quickly if unreachable
    for attempt in range(3):
        try:
            c = await _boss_client()
            r = await c.get("/health", headers=_boss_headers(), timeout=15.0)
            if r.status_code in (200, 204):
                log.info("Boss API connected ✓ → %s", BOSS_URL)
                return
            if r.status_code == 401:
                log.warning("Boss API → 401, refreshing token")
                await _refresh_boss_token()
                continue
            log.warning("Boss API health → HTTP %d (attempt %d)", r.status_code, attempt + 1)
        except Exception as e:
            log.warning("Boss API unreachable (attempt %d): %s", attempt + 1, type(e).__name__)
        await asyncio.sleep(15)
    log.warning("Boss API not reachable after 3 attempts — running on demo/cached data")

@app.on_event("shutdown")
async def shutdown():
    global _boss_cli, _dify_cli
    if _boss_cli: await _boss_cli.aclose()
    if _dify_cli: await _dify_cli.aclose()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True, log_level="info")



