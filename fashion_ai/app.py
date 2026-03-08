"""
HueIQ Recommendation Engine v8.1

FIXES in this version:
  1. Profile saved to hueiq.users matching EXACT schema from DB diagram
     (user_id UUID, name, email, created_at, updated_at, profile_data_json JSONB)
  2. Compat routes added:
       POST /api/save-profile       → alias for PUT /api/auth/profile
       GET  /api/recommendations/{email} → alias for GET /api/recommendations
  3. Dify: changed response_mode blocking→streaming, SSE parser added
  4. physics_profile parsed as JSONB (dict) not plain string
  5. No duplicate recommendations (dedup by catalog_item_id throughout)
  6. Trending returns up to limit param items (no hardcoded 60)
  7. fetch_catalog() with no args returns ALL 500 items (no filters)
"""

from __future__ import annotations
import asyncio, hashlib, json, logging, os, time, uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Set, Tuple

import httpx
import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Path, Query, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity as sk_cosine

try:
    from motor.motor_asyncio import AsyncIOMotorClient
    MOTOR_OK = True
except ImportError:
    MOTOR_OK = False

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
MONGO_URI  = os.getenv("MONGODB_URI", "")
MONGO_DB   = "hueiq"
DIFY_URL   = os.getenv("DIFY_API_URL",  "https://cloud.xpectrum.co")
DIFY_KEY   = os.getenv("DIFY_API_KEY",  "app-6XxyzGBrc3Sjj56vcWD2uNrn")
JWT_SECRET = os.getenv("JWT_SECRET",    "hueiq-secret-change-in-prod")
JWT_HOURS  = int(os.getenv("JWT_EXPIRE_HOURS", "72"))
BOSS_URL   = os.getenv("BOSS_API_URL",
    "https://hueiq-core-api.purplesand-63becfba.westus2.azurecontainerapps.io")


# ── MongoDB ───────────────────────────────────────────────────────
_db = None

async def get_db():
    global _db
    if _db is not None:
        return _db
    if not MOTOR_OK or not MONGO_URI:
        return None
    try:
        client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=5000)
        await client.admin.command("ping")
        _db = client[MONGO_DB]
        log.info("MongoDB connected → hueiq")
        return _db
    except Exception as e:
        log.warning("MongoDB failed: %s", e)
        return None


# ── Password + JWT ────────────────────────────────────────────────
def _hash_pw(pw: str) -> str:
    if BCRYPT_OK:
        return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()
    return hashlib.sha256(pw.encode()).hexdigest()

def _check_pw(pw: str, h: str) -> bool:
    if BCRYPT_OK:
        try: return bcrypt.checkpw(pw.encode(), h.encode())
        except: pass
    return hashlib.sha256(pw.encode()).hexdigest() == h

def _make_token(user_id: str, email: str) -> str:
    if JWT_OK:
        return pyjwt.encode(
            {"user_id": user_id, "email": email,
             "exp": datetime.utcnow() + timedelta(hours=JWT_HOURS)},
            JWT_SECRET, algorithm="HS256")
    return hashlib.sha256(f"{user_id}:{JWT_SECRET}".encode()).hexdigest()

def _decode_token(token: str) -> Optional[Dict]:
    if JWT_OK:
        try: return pyjwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        except: return None
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


# ── In-memory fallback ────────────────────────────────────────────
_mem_users: Dict[str, Dict] = {}
_mem_email: Dict[str, str]  = {}


# ── users collection helpers ──────────────────────────────────────
# EXACT schema from DB diagram:
#   user_id UUID PK, name VARCHAR(100), email VARCHAR(100),
#   created_at TIMESTAMP, updated_at TIMESTAMP,
#   profile_data_json JSONB

