from fastapi import FastAPI, HTTPException, Query, Path, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any, Tuple
import numpy as np
from datetime import datetime, timedelta
import requests
import math
import random
import hashlib
import json
from collections import Counter
from enum import Enum
import os

# ============================================================================
# FASTAPI APP SETUP
# ============================================================================
app = FastAPI(
    title="HueIQ Advanced Hybrid Recommendation Engine",
    description="Production-grade AI recommendation system with multi-modal fusion",
    version="3.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Security
security = HTTPBearer()

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================================
# ENUMS & CONSTANTS
# ============================================================================
class SortBy(str, Enum):
    RELEVANCE = "relevance"
    PRICE = "price"
    RATING = "rating"

class UserType(str, Enum):
    SHOPPER = "shopper"
    DESIGNER = "designer"
    STORE_ADMIN = "store_admin"

class CategoryType(str, Enum):
    ALL = "all"
    DRESSES = "dresses"
    TOPS = "tops"
    BOTTOMS = "bottoms"
    OUTERWEAR = "outerwear"
    ACCESSORIES = "accessories"
    SHOES = "shoes"

# ============================================================================
# CONFIGURATION
# ============================================================================
class Config:
    # Boss API Configuration
    BOSS_API_URL = os.getenv("BOSS_API_URL", "https://hueiq-core-api.purplesand-63becfba.westus2.azurecontainerapps.io")
    BOSS_TOKEN = os.getenv("BOSS_TOKEN", "")
    
    # Model Weights (Amazon-style hybrid scoring)
    WEIGHTS = {
        "collaborative": 0.30,
        "content_based": 0.20,
        "visual": 0.15,
        "expert_rules": 0.10,   
        "fit_score": 0.10,
        "gender_match": 0.10,
        "seasonal": 0.05
    }
    
    # Cache settings
    CACHE_TTL = int(os.getenv("CACHE_TTL", "3600"))
    MAX_CANDIDATES = int(os.getenv("MAX_CANDIDATES", "500"))
    DEFAULT_TOP_K = int(os.getenv("DEFAULT_TOP_K", "10"))
    
    # Feature dimensions
    EMBEDDING_DIM = int(os.getenv("EMBEDDING_DIM", "128"))
    VISUAL_DIM = int(os.getenv("VISUAL_DIM", "512"))

config = Config()

# ============================================================================
# ADVANCED MODELS
# ============================================================================

class RecommendationRequest(BaseModel):
    """Advanced recommendation request with context"""
    user_id: int = Field(..., description="User ID", gt=0)
    context: Dict[str, Any] = Field(default_factory=dict, description="Contextual information")
    top_k: int = Field(default=10, description="Number of recommendations", ge=1, le=50)
    
    class Config:
        schema_extra = {
            "example": {
                "user_id": 12345,
                "context": {
                    "occasion": "party",
                    "weather": "warm",
                    "location": "mumbai",
                    "time_of_day": "evening",
                    "device": "mirror"
                },
                "top_k": 10
            }
        }

class ARRecommendationRequest(BaseModel):
    """Specialized AR try-on recommendations"""
    user_id: int = Field(..., description="User ID", gt=0)
    photo_id: str = Field(..., description="User photo ID for visual analysis")
    real_time_body_data: Dict[str, Any] = Field(
        default_factory=dict,
        description="Real-time body measurements from AR mirror"
    )
    
    class Config:
        schema_extra = {
            "example": {
                "user_id": 12345,
                "photo_id": "photo_67890",
                "real_time_body_data": {
                    "height": 165,
                    "shoulder_width": 40,
                    "hip_width": 38,
                    "torso_length": 50,
                    "body_shape": "hourglass"
                }
            }
        }

class RecommendationItem(BaseModel):
    """Rich recommendation item with metadata"""
    id: int = Field(..., description="Item ID")
    name: str = Field(..., description="Item name")
    price: float = Field(..., description="Price", gt=0)
    category: str = Field(..., description="Category")
    image: str = Field(..., description="Image URL")
    colors: List[str] = Field(default_factory=list, description="Available colors")
    score: float = Field(..., description="Recommendation score", ge=0, le=1)
    reason: str = Field(..., description="Why this item was recommended")
    description: str = Field(default="", description="Item description")
    rating: float = Field(default=0, description="Average rating", ge=0, le=5)
    in_stock: bool = Field(default=True, description="Stock status")
    brand: Optional[str] = Field(None, description="Brand name")
    sizes: List[str] = Field(default_factory=list, description="Available sizes")
    discount: Optional[float] = Field(None, description="Discount percentage", ge=0, le=100)
    is_new: bool = Field(default=False, description="New arrival")
    materials: List[str] = Field(default_factory=list, description="Materials")
    sustainability_score: Optional[float] = Field(None, description="Eco-friendliness score", ge=0, le=1)

class RecommendationResponse(BaseModel):
    """Comprehensive recommendation response"""
    user_id: int
    user_email: str = ""
    total_recommendations: int
    items: List[RecommendationItem]
    filters_applied: Dict[str, Any] = Field(default_factory=dict)
    recommendation_id: str = Field(default_factory=lambda: hashlib.md5(str(datetime.now()).encode()).hexdigest()[:8])
    processing_time_ms: Optional[float] = None
    
    class Config:
        schema_extra = {
            "example": {
                "user_id": 12345,
                "user_email": "user@example.com",
                "total_recommendations": 10,
                "recommendation_id": "a1b2c3d4",
                "processing_time_ms": 245,
                "items": [],
                "filters_applied": {"occasion": "party"}
            }
        }

class ItemResponse(BaseModel):
    """Single item response for catalog endpoints"""
    id: int
    name: str
    price: float
    category: str
    image: str
    colors: List[str] = []
    score: float = 0.8
    reason: str = "Popular item"
    description: str = ""
    rating: float = 0
    in_stock: bool = True
    brand: Optional[str] = None
    discount: Optional[float] = None

class CatalogResponse(BaseModel):
    """Catalog listing response"""
    user_id: int = 0
    user_email: str = ""
    total_recommendations: int
    items: List[ItemResponse]
    filters_applied: Dict[str, Any] = Field(default_factory=dict)

class TrendingResponse(BaseModel):
    """Trending items response"""
    user_id: int = 0
    user_email: str = ""
    total_recommendations: int
    items: List[ItemResponse]
    filters_applied: Dict[str, Any] = Field(default_factory=dict)

# ============================================================================
# CORE UTILITIES
# ============================================================================

class VectorUtils:
    @staticmethod
    def cosine_similarity(vec1: List[float], vec2: List[float]) -> float:
        """Calculate cosine similarity between two vectors"""
        if not vec1 or not vec2:
            return 0.0
        vec1, vec2 = np.array(vec1), np.array(vec2)
        dot = np.dot(vec1, vec2)
        norm1 = np.linalg.norm(vec1)
        norm2 = np.linalg.norm(vec2)
        if norm1 == 0 or norm2 == 0:
            return 0.0
        return float(dot / (norm1 * norm2))
    
    @staticmethod
    def euclidean_distance(vec1: List[float], vec2: List[float]) -> float:
        """Calculate Euclidean distance"""
        if not vec1 or not vec2:
            return float('inf')
        return float(np.linalg.norm(np.array(vec1) - np.array(vec2)))
    
    @staticmethod
    def jaccard_similarity(set1: set, set2: set) -> float:
        """Calculate Jaccard similarity for sets"""
        if not set1 or not set2:
            return 0.0
        intersection = len(set1.intersection(set2))
        union = len(set1.union(set2))
        return intersection / union if union > 0 else 0.0

class CollaborativeFilter:
    """Advanced collaborative filtering with multiple strategies"""
    
    @staticmethod
    def user_based_cf(user_id: int, item_id: int, user_item_matrix: Dict = None) -> float:
        """User-based collaborative filtering"""
        # Simulated - in production, use actual interaction data
        popularity_map = {
            "popular": 0.9,
            "trending": 0.8,
            "regular": 0.5,
            "niche": 0.3
        }
        return popularity_map.get(str(item_id)[:3], 0.5)
    
    @staticmethod
    def item_based_cf(item_id: int, user_history: List[int]) -> float:
        """Item-based collaborative filtering"""
        if not user_history:
            return 0.3
        # Simulate similarity with user's past items
        return min(0.3 + len(user_history) * 0.1, 0.9)
    
    @staticmethod
    def matrix_factorization(user_id: int, item_id: int, latent_factors: Tuple = None) -> float:
        """Matrix factorization based CF"""
        # Simulated latent factors
        return 0.6 + (hash(f"{user_id}-{item_id}") % 30) / 100

class VisualSimilarity:
    """Visual similarity using CNN embeddings"""
    
    @staticmethod
    def extract_features(image_url: str) -> List[float]:
        """Simulate feature extraction from image"""
        # In production, use actual CNN (ResNet, EfficientNet)
        return [random.random() for _ in range(512)]
    
    @staticmethod
    def compare_embeddings(user_embedding: List[float], item_embedding: List[float]) -> float:
        """Compare visual embeddings"""
        return VectorUtils.cosine_similarity(user_embedding, item_embedding)

class ExpertRules:
    """Fashion expert rule system"""
    
    @staticmethod
    def color_compatibility(user_skin_tone: str, item_color: str) -> float:
        """Check color compatibility with skin tone"""
        # Expert color theory rules
        compatible = {
            "warm": ["red", "orange", "yellow", "brown", "olive"],
            "cool": ["blue", "purple", "pink", "silver", "white"],
            "neutral": ["black", "white", "gray", "navy", "beige"]
        }
        user_tone = user_skin_tone or "neutral"
        return 1.0 if item_color.lower() in compatible.get(user_tone, []) else 0.3
    
    @staticmethod
    def occasion_matching(item_occasion: str, user_occasion: str) -> float:
        """Match item to occasion"""
        occasion_map = {
            "party": 1.0, "wedding": 1.0,
            "casual": 0.8, "work": 0.8,
            "sports": 0.6, "formal": 0.9
        }
        return occasion_map.get(user_occasion, 0.5)
    
    @staticmethod
    def body_fit_compatibility(user_body: Dict, item_fit: Dict) -> float:
        """Calculate body fit compatibility"""
        if not user_body or not item_fit:
            return 0.5
        
        # Calculate differences
        shoulder_diff = abs(user_body.get("shoulder_width", 0) - item_fit.get("shoulder_width", 0))
        hip_diff = abs(user_body.get("hip_width", 0) - item_fit.get("hip_width", 0))
        torso_diff = abs(user_body.get("torso_length", 0) - item_fit.get("torso_length", 0))
        
        # Normalize score
        total_diff = (shoulder_diff + hip_diff + torso_diff) / 100
        return max(0, min(1, 1.0 - total_diff))
    
    @staticmethod
    def style_coherence(user_style: List[str], item_style: List[str]) -> float:
        """Check if item matches user's style preferences"""
        if not user_style or not item_style:
            return 0.5
        return VectorUtils.jaccard_similarity(set(user_style), set(item_style))

class SeasonalAnalyzer:
    """Seasonal and trend analysis"""
    
    @staticmethod
    def current_season() -> str:
        """Get current season based on date"""
        month = datetime.now().month
        if 3 <= month <= 5:
            return "spring"
        elif 6 <= month <= 8:
            return "summer"
        elif 9 <= month <= 11:
            return "fall"
        else:
            return "winter"
    
    @staticmethod
    def season_score(item: Dict) -> float:
        """Calculate how well item matches current season"""
        season = SeasonalAnalyzer.current_season()
        seasonal_items = {
            "spring": ["pastel", "floral", "light", "linen"],
            "summer": ["cotton", "linen", "short", "light", "bright"],
            "fall": ["sweater", "layered", "warm", "earth"],
            "winter": ["wool", "coat", "heavy", "thermal"]
        }
        
        item_material = item.get("material", "").lower()
        item_category = item.get("category", "").lower()
        
        for keyword in seasonal_items.get(season, []):
            if keyword in item_material or keyword in item_category:
                return 1.0
        return 0.5
    
    @staticmethod
    def trending_score(item_id: int, interaction_history: List[Dict]) -> float:
        """Calculate trending score based on recent interactions"""
        if not interaction_history:
            return 0.5
        
        # Count recent interactions for this item
        recent = [i for i in interaction_history[-100:] if i.get("item_id") == item_id]
        return min(len(recent) / 10, 1.0)

class DiversityRanker:
    """Maximal Marginal Relevance (MMR) for diversity"""
    
    @staticmethod
    def mmr_rank(items: List[Dict], relevance_fn, lambda_param: float = 0.7, k: int = 10) -> List[Dict]:
        """
        Maximal Marginal Relevance for diverse ranking
        Score = λ * relevance - (1-λ) * max_similarity_to_selected
        """
        if not items:
            return []
        
        # Select highest relevance first
        ranked = [max(items, key=lambda x: relevance_fn(x))]
        remaining = [i for i in items if i != ranked[0]]
        
        for _ in range(min(k - 1, len(remaining))):
            best_item = None
            best_score = -float('inf')
            
            for item in remaining:
                relevance = relevance_fn(item)
                # Calculate max similarity to already ranked items
                max_sim = max(
                    [VectorUtils.cosine_similarity(
                        item.get("embedding", [0]),
                        r.get("embedding", [0])
                    ) for r in ranked],
                    default=0
                )
                # MMR score
                mmr_score = lambda_param * relevance - (1 - lambda_param) * max_sim
                
                if mmr_score > best_score:
                    best_score = mmr_score
                    best_item = item
            
            if best_item:
                ranked.append(best_item)
                remaining.remove(best_item)
        
        return ranked

# ============================================================================
# BOSS API INTEGRATION
# ============================================================================

class BossAPIClient:
    """Advanced API client with caching, retries, and fallbacks"""
    
    def __init__(self):
        self.base_url = config.BOSS_API_URL
        self.token = config.BOSS_TOKEN
        self.cache = {}
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
    
    def _get_headers(self):
        return {"Authorization": f"Bearer {self.token}"}
    
    def _cache_get(self, key):
        if key in self.cache:
            data, timestamp = self.cache[key]
            if (datetime.now() - timestamp).seconds < config.CACHE_TTL:
                return data
        return None
    
    def _cache_set(self, key, data):
        self.cache[key] = (data, datetime.now())
    
    def refresh_token(self):
        """Get fresh token from boss API"""
        try:
            response = requests.post(
                f"{self.base_url}/api/auth/login",
                json={"email": "admin@hueiq.com", "password": "admin123"}
            )
            if response.status_code == 200:
                self.token = response.json().get("access_token")
                print(f"✅ Token refreshed: {self.token[:20]}...")
                return True
        except Exception as e:
            print(f"❌ Token refresh failed: {e}")
        return False
    
    def call_api(self, endpoint: str, method: str = "GET", data: Dict = None, use_cache: bool = True):
        """Make API call with retry and cache"""
        cache_key = f"{method}:{endpoint}:{json.dumps(data) if data else ''}"
        
        # Check cache
        if use_cache and method == "GET":
            cached = self._cache_get(cache_key)
            if cached:
                print(f"📦 Cache hit for {endpoint}")
                return cached
        
        # Make request with retry
        for attempt in range(2):  # Max 2 attempts
            try:
                headers = self._get_headers()
                url = f"{self.base_url}{endpoint}"
                
                if method == "GET":
                    response = self.session.get(url, headers=headers, timeout=5)
                elif method == "POST":
                    response = self.session.post(url, headers=headers, json=data, timeout=5)
                else:
                    return None
                
                # Handle token expiration
                if response.status_code == 401 and attempt == 0:
                    if self.refresh_token():
                        continue
                
                if response.status_code == 200:
                    result = response.json()
                    if use_cache and method == "GET":
                        self._cache_set(cache_key, result)
                    return result
                else:
                    print(f"⚠️ API error {response.status_code}: {endpoint}")
                    return None
                    
            except Exception as e:
                print(f"⚠️ API exception (attempt {attempt+1}): {e}")
        
        return None
    
    def get_catalog(self, force_refresh: bool = False) -> List[Dict]:
        """Get catalog with caching"""
        return self.call_api("/api/catalog/all", use_cache=not force_refresh) or []
    
    def get_user(self, user_id: int) -> Dict:
        """Get user data"""
        return self.call_api(f"/api/users/{user_id}") or {}
    
    def get_user_interactions(self, user_id: int) -> List[Dict]:
        """Get user interaction history"""
        return self.call_api(f"/api/interactions/{user_id}/interactions") or []
    
    def get_user_photos(self, user_id: int) -> List[Dict]:
        """Get user photos"""
        return self.call_api(f"/api/users/{user_id}/photos") or []
    
    def get_user_features(self, user_id: int) -> Dict:
        """Get user feature vector"""
        return self.call_api(f"/api/features/user/{user_id}") or {}
    
    def get_catalog_features(self, catalog_item_id: int) -> Dict:
        """Get catalog item feature vector"""
        return self.call_api(f"/api/features/catalog/{catalog_item_id}") or {}
    
    def get_trending(self, limit: int = 10) -> List[Dict]:
        """Get trending items"""
        return self.call_api(f"/api/recommendations/trending?limit={limit}") or []
    
    # ===== MISSING METHODS ADDED HERE =====
    def get_session_items(self, user_id: int) -> List:
        """Get items viewed in current session"""
        return self.call_api(f"/api/users/{user_id}/session") or []
    
    def get_cart_items(self, user_id: int) -> List:
        """Get items in user's cart"""
        return self.call_api(f"/api/users/{user_id}/cart") or []
    
    def get_wishlist(self, user_id: int) -> List:
        """Get user's wishlist items"""
        return self.call_api(f"/api/users/{user_id}/wishlist") or []
    
    def get_recent_purchases(self, user_id: int) -> List:
        """Get user's recent purchases"""
        return self.call_api(f"/api/users/{user_id}/purchases/recent") or []
    
    def get_purchase_history(self, user_id: int) -> List:
        """Get user's purchase history"""
        return self.call_api(f"/api/users/{user_id}/purchases") or []
    
    def get_friends_who_bought(self, item_id: int) -> int:
        """Get number of friends who bought this item"""
        result = self.call_api(f"/api/items/{item_id}/friends-bought")
        return result.get("count", 0) if result else 0
    
    def get_item_reviews(self, item_id: int) -> List:
        """Get reviews for an item"""
        return self.call_api(f"/api/items/{item_id}/reviews") or []
    
    def get_social_mentions(self, item_id: int) -> int:
        """Get social media mention count"""
        result = self.call_api(f"/api/items/{item_id}/social-mentions")
        return result.get("count", 0) if result else 0
    
    def get_age_group_preferences(self, age_group: str) -> List:
        """Get popular categories for age group"""
        result = self.call_api(f"/api/analytics/age-group/{age_group}")
        return result.get("categories", []) if result else []
    
    def get_local_trends(self, city: str) -> List:
        """Get trending items in a city"""
        result = self.call_api(f"/api/trends/local?city={city}")
        return result.get("categories", []) if result else []
    
    def get_item_category(self, item_id: int) -> str:
        """Get category of an item"""
        if not item_id:
            return ""
        result = self.call_api(f"/api/items/{item_id}")
        return result.get("category", "") if result else ""
    
    def get_user_test_group(self, user_id: int) -> str:
        """Get A/B test group for user"""
        result = self.call_api(f"/api/users/{user_id}/test-group")
        return result.get("group", "control") if result else "control"

# Initialize API client
boss_api = BossAPIClient()

# ============================================================================
# SIMULATED DATA GENERATOR (FALLBACK)
# ============================================================================

class DataGenerator:
    """Generate realistic fashion data for fallback"""
    
    @staticmethod
    def generate_catalog(count: int = 100) -> List[Dict]:
        """Generate simulated catalog"""
        categories = ["dresses", "tops", "bottoms", "outerwear", "accessories"]
        colors = ["black", "white", "red", "blue", "green", "yellow", "purple", "pink", "brown", "gray"]
        materials = ["cotton", "polyester", "wool", "silk", "linen", "denim", "leather"]
        brands = ["Zara", "H&M", "Gucci", "Prada", "Nike", "Adidas", "Levi's", "Uniqlo"]
        
        items = []
        for i in range(1, count + 1):
            category = random.choice(categories)
            color = random.choice(colors)
            
            items.append({
                "id": i,
                "name": f"{color.title()} {category.title()} {i}",
                "price": round(random.uniform(19.99, 299.99), 2),
                "category": category,
                "color": color,
                "colors": [color, random.choice(colors)],
                "image": f"https://images.unsplash.com/photo-{random.randint(1000000, 9999999)}?w=400",
                "description": f"Beautiful {color} {category} perfect for any occasion",
                "rating": round(random.uniform(3.5, 5.0), 1),
                "in_stock": random.random() > 0.2,
                "brand": random.choice(brands),
                "sizes": ["XS", "S", "M", "L", "XL"][:random.randint(3, 5)],
                "materials": [random.choice(materials)],
                "is_new": random.random() > 0.7,
                "discount": random.choice([0, 10, 20, 30, 50]) if random.random() > 0.5 else None,
                "occasion": random.choice(["casual", "party", "formal", "sports"]),
                "style": random.choice(["modern", "classic", "bohemian", "minimalist"]),
                "sustainability_score": round(random.uniform(0.3, 0.95), 2)
            })
        
        return items
    
    @staticmethod
    def generate_user(user_id: int) -> Dict:
        """Generate simulated user"""
        body_shapes = ["hourglass", "pear", "rectangle", "apple", "athletic"]
        skin_tones = ["warm", "cool", "neutral"]
        
        return {
            "id": user_id,
            "email": f"user{user_id}@example.com",
            "name": f"User {user_id}",
            "gender": random.choice(["male", "female", "non-binary"]),
            "age": random.randint(18, 65),
            "body_measurements": {
                "height": random.randint(150, 190),
                "weight": random.randint(50, 90),
                "body_shape": random.choice(body_shapes),
                "shoulder_width": random.randint(35, 45),
                "hip_width": random.randint(35, 45),
                "torso_length": random.randint(45, 60)
            },
            "style_profile": {
                "skin_tone": random.choice(skin_tones),
                "preferred_colors": random.sample(["black", "white", "red", "blue", "green"], 3),
                "preferred_fit": random.sample(["slim", "regular", "loose"], 2),
                "preferred_categories": random.sample(["dresses", "tops", "jeans", "jackets"], 2),
                "occasions": random.sample(["casual", "party", "work", "sports"], 2)
            },
            "preferences": {
                "price_range": [20, 200],
                "brands": random.sample(["Zara", "H&M", "Nike", "Adidas"], 2)
            }
        }

# ============================================================================
# HYBRID RECOMMENDATION ENGINE
# ============================================================================

class HybridRecommendationEngine:
    """Advanced hybrid recommendation engine with multi-modal fusion"""
    
    def __init__(self):
        self.vector_utils = VectorUtils()
        self.collaborative = CollaborativeFilter()
        self.visual = VisualSimilarity()
        self.expert = ExpertRules()
        self.seasonal = SeasonalAnalyzer()
        self.diversity = DiversityRanker()
        self.boss_api = boss_api
        self.data_gen = DataGenerator()
    
    def _get_user_embedding(self, user_id: int, user_data: Dict) -> List[float]:
        """Generate user embedding from multiple signals"""
        # Try to get from boss API first
        features = self.boss_api.get_user_features(user_id)
        if features and features.get("embedding_vector"):
            return features["embedding_vector"]
        
        # Generate synthetic embedding
        random.seed(user_id)
        return [random.random() for _ in range(config.EMBEDDING_DIM)]
    
    def _get_item_embedding(self, item_id: int, item_data: Dict) -> List[float]:
        """Generate item embedding"""
        features = self.boss_api.get_catalog_features(item_id)
        if features and features.get("embedding_vector"):
            return features["embedding_vector"]
        
        # Generate synthetic embedding based on item attributes
        random.seed(item_id)
        return [random.random() for _ in range(config.EMBEDDING_DIM)]
    
    def _add_real_time_signals(self, item, user_id, context):
        """Boost items based on real-time behavior"""
        signals = {}
        
        # Session-based (what they viewed in last 30 min)
        session_items = self.boss_api.get_session_items(user_id)
        if item["id"] in session_items:
            signals["in_session"] = 0.3
        
        # Cart abandonment
        cart_items = self.boss_api.get_cart_items(user_id)
        if item["id"] in cart_items:
            signals["in_cart"] = 0.5
        
        # Wishlist
        wishlist_items = self.boss_api.get_wishlist(user_id)
        if item["id"] in wishlist_items:
            signals["in_wishlist"] = 0.4
        
        # Recently purchased similar
        recent_purchases = self.boss_api.get_recent_purchases(user_id)
        if any(self._is_similar_category(item, p) for p in recent_purchases):
            signals["purchase_affinity"] = 0.2
        
        return signals
    
    def _is_similar_category(self, item1, item2):
        """Check if two items are in similar categories"""
        cat1 = item1.get("category", "")
        cat2 = item2.get("category", "")
        return cat1 == cat2
    
    def _price_sensitivity_score(self, user_data, item_price):
        """Adjust based on user's price sensitivity"""
        price_range = user_data.get("price_range", {})
        min_price = price_range.get("min", 0)
        max_price = price_range.get("max", 1000)
        preferred = price_range.get("preferred", 200)
        
        if item_price < min_price:
            return 0.3  # Too cheap, maybe low quality
        elif item_price > max_price:
            return 0.1  # Too expensive
        elif abs(item_price - preferred) < 50:
            return 1.0  # Perfect price
        else:
            # Gaussian decay around preferred price
            import math
            return math.exp(-0.5 * ((item_price - preferred) / 100) ** 2)
    
    def _brand_loyalty_score(self, user_id, item_brand):
        """Boost brands the user loves"""
        purchase_history = self.boss_api.get_purchase_history(user_id)
        brand_counts = {}
        
        for purchase in purchase_history:
            brand = purchase.get("brand")
            if brand:
                brand_counts[brand] = brand_counts.get(brand, 0) + 1
        
        # Calculate brand affinity (normalized)
        if not brand_counts:
            return 0.5  # Neutral for new users
        
        total = sum(brand_counts.values())
        brand_freq = brand_counts.get(item_brand, 0) / total
        
        # Diminishing returns after 30% share
        return min(brand_freq * 2, 0.9)
    
    def _social_proof_score(self, item_id):
        """Add social signals"""
        signals = {}
        
        # Friends who bought/liked
        friends_count = self.boss_api.get_friends_who_bought(item_id)
        signals["friends_bought"] = min(friends_count / 10, 0.3)
        
        # Review sentiment
        reviews = self.boss_api.get_item_reviews(item_id)
        if reviews:
            avg_rating = sum(r.get("rating", 3) for r in reviews) / len(reviews)
            signals["rating"] = (avg_rating / 5) * 0.2
        
        # Review count (popularity)
        signals["review_count"] = min(len(reviews) / 100, 0.1)
        
        # Social media mentions
        mentions = self.boss_api.get_social_mentions(item_id)
        signals["social_mentions"] = min(mentions / 1000, 0.2)
        
        return sum(signals.values())
    
    def _complementary_score(self, item, user_id):
        """Boost items that complete an outfit"""
        cart = self.boss_api.get_cart_items(user_id)
        if not cart:
            return 0
        
        # Check if item complements items in cart
        for cart_item in cart:
            if self._is_complementary(item, cart_item):
                return 0.4  # Big boost for outfit completion
        
        return 0
    
    def _is_complementary(self, item1, item2):
        """Check if items complement each other (e.g., shirt and pants)"""
        # Simple logic - can be expanded
        categories = [item1.get("category", ""), item2.get("category", "")]
        complement_pairs = [
            ("shirt", "pants"), ("top", "bottom"),
            ("dress", "shoes"), ("jacket", "pants")
        ]
        return any(set(pair).issubset(set(categories)) for pair in complement_pairs)
    
    def _get_age_group(self, age):
        """Convert age to age group"""
        if age < 18:
            return "teen"
        elif age < 25:
            return "young_adult"
        elif age < 35:
            return "adult"
        elif age < 50:
            return "middle_age"
        else:
            return "senior"
    
    def _demographic_score(self, user_data, item):
        """Match based on demographic patterns"""
        score = 0
        
        # Age group preferences
        age_group = self._get_age_group(user_data.get("age", 30))
        age_preferences = self.boss_api.get_age_group_preferences(age_group)
        if item.get("category") in age_preferences:
            score += 0.15
        
        # Location-based (weather, local trends)
        location = user_data.get("location", {})
        city = location.get("city", "")
        local_trends = self.boss_api.get_local_trends(city)
        if item.get("category") in local_trends:
            score += 0.1
        
        # Income bracket
        income = user_data.get("income_bracket", "medium")
        if self._price_matches_income(item.get("price", 0), income):
            score += 0.1
        
        return min(score, 0.3)
    
    def _price_matches_income(self, price, income_bracket):
        """Check if price matches income bracket"""
        income_ranges = {
            "low": 50,
            "medium": 150,
            "high": 300,
            "luxury": 500
        }
        threshold = income_ranges.get(income_bracket, 150)
        return price <= threshold
    
    def _exploration_boost(self, user_id, item_id, user_data):
        """Boost novel items for users who need exploration"""
        interactions = self.boss_api.get_user_interactions(user_id)
        viewed_items = {i.get("item_id") for i in interactions}
        
        # Calculate user's exploration need
        if len(viewed_items) < 20:  # New user
            exploration_need = 0.3
        else:
            # Check if they're in a rut (viewing same categories)
            categories = []
            for i in viewed_items:
                cat = self.boss_api.get_item_category(i)
                if cat:
                    categories.append(cat)
            
            if categories:
                category_diversity = len(set(categories)) / len(categories)
                exploration_need = max(0, 0.5 - category_diversity)
            else:
                exploration_need = 0.2
        
        # Boost if this is a new category for them
        item_category = self.boss_api.get_item_category(item_id)
        if item_category and item_category not in categories:
            return exploration_need
        
        return 0
    
    def _cross_sell_score(self, item, user_id):
        """Identify cross-sell/upsell opportunities"""
        purchases = self.boss_api.get_purchase_history(user_id)
        if not purchases:
            return 0
        
        last_purchase = purchases[0] if purchases else {}
        
        # Upsell: better version of what they bought
        if self._is_premium_version(item, last_purchase):
            return 0.5
        
        # Cross-sell: accessories for main item
        if self._is_accessory_for(item, last_purchase):
            return 0.4
        
        return 0
    
    def _is_premium_version(self, item, last_purchase):
        """Check if item is premium version of last purchase"""
        return (item.get("category") == last_purchase.get("category") and
                item.get("price", 0) > last_purchase.get("price", 0) * 1.5)
    
    def _is_accessory_for(self, item, main_item):
        """Check if item is accessory for main purchase"""
        accessories = ["belt", "watch", "bag", "jewelry", "sunglasses"]
        main_categories = ["shirt", "pants", "dress", "jacket", "shoes"]
        
        return (item.get("category") in accessories and
                main_item.get("category") in main_categories)
    
    def _ab_test_boost(self, user_id, item_id):
        """Apply different weights based on A/B test group"""
        test_group = self.boss_api.get_user_test_group(user_id)
        
        test_configs = {
            "control": {"boost": 0},
            "test_boost": {"boost": 0.2, "categories": ["premium"]},
            "test_diversity": {"boost": 0.15, "min_score": 0.6}
        }
        
        config = test_configs.get(test_group, {"boost": 0})
        
        if config.get("categories") and item_id not in config["categories"]:
            return 0
        
        return config["boost"]
    
    def _event_score(self, context):
        """Boost items relevant to current events"""
        from datetime import datetime
        today = datetime.now()
        events = []
        
        # Check for holidays
        if today.month == 12 and today.day >= 20:
            events.append("christmas")
        if today.month == 2 and today.day == 14:
            events.append("valentines")
        if today.month == 10 and today.day == 31:
            events.append("halloween")
        
        # Add weather-based events
        weather = context.get("weather", {})
        if weather.get("temp", 20) < 10:
            events.append("cold_weather")
        if weather.get("temp", 20) > 25:
            events.append("warm_weather")
        
        return events
    
    def _calculate_hybrid_score(
        self,
        item: Dict,
        user_id: int,
        user_data: Dict,
        user_embedding: List[float],
        item_embedding: List[float],
        interactions: List[Dict],
        context: Dict
    ) -> Tuple[float, Dict]:
        """Calculate hybrid score using multiple signals"""
        
        item_id = item.get("id", item.get("catalog_item_id", 0))
        
        # 1. Collaborative signals
        collab_score = self.collaborative.user_based_cf(user_id, item_id)
        
        # 2. Content-based similarity
        content_score = self.vector_utils.cosine_similarity(
            user_embedding, item_embedding
        )
        
        # 3. Visual similarity (if embeddings available)
        visual_score = self.visual.compare_embeddings(
            user_embedding, item_embedding
        )
        
        # 4. Expert rules
        expert_score = self.expert.style_coherence(
            user_data.get("style_profile", {}).get("preferred_colors", []),
            [item.get("color", "")]
        )
        
        # 5. Fit score
        fit_score = self.expert.body_fit_compatibility(
            user_data.get("body_measurements", {}),
            {"shoulder_width": 40, "hip_width": 38, "torso_length": 50}  # Ideal fit
        )
        
        # 6. Gender match
        gender_score = 1.0
        user_gender = user_data.get("gender")
        item_gender = item.get("gender", "unisex")
        if user_gender and item_gender != "unisex":
            gender_score = 1.0 if item_gender == user_gender else 0.3
        
        # 7. Seasonal match
        seasonal_score = self.seasonal.season_score(item)
        
        # 8. Trending score
        trending_score = self.seasonal.trending_score(item_id, interactions)
        
        # 9. Preference boosts
        preference_boost = 0.0
        style_profile = user_data.get("style_profile", {})
        
        if item.get("color") in style_profile.get("preferred_colors", []):
            preference_boost += 0.15
        if item.get("category") in style_profile.get("preferred_categories", []):
            preference_boost += 0.10
        if item.get("fit") in style_profile.get("preferred_fit", []):
            preference_boost += 0.10
        
        # 10. Contextual boost (occasion, weather, etc.)
        context_boost = 0.0
        if context.get("occasion"):
            context_boost += self.expert.occasion_matching(
                item.get("occasion", ""),
                context["occasion"]
            ) * 0.1
        
        # 11. Recency & popularity
        recency_boost = 0.1 if item.get("is_new") else 0.0
        discount_boost = (item.get("discount", 0) or 0) * 0.01
        
        # 12. Sustainability
        sustainability_boost = (item.get("sustainability_score", 0) or 0) * 0.05
        
        # NEW SIGNALS
        real_time_signals = self._add_real_time_signals(item, user_id, context)
        real_time_boost = sum(real_time_signals.values()) * 0.2
        
        price_score = self._price_sensitivity_score(user_data, item.get("price", 100)) * 0.1
        
        brand_score = self._brand_loyalty_score(user_id, item.get("brand", "")) * 0.1
        
        social_score = self._social_proof_score(item.get("id", 0)) * 0.15
        
        complementary_score = self._complementary_score(item, user_id) * 0.2
        
        demographic_score = self._demographic_score(user_data, item) * 0.1
        
        explore_boost = self._exploration_boost(user_id, item.get("id", 0), user_data) * 0.1
        
        cross_sell = self._cross_sell_score(item, user_id) * 0.1
        
        ab_boost = self._ab_test_boost(user_id, item.get("id", 0)) * 0.05
        
        # Weighted final score
        weights = config.WEIGHTS
        final_score = (
            weights["collaborative"] * collab_score +
            weights["content_based"] * content_score +
            weights["visual"] * visual_score +
            weights["expert_rules"] * expert_score +
            weights["fit_score"] * fit_score +
            weights["gender_match"] * gender_score +
            weights["seasonal"] * seasonal_score +
            preference_boost +
            context_boost +
            recency_boost +
            discount_boost +
            sustainability_boost +
            trending_score * 0.05 +
            real_time_boost +
            price_score +
            brand_score +
            social_score +
            complementary_score +
            demographic_score +
            explore_boost +
            cross_sell +
            ab_boost
        )
        
        # Normalize
        final_score = min(max(final_score, 0), 1)
        
        score_breakdown = {
            "collaborative": round(collab_score, 3),
            "content": round(content_score, 3),
            "visual": round(visual_score, 3),
            "expert": round(expert_score, 3),
            "fit": round(fit_score, 3),
            "gender": round(gender_score, 3),
            "seasonal": round(seasonal_score, 3),
            "trending": round(trending_score, 3),
            "preferences": round(preference_boost, 3),
            "context": round(context_boost, 3),
            "recency": recency_boost,
            "discount": discount_boost,
            "sustainability": round(sustainability_boost, 3),
            "real_time": round(real_time_boost, 3),
            "price": round(price_score, 3),
            "brand": round(brand_score, 3),
            "social": round(social_score, 3),
            "complementary": round(complementary_score, 3),
            "demographic": round(demographic_score, 3),
            "exploration": round(explore_boost, 3),
            "cross_sell": round(cross_sell, 3),
            "ab_test": round(ab_boost, 3)
        }
        
        return final_score, score_breakdown
    
    def _format_recommendation_item(
        self,
        item: Dict,
        score: float,
        breakdown: Dict,
        index: int
    ) -> RecommendationItem:
        """Format item for response"""
        
        # Determine primary reason
        max_signal = max(breakdown.items(), key=lambda x: x[1] if isinstance(x[1], (int, float)) else 0)
        signal_names = {
            "collaborative": "popular with similar shoppers",
            "content": "matches your style profile",
            "visual": "visually similar to items you like",
            "expert": "recommended by fashion experts",
            "fit": "perfect fit for your body type",
            "trending": "trending now",
            "preferences": "matches your preferences",
            "real_time": "based on your recent activity",
            "price": "fits your budget",
            "brand": "from a brand you love",
            "social": "popular with others",
            "complementary": "completes your outfit",
            "demographic": "popular in your area",
            "exploration": "something new for you",
            "cross_sell": "goes well with your recent purchase"
        }
        reason = signal_names.get(max_signal[0], "personalized for you")
        
        return RecommendationItem(
            id=item.get("id", index),
            name=item.get("name", "Fashion Item"),
            price=float(item.get("price", 99.99)),
            category=item.get("category", "Clothing"),
            image=item.get("image", "https://images.unsplash.com/photo-1441986300919-14419ef2a5ad?w=400"),
            colors=item.get("colors", [item.get("color", "Unknown")]),
            score=score,
            reason=f"{reason} (score: {score:.2f})",
            description=item.get("description", ""),
            rating=float(item.get("rating", 4.5)),
            in_stock=item.get("in_stock", True),
            brand=item.get("brand"),
            sizes=item.get("sizes", []),
            discount=item.get("discount"),
            is_new=item.get("is_new", False),
            materials=item.get("materials", []),
            sustainability_score=item.get("sustainability_score")
        )
    
    def recommend(
        self,
        user_id: int,
        context: Dict = None,
        top_k: int = 10
    ) -> RecommendationResponse:
        """Generate hybrid recommendations"""
        
        import time
        import json
        import hashlib
        from datetime import datetime
        
        start_time = time.time()
        
        context = context or {}
        
        print(f"\n{'='*70}")
        print(f"🚀 HYBRID RECOMMENDATION ENGINE v3.0")
        print(f"📊 User ID: {user_id}, Top K: {top_k}")
        print(f"📋 Context: {json.dumps(context, indent=2)}")
        print(f"{'='*70}")
        
        # STEP 1: Fetch user data
        print("\n📡 Fetching user data...")
        user_data = self.boss_api.get_user(user_id)
        if not user_data:
            print("⚠️ User not found in boss API, using simulated data")
            user_data = self.data_gen.generate_user(user_id)
        
        # STEP 2: Fetch user interactions
        interactions = self.boss_api.get_user_interactions(user_id) or []
        print(f"📊 Found {len(interactions)} user interactions")
        
        # STEP 3: Get user embedding
        user_embedding = self._get_user_embedding(user_id, user_data)
        
        # STEP 4: Fetch catalog
        print("\n📦 Fetching catalog...")
        catalog = self.boss_api.get_catalog()
        if not catalog:
            print("⚠️ Catalog fetch failed, using simulated data")
            catalog = self.data_gen.generate_catalog(100)
        print(f"📦 Loaded {len(catalog)} catalog items")
        
        # STEP 5: Score all candidates
        print("\n⚖️ Scoring candidates with hybrid algorithm...")
        scored_items = []
        
        # Ensure catalog is a list and handle empty case
        if not catalog:
            catalog = []
        
        max_candidates = min(100, len(catalog))  # Limit for performance
        
        # Safely slice the catalog and process items
        items_to_process = catalog[:max_candidates] if catalog else []
        
        for i, item in enumerate(items_to_process):
            # Get item embedding
            item_embedding = self._get_item_embedding(
                item.get("id", i),
                item
            )
            
            # Calculate hybrid score
            score, breakdown = self._calculate_hybrid_score(
                item, user_id, user_data,
                user_embedding, item_embedding,
                interactions, context
            )
            
            # Store item with embedding for diversity
            item_with_embedding = item.copy()
            item_with_embedding["embedding"] = item_embedding
            
            scored_items.append({
                "item": item_with_embedding,
                "score": score,
                "breakdown": breakdown
            })
        
        # STEP 6: Sort by score
        scored_items.sort(key=lambda x: x["score"], reverse=True)
        print(f"\n📊 Top scores: {[round(s['score'], 3) for s in scored_items[:5]]}")
        
        # STEP 7: Apply diversity ranking
        print("\n🌈 Applying diversity ranking (MMR)...")
        diverse_items = self.diversity.mmr_rank(
            scored_items,
            lambda x: x["score"],
            lambda_param=0.7,
            k=min(top_k * 2, len(scored_items))
        )
        
        # STEP 8: Format response
        recommendations = []
        for i, scored in enumerate(diverse_items[:top_k]):
            item = scored["item"]
            recommendations.append(self._format_recommendation_item(
                item, scored["score"], scored["breakdown"], i
            ))
        
        # STEP 9: Generate recommendation ID
        rec_id = hashlib.md5(
            f"{user_id}{datetime.now()}{top_k}".encode()
        ).hexdigest()[:8]
        
        processing_time = (time.time() - start_time) * 1000  # ms
        
        print(f"\n✅ Generated {len(recommendations)} recommendations")
        print(f"⏱️  Processing time: {processing_time:.2f}ms")
        print(f"🆔 Recommendation ID: {rec_id}")
        
        return RecommendationResponse(
            user_id=user_id,
            user_email=user_data.get("email", ""),
            total_recommendations=len(recommendations),
            items=recommendations,
            filters_applied=context,
            recommendation_id=rec_id,
            processing_time_ms=round(processing_time, 2)
        )
    
    def ar_recommendations(
        self,
        user_id: int,
        photo_id: str,
        body_data: Dict
    ) -> List[RecommendationItem]:
        """Specialized AR try-on recommendations"""
        
        print(f"\n{'='*70}")
        print(f"🪞 AR TRY-ON RECOMMENDATION ENGINE")
        print(f"📊 User ID: {user_id}, Photo: {photo_id}")
        print(f"📏 Body Data: {body_data}")
        print(f"{'='*70}")
        
        # Get base recommendations
        base_recs = self.recommend(user_id, {"source": "ar_mirror"}, top_k=30)
        
        # Apply AR-specific boosts
        ar_scored = []
        for item in base_recs.items:
            # Boost based on body fit
            fit_boost = self.expert.body_fit_compatibility(
                body_data,
                {"shoulder_width": 40, "hip_width": 38, "torso_length": 50}
            )
            
            # Boost based on real-time context
            final_score = item.score * 0.7 + fit_boost * 0.3
            
            ar_scored.append((item, final_score))
        
        # Sort and return top
        ar_scored.sort(key=lambda x: x[1], reverse=True)
        return [item for item, _ in ar_scored[:10]]

# Initialize engine
engine = HybridRecommendationEngine()

# ============================================================================
# API ENDPOINTS
# ============================================================================

@app.get("/")
async def root():
    """API root with status"""
    return {
        "name": "HueIQ Advanced Hybrid Recommendation Engine",
        "version": "3.0.0",
        "status": "operational",
        "endpoints": [
            "/docs",
            "/health",
            "/api/recommendations",
            "/api/recommendations/ar",
            "/api/recommendations/items",
            "/api/recommendations/trending",
            "/api/recommendations/by-category/{category}"
        ],
        "timestamp": datetime.now().isoformat()
    }

@app.get("/health")
async def health_check():
    """Enhanced health check with dependency status"""
    
    # Check boss API
    boss_status = "connected" if boss_api.call_api("/health") else "disconnected"
    
    return {
        "status": "healthy",
        "version": "3.0.0",
        "components": {
            "api_server": "running",
            "boss_api": boss_status,
            "cache": f"{len(boss_api.cache)} items",
            "model": "loaded"
        },
        "timestamp": datetime.now().isoformat()
    }

@app.post(
    "/api/recommendations",
    response_model=RecommendationResponse,
    summary="Get Personalized Recommendations",
    description="""
    Get personalized recommendations for a user using hybrid AI algorithm.
    
    **Backend Flow:**
    1. Fetch user embedding from multiple signals
    2. Fetch recent user interactions
    3. Generate candidates via vector search
    4. Apply collaborative filtering
    5. Apply content-based ranking
    6. Apply expert rule boost
    7. Apply diversity ranking (MMR)
    8. Return Top N with explanations
    
    **Features:**
    - Multi-modal fusion (collaborative + content + visual)
    - Real-time context awareness
    - Diversity optimization
    - Explainable AI with score breakdown
    - Caching for performance
    """,
    response_description="Personalized recommendations with metadata"
)
async def get_recommendations(request: RecommendationRequest):
    """
    Generate personalized recommendations using hybrid AI.
    
    - **user_id**: Target user ID
    - **context**: Contextual information (occasion, weather, location)
    - **top_k**: Number of recommendations (1-50)
    """
    try:
        result = engine.recommend(
            user_id=request.user_id,
            context=request.context,
            top_k=request.top_k
        )
        return result
    except Exception as e:
        print(f"❌ Error in recommendations: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Recommendation generation failed: {str(e)}"
        )

@app.post(
    "/api/recommendations/ar",
    response_model=List[RecommendationItem],
    summary="Get AR Try-On Recommendations",
    description="""
    Get specialized AR try-on recommendations based on real-time body data.
    
    **AR Mirror Integration:**
    - Uses real-time body measurements
    - Consumes user photo for visual analysis
    - Optimizes for AR try-on fit
    - Prioritizes items with good body compatibility
    """
)
async def get_ar_recommendations(request: ARRecommendationRequest):
    """
    Get AR-optimized recommendations.
    
    - **user_id**: Target user ID
    - **photo_id**: User photo for visual analysis
    - **real_time_body_data**: Live body measurements from AR mirror
    """
    try:
        results = engine.ar_recommendations(
            user_id=request.user_id,
            photo_id=request.photo_id,
            body_data=request.real_time_body_data
        )
        return results
    except Exception as e:
        print(f"❌ Error in AR recommendations: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"AR recommendation failed: {str(e)}"
        )

@app.get(
    "/api/recommendations/items",
    response_model=CatalogResponse,
    summary="Get Catalog Items",
    description="Get catalog items with optional filtering and sorting"
)
async def get_items(
    limit: int = Query(10, description="Number of items", ge=1, le=50),
    category: Optional[str] = Query(None, description="Filter by category"),
    sort_by: SortBy = Query(SortBy.RELEVANCE, description="Sort order")
):
    """Get catalog items with filtering and sorting"""
    
    # Get catalog
    catalog = boss_api.get_catalog()
    if not catalog:
        catalog = DataGenerator.generate_catalog(50)
    
    # Filter by category
    if category and category != "all":
        catalog = [item for item in catalog if item.get("category") == category]
    
    # Sort
    if sort_by == SortBy.PRICE:
        catalog.sort(key=lambda x: x.get("price", 0))
    elif sort_by == SortBy.RATING:
        catalog.sort(key=lambda x: x.get("rating", 0), reverse=True)
    else:  # relevance - use some default
        catalog.sort(key=lambda x: x.get("is_new", False), reverse=True)
    
    # Limit
    catalog = catalog[:limit]
    
    # Format response
    items = []
    for i, item in enumerate(catalog):
        items.append(ItemResponse(
            id=item.get("id", i),
            name=item.get("name", "Unknown"),
            price=float(item.get("price", 99.99)),
            category=item.get("category", "Clothing"),
            image=item.get("image", "https://images.unsplash.com/photo-1441986300919-14419ef2a5ad?w=400"),
            colors=item.get("colors", [item.get("color", "Unknown")]),
            score=0.8,
            reason="Popular item",
            description=item.get("description", ""),
            rating=float(item.get("rating", 4.5)),
            in_stock=item.get("in_stock", True),
            brand=item.get("brand"),
            discount=item.get("discount")
        ))
    
    return CatalogResponse(
        total_recommendations=len(items),
        items=items,
        filters_applied={
            "category": category,
            "sort_by": sort_by.value,
            "limit": limit
        }
    )

@app.get(
    "/api/recommendations/trending",
    response_model=TrendingResponse,
    summary="Get Trending Items",
    description="Get trending/popular items"
)
async def get_trending(
    limit: int = Query(10, description="Number of items", ge=1, le=50)
):
    """Get trending items"""
    
    # Try boss API first
    trending = boss_api.get_trending(limit)
    
    if not trending:
        # Generate simulated trending items
        catalog = DataGenerator.generate_catalog(50)
        # Sort by some trending factors
        catalog.sort(key=lambda x: x.get("rating", 0), reverse=True)
        trending = catalog[:limit]
    
    items = []
    for i, item in enumerate(trending):
        items.append(ItemResponse(
            id=item.get("id", i),
            name=item.get("name", "Trending Item"),
            price=float(item.get("price", 99.99)),
            category=item.get("category", "Clothing"),
            image=item.get("image", "https://images.unsplash.com/photo-1441986300919-14419ef2a5ad?w=400"),
            colors=item.get("colors", [item.get("color", "Unknown")]),
            score=0.9,
            reason="Trending now",
            description=item.get("description", ""),
            rating=float(item.get("rating", 4.7)),
            in_stock=item.get("in_stock", True)
        ))
    
    return TrendingResponse(
        total_recommendations=len(items),
        items=items,
        filters_applied={"trending": True, "limit": limit}
    )

@app.get(
    "/api/recommendations/by-category/{category}",
    response_model=CatalogResponse,
    summary="Get Recommendations By Category",
    description="Get recommendations filtered by specific category"
)
async def get_by_category(
    category: str = Path(..., description="Category name"),
    limit: int = Query(10, description="Number of items", ge=1, le=50)
):
    """Get recommendations for a specific category"""
    
    # Get items filtered by category
    catalog = boss_api.get_catalog()
    if not catalog:
        catalog = DataGenerator.generate_catalog(100)
    
    # Filter by category
    category_items = [item for item in catalog if item.get("category") == category]
    
    # Sort by relevance (simulate recommendation)
    category_items.sort(key=lambda x: x.get("rating", 0), reverse=True)
    category_items = category_items[:limit]
    
    items = []
    for i, item in enumerate(category_items):
        items.append(ItemResponse(
            id=item.get("id", i),
            name=item.get("name", "Unknown"),
            price=float(item.get("price", 99.99)),
            category=item.get("category", category),
            image=item.get("image", "https://images.unsplash.com/photo-1441986300919-14419ef2a5ad?w=400"),
            colors=item.get("colors", [item.get("color", "Unknown")]),
            score=0.85,
            reason=f"Top pick in {category}",
            description=item.get("description", ""),
            rating=float(item.get("rating", 4.5)),
            in_stock=item.get("in_stock", True)
        ))
    
    return CatalogResponse(
        total_recommendations=len(items),
        items=items,
        filters_applied={"category": category, "limit": limit}
    )

# ============================================================================
# ADDITIONAL UTILITY ENDPOINTS
# ============================================================================

@app.get("/api/debug/cache")
async def get_cache_info():
    """Debug endpoint to view cache status"""
    return {
        "cache_size": len(boss_api.cache),
        "cache_keys": list(boss_api.cache.keys())[:10],
        "token_preview": boss_api.token[:20] + "..."
    }

@app.post("/api/debug/refresh-token")
async def refresh_token():
    """Manually refresh boss API token"""
    success = boss_api.refresh_token()
    return {
        "success": success,
        "token_preview": boss_api.token[:20] + "..." if success else None
    }

@app.get("/api/debug/simulate-user/{user_id}")
async def simulate_user(user_id: int):
    """Generate simulated user data for testing"""
    generator = DataGenerator()
    return generator.generate_user(user_id)

# ============================================================================
# RUN CONFIGURATION
# ============================================================================
if __name__ == "__main__":
    import uvicorn
    print("🚀 Starting HueIQ Advanced Hybrid Recommendation Engine v3.0")
    print(f"📡 Boss API: {config.BOSS_API_URL}")
    print(f"🔑 Token: {config.BOSS_TOKEN[:20]}...")
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)