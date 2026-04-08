"""
HueIQ Recommendation API
========================
22-signal recommendation engine that pulls catalog from Boss PostgreSQL database.

DATA FLOW:
  Boss PostgreSQL DB (/api/stores/1/catalog)
       |
       v
  Recommendation Engine (22 scoring signals)
       |
       v
  POST /api/v2/recommendations  -->  Top N scored items

LIVE URL:
  https://fashion-ai-backend.purplesand-63becfba.westus2.azurecontainerapps.io

SWAGGER:
  https://fashion-ai-backend.purplesand-63becfba.westus2.azurecontainerapps.io/docs

CATALOG SOURCE:
  Boss PostgreSQL: https://hueiq-core-api.purplesand-63becfba.westus2.azurecontainerapps.io/api/stores/1/catalog
  Auth: Bearer token required
  Pagination: cursor-based (20 items per page)
  Total: ~598 products from Shopify store (synced to Boss DB)
"""

# ============================================================
# 1. CATALOG FETCHING (from Boss PostgreSQL)
# ============================================================

"""
The catalog is fetched from Boss PostgreSQL database at startup.
Endpoint: GET /api/stores/{store_id}/catalog
Auth: Bearer token (store-level JWT)
Pagination: cursor-based (?cursor=21, ?cursor=42, etc.)

Each item from Boss DB has:
  - id: integer (Boss DB primary key)
  - title: product name
  - category: "Tops - T-shirts", "Bottoms - Pants", "Footwear", etc.
  - base_price: USD price
  - tags: ["NIKE", "T-shirts", "Mortar", etc.] (brand is extracted from tags)
  - thumbnail_url: Shopify CDN image URL
  - size_options: dict of variant_id -> {title, available, price, selectedOptions}
    - selectedOptions[0]: Option1 = Color (e.g., "Black", "White")
    - selectedOptions[1]: Option2 = Size (e.g., "S", "M", "L")
  - mesh_key: 3D model URL (for virtual try-on)
  - texture_url: texture image for 3D rendering
"""

BOSS_CATALOG_URL = "https://hueiq-core-api.purplesand-63becfba.westus2.azurecontainerapps.io/api/stores/1/catalog"
BOSS_STORE_TOKEN = "Bearer <store_jwt_token>"  # Set via env var BOSS_STORE_TOKEN

# Sample catalog item from Boss DB:
SAMPLE_BOSS_ITEM = {
    "id": 9,
    "store_id": 1,
    "garment_id": "shopify_gid://shopify/Product/10305886322966",
    "title": "3D Molded Dreams to Reality Script Tee",
    "category": "Tops - T-shirts",
    "base_price": 88.0,
    "tags": ["PAPER PLANES", "T-shirts", "Mortar"],
    "thumbnail_url": "https://cdn.shopify.com/s/files/1/0929/9122/6134/files/planes-1_1.png",
    "size_options": {
        "50760596259094": {
            "title": "Black / S",
            "available": True,
            "price": {"amount": "88.00", "currencyCode": "USD"},
            "selectedOptions": [
                {"name": "Option1", "value": "Black"},   # Color
                {"name": "Option2", "value": "S"}         # Size
            ]
        }
    },
    "mesh_key": "https://hueiqst1.blob.core.windows.net/assets/mesh/sweater/Project-03_gltf_thin.gltf",
    "texture_url": "https://cdn.shopify.com/s/files/1/0929/9122/6134/files/planes-1_1.png"
}


# ============================================================
# 2. RECOMMENDATION API (Input / Output)
# ============================================================

"""
POST /api/v2/recommendations

No authentication required. User preferences sent in request body.
Returns top_k items scored by 22 signals.
"""

# --- INPUT ---
SAMPLE_REQUEST = {
    "user_id": 2,
    "session_id": "user_prefs_session_123",
    "gender": "male",                          # "male" or "female"
    "style_preferences": {
        "selected_styles": ["casual", "street"],    # style identity
        "selected_colors": ["black"],               # preferred colors
        "selected_categories": ["t-shirts", "tops", "trousers"]  # preferred categories
    },
    "fit_preferences": {
        "fit_preference": "regular",           # slim, regular, loose, oversized
        "body_type": "athletic",               # slim, athletic, average, curvy, plus
        "size": "M",                           # shirt size
        "pants_size": "32",                    # pants size
        "shoe_size": "10"                      # shoe size
    },
    "body_measurements": {
        "height": 170.0,                       # cm
        "chest": 95.0,                         # cm
        "waist": 80.0,                         # cm
        "weight": 70.0                         # kg
    },
    "context_preferences": {
        "mood": "casual",                      # casual, formal, party, etc.
        "occasion": "weekend"                  # weekend, office, date, etc.
    },
    "favorite_stores": ["nike"],               # preferred brands
    "top_k": 10                                # number of recommendations to return
}