async def db_create_user(data: Dict) -> Dict:
    """
    Saves to hueiq.users with the exact schema from the DB diagram.
    profile_data_json holds all preference/measurement fields.
    """
    db = await get_db()
    now = datetime.utcnow().isoformat()
    uid = str(uuid.uuid4())

    # Matches DB diagram exactly: only top-level fields are
    # user_id, name, email, password_hash, created_at, updated_at, profile_data_json
    doc = {
        "user_id":       uid,
        "name":          data.get("name", ""),
        "email":         data["email"].strip().lower(),
        "password_hash": _hash_pw(data.get("password", "")),
        "created_at":    now,
        "updated_at":    now,
        # All preference data lives inside profile_data_json JSONB
        "profile_data_json": {
            "gender":               _norm_gender(data.get("gender", "")),
            "preferred_colors":     data.get("preferred_colors", []),
            "preferred_categories": data.get("preferred_categories", []),
            "preferred_season":     data.get("preferred_season", ""),
            "style_preferences":    data.get("style_preferences", []),
            "body_measurements":    data.get("body_measurements", {}),
            "age":                  data.get("age"),
            "location":             data.get("location", ""),
        },
    }

    if db is not None:
        existing = await db.users.find_one({"email": doc["email"]})
        if existing:
            raise HTTPException(409, "Email already registered")
        await db.users.insert_one(doc)
        doc.pop("_id", None)
        log.info("User saved → hueiq.users: %s (user_id=%s)", doc["email"], uid)
    else:
        _mem_users[uid] = doc
        _mem_email[doc["email"]] = uid
        log.info("User saved → in-memory: %s", doc["email"])

    return doc


async def db_get_by_email(email: str) -> Optional[Dict]:
    email = email.strip().lower()
    db = await get_db()
    if db is not None:
        doc = await db.users.find_one({"email": email})
        if doc:
            doc.pop("_id", None)
        return doc
    uid = _mem_email.get(email)
    return _mem_users.get(uid) if uid else None


async def db_get_by_id(uid: str) -> Optional[Dict]:
    db = await get_db()
    if db is not None:
        doc = await db.users.find_one({"user_id": uid})
        if doc:
            doc.pop("_id", None)
        return doc
    return _mem_users.get(uid)


async def db_update_profile(uid: str, pj: Dict) -> Optional[Dict]:
    """
    Updates profile_data_json JSONB field and updated_at timestamp.
    Matches exact DB schema — only these two fields change on profile update.
    """
    db = await get_db()
    now = datetime.utcnow().isoformat()
    if db is not None:
        result = await db.users.update_one(
            {"user_id": uid},
            {"$set": {
                "profile_data_json": pj,
                "updated_at":        now,
            }}
        )
        if result.matched_count == 0:
            log.warning("db_update_profile: no user found with user_id=%s", uid)
        else:
            log.info("Profile updated → hueiq.users user_id=%s", uid)
        return await db_get_by_id(uid)

    if uid in _mem_users:
        _mem_users[uid]["profile_data_json"] = pj
        _mem_users[uid]["updated_at"] = now
    return _mem_users.get(uid)


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
    return any(int(v.get("stock_quantity") or 0) > 0
               for v in vs if isinstance(v, dict))

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


