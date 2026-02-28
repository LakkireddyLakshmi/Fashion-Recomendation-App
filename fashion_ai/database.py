import os
from dotenv import load_dotenv
from pymongo import MongoClient

# Load environment variables
load_dotenv()

# ============================================================================
# MONGODB CONNECTION
# ============================================================================
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/fashion_ai")
DATABASE_NAME = os.getenv("DATABASE_NAME", "fashion_ai")

# Connect to MongoDB
client = MongoClient(MONGO_URI)
db = client[DATABASE_NAME]

# ============================================================================
# COLLECTIONS
# ============================================================================
# User related collections
users = db["users"]
user_photos = db["user_photos"]

# Catalog related collections
catalog_variants = db["catalog_variants"]
catalog_images = db["catalog_images"]
catalog_3d_assets = db["catalog_3d_assets"]

# ML/AI related collections
feature_store = db["features"]  # or db["feature_store"] depending on your schema

print(f"✅ Connected to MongoDB - {DATABASE_NAME}")
print(f"📚 Available collections: {db.list_collection_names()}")