# --- OUTPUT ---
SAMPLE_RESPONSE = {
    "recommendations": [
        {
            "catalog_item_id": "boss-396",     # Maps to Boss DB id=396
            "score": 0.41,                     # 0-1 relevance score from 22 signals
            "boosted": False                   # True if AI-boosted
        },
        {
            "catalog_item_id": "boss-548",
            "score": 0.41,
            "boosted": False
        }
    ],
    "session_id": "user_prefs_session_123",
    "preferences_used": {
        "gender": "male",
        "styles": ["casual", "street"],
        "color_preferences": ["black"],
        "categories": ["t-shirts", "tops", "trousers"],
        "fit_preference": "regular",
        "body_type": "athletic",
        "size": "M",
        "pants_size": "32",
        "shoe_size": "10",
        "height": 170.0,
        "chest": 95.0,
        "waist": 80.0,
        "weight": 70.0,
        "mood": "casual",
        "occasion": "weekend",
        "favorite_stores": ["nike"]
    }
}


# ============================================================
# 3. HOW catalog_item_id MAPS TO BOSS DB
# ============================================================

"""
catalog_item_id format: "boss-{id}"

Example:
  "boss-396" → Boss DB table row with id=396

To get full item details:
  GET /api/stores/1/catalog?cursor=381
  → Find item with id=396 in the response

The recommendation engine stores items internally as:
  {
    "catalog_item_id": "boss-396",
    "name": "Men's Holiday Mystery Box",
    "category": "unclassified",
    "brand": "PAPER PLANES",
    "base_price": 100.0,
    "primary_image_url": "https://cdn.shopify.com/...",
    "available_sizes": ["S", "M", "L", "XL", "2XL"],
    "available_colors": ["black"],
    "gender": "men",
    ...
  }
"""


# ============================================================
# 4. THE 22 SCORING SIGNALS
# ============================================================

SCORING_SIGNALS = {
    # --- Core Signals (always active) ---
    1:  {"name": "Category match",       "weight": "15-35%", "description": "Does item category match user's selected categories?"},
    2:  {"name": "Color preference",     "weight": "8-20%",  "description": "Does item color match user's preferred colors?"},
    3:  {"name": "Body fit",             "weight": "5-15%",  "description": "Does item fit user's body type (BMI + build)?"},
    4:  {"name": "Gender",               "weight": "2-5%",   "description": "Hard filter: men see men's items, women see women's"},
    5:  {"name": "Season",               "weight": "3-8%",   "description": "Seasonal relevance (summer/winter/spring/fall)"},
    6:  {"name": "TF-IDF content",       "weight": "3-7%",   "description": "Text similarity between user query and item tags"},
    7:  {"name": "AI boost (Dify)",       "weight": "1-2%",   "description": "External AI recommendation from Dify workflow"},

    # --- Behavioral Signals (activate with user history) ---
    8:  {"name": "Brand affinity",       "weight": "5-10%",  "description": "Boost items from brands user browsed/liked/purchased"},
    9:  {"name": "Price affinity",       "weight": "3-5%",   "description": "Items near user's average spending range"},
    10: {"name": "Behavior boost",       "weight": "6-12%",  "description": "Category+brand patterns from browse/like/purchase history"},
    11: {"name": "Recency",              "weight": "2-4%",   "description": "Newer items get slight priority (90-day decay)"},
    12: {"name": "Size availability",    "weight": "4-6%",   "description": "User's size is actually in stock = boost"},
    13: {"name": "Occasion match",       "weight": "3-4%",   "description": "Weekend/party/office matching from tags"},
    14: {"name": "Popularity",           "weight": "3-4%",   "description": "Cross-user wishlists/carts/purchases"},
    15: {"name": "Discount",             "weight": "2-3%",   "description": "Better deals rank slightly higher"},

    # --- Social Signals (activate with multiple users) ---
    16: {"name": "Collaborative filter", "weight": "8-12%",  "description": "'Users who liked X also liked Y'"},
    17: {"name": "Item-to-item similar", "weight": "6-10%",  "description": "Cosine similarity on feature vectors"},
    18: {"name": "Session context",      "weight": "3-4%",   "description": "Time-of-day + weekend occasion boost"},

    # --- Deep Learning Signals ---
    19: {"name": "Semantic similarity",  "weight": "8-10%",  "description": "Sentence-transformer embeddings (all-MiniLM-L6-v2)"},
    20: {"name": "Outfit compatibility", "weight": "4-5%",   "description": "Color harmony + cross-category pairing"},
    21: {"name": "Trend velocity",       "weight": "4-5%",   "description": "Items gaining popularity fast (acceleration)"},
    22: {"name": "Repeat purchase",      "weight": "3%",     "description": "Staple items user might rebuy"},
}