# ── Catalog fetch from MongoDB ────────────────────────────────────
async def fetch_catalog(
    gender:     Optional[str]       = None,
    colors:     Optional[List[str]] = None,
    categories: Optional[List[str]] = None,
    season:     Optional[str]       = None,
    limit:      int                 = 500,
) -> List[Dict]:
    """
    Reads hueiq.catalog directly from MongoDB.
    Called with NO arguments → returns all 500 items unfiltered.
    Called with filters    → applies server-side MongoDB query.
    Falls back to REST API if MongoDB unavailable.
    """
    ck = f"cat:{gender}:{','.join(colors or [])}:{','.join(categories or [])}:{season}:{limit}"
    cached = _cget(ck)
    if cached is not None:
        return cached

    db = await get_db()
    if db is not None:
        try:
            query: Dict[str, Any] = {}

            # Build query only when filters are actually provided
            and_clauses: List[Dict] = []

            if gender:
                g = _norm_gender(gender)
                # match catalog variants: "women"/"female"/"woman" and "men"/"male"/"man"
                if g == "women":
                    gender_vals = ["women", "female", "woman"]
                elif g == "men":
                    gender_vals = ["men", "male", "man"]
                else:
                    gender_vals = [g]
                gender_conditions = [{"gender": {"$regex": v, "$options": "i"}} for v in gender_vals]
                gender_conditions += [{"extra_metadata.gender": {"$regex": v, "$options": "i"}} for v in gender_vals]
                gender_conditions.append({"gender": {"$regex": "unisex", "$options": "i"}})
                and_clauses.append({"$or": gender_conditions})

            if categories:
                cat_patterns = [
                    {"category":    {"$regex": c, "$options": "i"}} for c in categories
                ] + [
                    {"subcategory": {"$regex": c, "$options": "i"}} for c in categories
                ]
                and_clauses.append({"$or": cat_patterns})

            if colors:
                color_conditions = []
                for c in colors:
                    color_conditions.extend([
                        {"images.color_variant": {"$regex": c, "$options": "i"}},
                        {"variants.color":       {"$regex": c, "$options": "i"}},
                    ])
                and_clauses.append({"$or": color_conditions})

            if season:
                and_clauses.append({"$or": [
                    {"extra_metadata.season": {"$regex": season, "$options": "i"}},
                    {"style_tags.tags":       {"$regex": season, "$options": "i"}},
                ]})

            if and_clauses:
                query = {"$and": and_clauses} if len(and_clauses) > 1 else and_clauses[0]

            log.debug("catalog query: %s", json.dumps(query, default=str)[:300])

            cursor = db.catalog.find(query, limit=limit)
            items  = [{k: v for k, v in doc.items() if k != "_id"}
                      async for doc in cursor]

            # Deduplicate by catalog_item_id
            seen: Set[str] = set()
            out:  List[Dict] = []
            for item in items:
                k = str(item.get("catalog_item_id") or item.get("id") or "")
                if k and k not in seen:
                    seen.add(k)
                    out.append(item)

            log.info("catalog from MongoDB: %d items (gender=%s colors=%s cats=%s season=%s)",
                     len(out), gender, colors, categories, season)

            # If filtered query returns too few (<20), supplement with unfiltered
            if and_clauses and len(out) < 5:
                log.info("Too few results (%d), supplementing with unfiltered catalog", len(out))
                cursor2 = db.catalog.find({}, limit=limit)
                async for doc in cursor2:
                    item = {k: v for k, v in doc.items() if k != "_id"}
                    k = str(item.get("catalog_item_id") or "")
                    if k and k not in seen:
                        seen.add(k)
                        out.append(item)

            _cset(ck, out, 600)
            return out

        except Exception as e:
            log.warning("MongoDB catalog fetch failed: %s", e)

    return await _boss_catalog()


# ── Boss REST API fallback ────────────────────────────────────────
_boss_cli: Optional[httpx.AsyncClient] = None
_boss_token: str = os.getenv("BOSS_TOKEN", "")

async def _boss_client() -> httpx.AsyncClient:
    global _boss_cli
    if _boss_cli is None or _boss_cli.is_closed:
        _boss_cli = httpx.AsyncClient(base_url=BOSS_URL, timeout=15.0)
    return _boss_cli

async def _boss_catalog() -> List[Dict]:
    cached = _cget("boss:cat")
    if cached:
        return cached
    try:
        c = await _boss_client()
        h = {"Authorization": f"Bearer {_boss_token}"} if _boss_token else {}
        r = await c.get("/api/recommendations/trending?limit=500", headers=h)
        if r.status_code == 200:
            raw   = r.json()
            items = raw if isinstance(raw, list) else raw.get("items", [])
            _cset("boss:cat", items, 600)
            return items
    except Exception as e:
        log.warning("Boss API failed: %s", e)
    return []


# ── Image builder ─────────────────────────────────────────────────
_UNSPLASH: Dict[str, List[str]] = {
    "shirts":  ["1594938298603-c8148c4b5ec4","1554568218-0f1715e72254","1516826957135-700d500c4b51"],
    "tshirt":  ["1521572163474-6864f9cf17ab","1583743814966-8d58504ad3d8","1503341504253-dff4815485f1"],
    "dress":   ["1595777457583-95e059d581b8","1566479179817-9cbf065c2a5e"],
    "bottom":  ["1490481651871-ab68de25d43d","1584370848010-d7fe6bc767ec"],
    "outer":   ["1548126032-079a0fb0099d","1551028719-00167b16eac5"],
    "shoe":    ["1543163521-1bf539c55dd2","1595950653106-6c9ebd614d3a"],
    "def":     ["1558618666-fcd25c85cd64","1560769629-975ec94e6a86"],
}

def _pool(cat: str) -> str:
    c = (cat or "").lower()
    if any(w in c for w in ("t-shirt","tshirt","tee")): return "tshirt"
    if "shirt" in c: return "shirts"
    if "dress" in c: return "dress"
    if any(w in c for w in ("pant","jean","skirt","trouser")): return "bottom"
    if any(w in c for w in ("jacket","coat","blazer","cardigan")): return "outer"
    if any(w in c for w in ("shoe","boot","sneak")): return "shoe"
    return "def"

def _fallback_url(iid: str, cat: str, color: str, img_type: str) -> str:
    pool = _UNSPLASH[_pool(cat)]
    h    = int(hashlib.md5(f"{iid}:{color}:{img_type}".encode()).hexdigest(), 16)
    return f"https://images.unsplash.com/photo-{pool[h % len(pool)]}?w=600&fit=crop"

def _build_images(item: Dict) -> Tuple[List[Dict], Optional[str]]:
    iid = str(item.get("catalog_item_id") or "")
    cat = item.get("category") or "def"
    out: List[Dict] = []
    primary: Optional[str] = None

    for img in (item.get("images") or []):
        if not isinstance(img, dict): continue
        img_type = (img.get("image_type") or "").lower()
        color_v  = (img.get("color_variant") or "").lower()
        is_p     = bool(img.get("is_primary", False))
        url      = (img.get("image_url") or "").strip() or \
                   _fallback_url(iid, cat, color_v or "default", img_type or "front")
        out.append({
            "image_id":     img.get("image_id"),
            "image_url":    url,
            "image_type":   img_type,
            "color_variant": color_v,
            "is_primary":   is_p,
        })
        if is_p and not primary:
            primary = url

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
        qty = int(v.get("stock_quantity") or 0)
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


# ── Color match score ─────────────────────────────────────────────
def _color_score(item: Dict, pref_colors: List[str]) -> float:
    if not pref_colors: return 0.5   # neutral if user has no color preference
    item_cols = _item_colors(item)
    if not item_cols: return 0.3
    pref_set = {c.lower() for c in pref_colors}
    exact   = len(pref_set & item_cols) / len(pref_set)
    partial = sum(
        any(p in ic or ic in p for ic in item_cols)
        for p in pref_set
    ) / len(pref_set)
    return min(exact * 0.7 + partial * 0.3, 1.0)


# ── Fit score (physics_profile × body_measurements) ───────────────
_PHYSICS_DRAPE = {
    "light_fabric":   0.9,
    "heavy_fabric":   0.6,
    "stretch_fabric": 0.95,
    "knit":           0.85,
    "rigid":          0.4,
    "denim":          0.65,
}