# ============================================================
# 5. ALL API ENDPOINTS
# ============================================================

ALL_ENDPOINTS = {
    # Recommendations
    "POST /api/v2/recommendations":      "Main API — 22-signal personalized recommendations (clean format)",
    "POST /api/recommendations":         "Recommendations with full item details (name, images, price, etc.)",
    "GET  /api/recommendations/trending": "Trending items — no login needed",

    # Auth
    "POST /api/auth/register":           "Register new user",
    "POST /api/auth/login":              "Login, get JWT token",
    "GET  /api/auth/me":                 "Get current user profile (JWT required)",
    "PUT  /api/auth/profile":            "Update user preferences (JWT required)",
    "POST /api/save-profile":            "Save profile (no JWT needed, wizard flow)",

    # Catalog
    "GET  /api/catalog/{item_id}":       "Get single item full detail",

    # User Data
    "GET  /api/user/{email}/wishlist":   "Get user's wishlist",
    "POST /api/user/{email}/wishlist":   "Add/remove wishlist item",
    "GET  /api/user/{email}/cart":       "Get user's cart",
    "POST /api/user/{email}/cart":       "Add/remove cart item",
    "GET  /api/user/{email}/ratings":    "Get user's ratings",
    "POST /api/user/{email}/ratings":    "Rate item (1-5 stars)",
    "GET  /api/user/{email}/outfits":    "Get saved outfits",
    "POST /api/user/{email}/outfits":    "Save outfit",
    "DELETE /api/user/{email}/outfits/{id}": "Delete outfit",

    # Orders
    "POST /api/orders":                  "Place order",
    "GET  /api/orders/{email}":          "Get order history",

    # Search & Vision
    "POST /api/ai-search":              "Natural language search",
    "POST /api/image-search":           "Find similar items by image",
    "POST /api/analyze-image":          "Analyze clothing image (Claude Vision)",
    "POST /api/tryon":                  "Virtual try-on",

    # System
    "GET  /health":                      "Health check + catalog count",
}


# ============================================================
# 6. CURL COMMAND TO TEST
# ============================================================

CURL_COMMAND = """
curl -X POST https://fashion-ai-backend.purplesand-63becfba.westus2.azurecontainerapps.io/api/v2/recommendations \\
  -H "Content-Type: application/json" \\
  -d '{
    "user_id": 2,
    "session_id": "user_prefs_session_123",
    "gender": "male",
    "style_preferences": {
      "selected_styles": ["casual", "street"],
      "selected_colors": ["black"],
      "selected_categories": ["t-shirts", "tops", "trousers"]
    },
    "fit_preferences": {
      "fit_preference": "regular",
      "body_type": "athletic",
      "size": "M"
    },
    "body_measurements": {
      "height": 170.0,
      "weight": 70.0
    },
    "context_preferences": {
      "mood": "casual",
      "occasion": "weekend"
    },
    "favorite_stores": ["nike"],
    "top_k": 10
  }'
"""


# ============================================================
# 7. ARCHITECTURE
# ============================================================

ARCHITECTURE = """
┌─────────────────────────────────────────────────────────────┐
│                     ARCHITECTURE                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Shopify Store (shop-urbanity.myshopify.com)                │
│       │                                                     │
│       │ syncs products                                      │
│       ▼                                                     │
│  Boss PostgreSQL DB                                         │
│  (hueiq-core-api.purplesand-...azurecontainerapps.io)       │
│       │                                                     │
│       │ GET /api/stores/1/catalog (598 items, paginated)    │
│       ▼                                                     │
│  Fashion AI Backend (this API)                              │
│  (fashion-ai-backend.purplesand-...azurecontainerapps.io)   │
│       │                                                     │
│       │ 22-signal scoring engine                            │
│       │ + semantic embeddings (all-MiniLM-L6-v2)            │
│       │ + collaborative filtering                           │
│       │ + outfit compatibility                              │
│       ▼                                                     │
│  POST /api/v2/recommendations                              │
│  → Returns top_k items with scores                          │
│                                                             │
│  Users/Auth/Interactions stored in Boss PostgreSQL DB        │
│  Catalog images from Shopify CDN                            │
│  3D meshes from Azure Blob Storage                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
"""

if __name__ == "__main__":
    print(ARCHITECTURE)
    print("\nCURL COMMAND:")
    print(CURL_COMMAND)
    print("\n22 SCORING SIGNALS:")
    for num, sig in SCORING_SIGNALS.items():
        print(f"  {num:2}. {sig['name']:25} ({sig['weight']:8}) — {sig['description']}")
    print(f"\nALL ENDPOINTS ({len(ALL_ENDPOINTS)}):")
    for endpoint, desc in ALL_ENDPOINTS.items():
        print(f"  {endpoint:45} {desc}")