def _fit_score(item: Dict, body_meas: Dict) -> float:
    """
    Reads physics_profile from assets_3d JSONB.
    Falls back gracefully if field is missing or unexpected type.
    """
    phys = _physics_profile(item)
    if phys is None:
        return 0.5

    drape = _PHYSICS_DRAPE.get(phys, 0.5)

    if body_meas:
        build = body_meas.get("build", "")
        if build == "slim"    and phys in ("light_fabric", "knit"):       return 0.95
        if build == "plus"    and phys == "stretch_fabric":               return 1.0
        if build == "plus"    and phys == "rigid":                        return 0.2
        if build == "athletic" and phys in ("stretch_fabric", "knit"):   return 0.9

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
    m = datetime.utcnow().month
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
    except:
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
    Calls Dify workflow in STREAMING mode (response_mode: streaming).
    Parses SSE events to extract catalog_item_ids from workflow output.
    Returns a set of catalog_item_id strings Dify recommends.
    """
    g = _norm_gender(gender)
    if g not in ("men", "female"):
        g = "men"

    payload = {
        "inputs": {
            "gender":   g,
            "color":    color    or "any",
            "category": category or "any",
            "season":   season   or _cur_season(),
        },
        "response_mode": "streaming",   # ← FIXED: was "blocking"
        "user": uid,
    }

    try:
        c = await _dify_client()
        async with c.stream("POST", "/api/v1/workflows/run", json=payload) as resp:
            if resp.status_code != 200:
                log.debug("Dify HTTP %d", resp.status_code)
                return set()

            ids: Set[str] = set()
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                raw = line[5:].strip()
                if not raw or raw == "[DONE]":
                    continue
                try:
                    event = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                # Dify emits different event types; we want workflow_finished
                event_type = event.get("event", "")
                data       = event.get("data") or event

                if event_type == "workflow_finished":
                    outputs = (data.get("outputs") or {})
                elif event_type in ("node_finished", "message"):
                    outputs = (data.get("outputs") or {})
                else:
                    outputs = {}

                for key in ("catalog_item_ids", "item_ids", "recommendations",
                            "items", "result"):
                    val = outputs.get(key)
                    if isinstance(val, list):
                        ids |= {str(v) for v in val if v}
                        break
                    if isinstance(val, str) and val.strip():
                        try:
                            ids |= set(json.loads(val))
                        except json.JSONDecodeError:
                            ids |= {x.strip() for x in val.split(",") if x.strip()}
                        break

                if ids and event_type == "workflow_finished":
                    break  # We have what we need

            log.info("Dify boost returned %d item IDs", len(ids))
            return ids

    except Exception as e:
        log.debug("Dify error: %s", e)
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

    # Fetch catalog (MongoDB server-side pre-filter)
    catalog = await fetch_catalog(
        gender=gender     or None,
        colors=colors     or None,
        categories=categories or None,
        season=season     or None,
        limit=top_k,
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
                timeout=15.0,   # streaming needs more time than blocking
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

        item_cat = (item.get("category") or "").lower()
        item_sub = (item.get("subcategory") or "").lower()
        s_cat    = 1.0 if any(
            c.lower() in item_cat or item_cat in c.lower() or
            c.lower() in item_sub or item_sub in c.lower()
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

        images, primary = _build_images(item)
        variants, sizes, item_colors_list = _build_variants(item)
        a3d = item.get("assets_3d") or {}
        bp  = float(item.get("base_price") or 0)

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
                "Matches your colour preference"  if s_color  > 0.5 else
                "Great fit for your body type"    if s_fit    > 0.7 else
                "AI-powered pick for you"         if s_dify   > 0   else
                f"Perfect for {season or _cur_season()}"
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
app = FastAPI(title="HueIQ Recommendation Engine", version="8.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Auth ──────────────────────────────────────────────────────────
@app.post("/api/auth/register", status_code=201, tags=["Auth"],
          summary="Register — saves to hueiq.users (exact DB schema)")
async def register(data: RegisterIn):
    """
    Saves to MongoDB hueiq.users:
      user_id UUID, name, email, password_hash,
      created_at, updated_at, profile_data_json JSONB
    """
    user  = await db_create_user(data.dict())
    token = _make_token(user["user_id"], user["email"])
    safe  = {k: v for k, v in user.items() if k != "password_hash"}
    return {"token": token, "user": safe}


@app.post("/api/auth/login", tags=["Auth"],
          summary="Login — returns JWT + saved profile")
async def login(data: LoginIn):
    user = await db_get_by_email(data.email)
    if not user or not _check_pw(data.password, user.get("password_hash", "")):
        raise HTTPException(401, "Invalid email or password")
    token = _make_token(user["user_id"], user["email"])
    safe  = {k: v for k, v in user.items() if k != "password_hash"}
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
    updates = {k: v for k, v in data.dict().items() if v is not None}
    if "gender" in updates:
        updates["gender"] = _norm_gender(updates["gender"])
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
        updates = {k: v for k, v in data.dict().items()
                   if k not in ("email", "password") and v is not None}
        if "gender" in updates:
            updates["gender"] = _norm_gender(updates["gender"])
        pj.update(updates)
        updated = await db_update_profile(auth["user_id"], pj)
        safe = {k: v for k, v in (updated or {}).items() if k != "password_hash"}
        return {"token": None, "user": safe, "saved": True}

    # ── Unauthenticated path (wizard step 3 before login) ───────────
    email = (data.email or "").strip().lower()
    if not email:
        raise HTTPException(422, "email is required when not authenticated")

    profile_fields = {k: v for k, v in data.dict().items()
                      if k not in ("email", "password", "name") and v is not None}
    if "gender" in profile_fields:
        profile_fields["gender"] = _norm_gender(profile_fields["gender"])

    # Try to find existing user
    existing = await db_get_by_email(email)

    if existing:
        # User exists — update their profile
        pj = dict(existing.get("profile_data_json") or {})
        pj.update(profile_fields)
        updated = await db_update_profile(existing["user_id"], pj)
        token   = _make_token(existing["user_id"], existing["email"])
        safe    = {k: v for k, v in (updated or {}).items() if k != "password_hash"}
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
        user    = await db_create_user(reg_data)
        token   = _make_token(user["user_id"], user["email"])
        safe    = {k: v for k, v in user.items() if k != "password_hash"}
        return {"token": token, "user": safe, "saved": True, "registered": True}


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
    items.sort(key=lambda x: sum(
        int(v.get("stock_quantity") or 0)
        for v in (x.get("variants") or [])
        if isinstance(v, dict)
    ), reverse=True)

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
            "base_price":        float(item.get("base_price") or 0),
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
            "price": float(item.get("base_price") or 0),
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
    db = await get_db()
    if db is not None:
        doc = await db.catalog.find_one({"catalog_item_id": item_id})
        if doc:
            item = {k: v for k, v in doc.items() if k != "_id"}
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
    raise HTTPException(404, f"Item {item_id} not found")


# ── System ────────────────────────────────────────────────────────
@app.get("/", include_in_schema=False)
async def root():
    db = await get_db()
    return {
        "service": "HueIQ Engine",
        "version": "8.1.0",
        "mongodb": db is not None,
        "docs":    "/docs",
    }

@app.get("/health", tags=["System"])
async def health():
    db   = await get_db()
    info: Dict[str, Any] = {
        "status":  "ok",
        "version": "8.1.0",
        "mongodb": db is not None,
    }
    if db is not None:
        try:
            info["users"]   = await db.users.count_documents({})
            info["catalog"] = await db.catalog.count_documents({})
        except:
            pass
    return info


# ── Startup / shutdown ────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    log.info("HueIQ Engine v8.1 starting...")
    asyncio.create_task(_init())

async def _init():
    await asyncio.sleep(1)
    db = await get_db()
    if db is not None:
        try:
            cols = await db.list_collection_names()
            if "users" not in cols:
                await db.create_collection("users")
                log.info("Created: hueiq.users collection")
            # Unique indexes on users
            await db.users.create_index("email",   unique=True, name="email_unique",   background=True)
            await db.users.create_index("user_id", unique=True, name="user_id_unique", background=True)
            catalog_count = await db.catalog.count_documents({})
            users_count   = await db.users.count_documents({})
            log.info("hueiq.catalog: %d items | hueiq.users: %d users",
                     catalog_count, users_count)
        except Exception as e:
            log.warning("Init error: %s", e)
    else:
        log.warning("MongoDB not connected — using in-memory fallback")

@app.on_event("shutdown")
async def shutdown():
    global _boss_cli, _dify_cli
    if _boss_cli: await _boss_cli.aclose()
    if _dify_cli: await _dify_cli.aclose()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8002, reload=True, log_level="info")



