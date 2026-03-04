import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import axios from "axios";
import "./recommendations.css";

// ============================================================================
// ADVANCED CONFIGURATION - USING LOCAL PROXY TO AVOID CORS
// ============================================================================
const API_BASE_URL = "http://127.0.0.1:8000";

// ============================================================================
// RECOMMENDATION CARD COMPONENT (Enhanced)
// ============================================================================
const RecommendationCard = React.memo(
  ({ item, onQuickView, onAddToBag, onLike, onShare }) => {
    const [isHovered, setIsHovered] = useState(false);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    const [isLiked, setIsLiked] = useState(false);
    const [imageLoaded, setImageLoaded] = useState(false);
    const [imageError, setImageError] = useState(false);

    // Auto-cycle images on hover
    useEffect(() => {
      let interval;
      if (isHovered && item.images?.length > 1) {
        interval = setInterval(() => {
          setCurrentImageIndex((prev) => (prev + 1) % item.images.length);
        }, 1000);
      }
      return () => interval && clearInterval(interval);
    }, [isHovered, item.images]);

    // Reset image index when not hovered
    useEffect(() => {
      if (!isHovered) setCurrentImageIndex(0);
    }, [isHovered]);

    const getImageUrl = useCallback(() => {
      // Priority 1: Processed images array
      if (item.images?.length > 0) {
        return item.images[currentImageIndex]?.url;
      }
      // Priority 2: 3D assets
      if (item.catalog_3d_assets?.length > 0) {
        return item.catalog_3d_assets[
          currentImageIndex % item.catalog_3d_assets.length
        ]?.texture_url;
      }
      // Priority 3: Main image field (from catalog)
      if (item.thumbnail_url) {
        return item.thumbnail_url;
      }
      if (item.texture_url) {
        return item.texture_url;
      }
      if (item.image) {
        return item.image;
      }
      // Priority 4: Primary image from any source
      if (item.primary_image) {
        return item.primary_image;
      }
      // Fallback
      return "https://images.unsplash.com/photo-1441986300919-14419ef2a5ad?w=400";
    }, [item, currentImageIndex]);

    const getCurrentView = useCallback(() => {
      if (item.images?.[currentImageIndex]?.view)
        return item.images[currentImageIndex].view;
      if (item.catalog_3d_assets?.[currentImageIndex]?.view)
        return item.catalog_3d_assets[currentImageIndex].view;
      return "";
    }, [item, currentImageIndex]);

    const getModelUrl = useCallback(() => {
      return item.catalog_3d_assets?.[0]?.model_url || null;
    }, [item]);

    const getMatchScore = useCallback(() => {
      return item.final_score || item.score || item.relevance_score || 0;
    }, [item]);

    const handleLike = useCallback(() => {
      setIsLiked(!isLiked);
      onLike?.(item, !isLiked);
    }, [item, isLiked, onLike]);

    const handleShare = useCallback(() => {
      onShare?.(item);
    }, [item, onShare]);

    return (
      <div
        className={`netflix-card ${isHovered ? "hovered" : ""} ${imageLoaded ? "image-loaded" : ""}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Badges */}
        <div className="card-badges">
          {getModelUrl() && <span className="badge-3d">🎯 3D</span>}
          {item.is_new && <span className="badge-new">NEW</span>}
          {item.discount > 0 && (
            <span className="badge-discount">-{item.discount}%</span>
          )}
          {item.sustainability_score > 0.7 && (
            <span className="badge-eco">🌱 Eco</span>
          )}
        </div>

        {/* Image Section */}
        <div className="card-image-wrapper">
          {!imageLoaded && !imageError && (
            <div className="image-skeleton">
              <div className="skeleton-loader"></div>
            </div>
          )}

          <img
            src={getImageUrl()}
            alt={item.title || item.name || "Fashion item"}
            className={`card-image ${imageLoaded ? "loaded" : "loading"}`}
            loading="lazy"
            onLoad={() => setImageLoaded(true)}
            onError={(e) => {
              setImageError(true);
              e.target.src =
                "https://images.unsplash.com/photo-1441986300919-14419ef2a5ad?w=400";
            }}
          />

          {/* View Indicator */}
          {(item.images?.length > 1 || item.catalog_3d_assets?.length > 1) && (
            <div className="view-indicator">
              {getCurrentView() || "view"} • {currentImageIndex + 1}/
              {item.images?.length || item.catalog_3d_assets?.length}
            </div>
          )}

          {/* Hover Overlay */}
          <div className="card-overlay">
            <div className="card-overlay-content">
              <div className="card-buttons">
                <button
                  className="card-btn play-btn"
                  onClick={() => onQuickView(item)}
                  title="Quick view"
                >
                  ▶
                </button>
                <button
                  className={`card-btn like-btn ${isLiked ? "liked" : ""}`}
                  onClick={handleLike}
                  title={isLiked ? "Unlike" : "Like"}
                >
                  {isLiked ? "❤️" : "♡"}
                </button>
                <button
                  className="card-btn share-btn"
                  onClick={handleShare}
                  title="Share"
                >
                  ↪️
                </button>
                {getModelUrl() && (
                  <button
                    className="card-btn model-btn"
                    onClick={() => window.open(getModelUrl(), "_blank")}
                    title="View 3D Model"
                  >
                    🧊
                  </button>
                )}
              </div>
              <div className="card-metadata">
                <span className="match-score">
                  {Math.round(getMatchScore() * 100)}% Match
                </span>
                <span className="card-rating">
                  ⭐ {item.rating?.toFixed(1) || "4.5"} (
                  {item.review_count || 0})
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Card Info */}
        <div className="card-info">
          <h3 className="card-title">
            {item.title || item.name || "Fashion Item"}
          </h3>
          <div className="card-tags">
            {item.category && (
              <span className="tag category">{item.category}</span>
            )}
            {item.tags?.map((tag, idx) => (
              <span key={idx} className="tag">
                {tag}
              </span>
            ))}
          </div>
          <div className="card-footer">
            <div className="price-section">
              {item.discount > 0 ? (
                <>
                  <span className="original-price">
                    ${(item.price || 99).toLocaleString()}
                  </span>
                  <span className="discounted-price">
                    $
                    {(
                      (item.price || 99) *
                      (1 - (item.discount || 0) / 100)
                    ).toLocaleString()}
                  </span>
                </>
              ) : (
                <span className="card-price">
                  ${(item.price || 99).toLocaleString()}
                </span>
              )}
            </div>
            <button className="add-to-bag-btn" onClick={() => onAddToBag(item)}>
              Add to Bag
            </button>
          </div>
        </div>
      </div>
    );
  },
);

// ============================================================================
// MAIN RECOMMENDATIONS COMPONENT
// ============================================================================
const Recommendations = () => {
  const [recommendations, setRecommendations] = useState([]);
  const [filteredRecommendations, setFilteredRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [quickViewItem, setQuickViewItem] = useState(null);
  const [activeFilters, setActiveFilters] = useState({
    category: "all",
    sortBy: "relevance",
    priceRange: [0, 1000],
    colors: [],
    sizes: [],
  });
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [stats, setStats] = useState({
    totalItems: 0,
    avgMatchScore: 0,
    topCategories: [],
  });
  const [dataSource, setDataSource] = useState("recommendations"); // 'recommendations' or 'catalog'

  // Refs
  const rowRefs = useRef({});
  const observerRef = useRef();
  const lastItemRef = useRef();

  // ============================================================================
  // FETCH CATALOG ITEMS (FALLBACK)
  // ============================================================================
  const fetchCatalog = async () => {
    try {
      console.log("📦 Fetching catalog items via proxy...");
      const response = await axios.get(
        `${API_BASE_URL}/proxy/hueiq/api/catalog/all`,
        {
          headers: { "Content-Type": "application/json" },
          timeout: 10000,
        },
      );

      console.log("🔥 CATALOG RESPONSE:", response.data);

      let catalogItems = [];
      if (response.data.items) {
        catalogItems = response.data.items;
      } else if (Array.isArray(response.data)) {
        catalogItems = response.data;
      }

      console.log("📦 CATALOG ITEMS COUNT:", catalogItems.length);

      // Process catalog items to match the expected format
      const processedItems = catalogItems.map((item, index) => ({
        id: item.id,
        catalog_item_id: item.id,
        name: item.title || `Item ${item.id}`,
        title: item.title,
        category: item.category,
        tags: item.tags || [],
        thumbnail_url: item.thumbnail_url,
        texture_url: item.texture_url,
        image: item.thumbnail_url || item.texture_url,
        price: 99, // Default price if not available
        rating: 4.5,
        review_count: Math.floor(Math.random() * 100) + 10,
        colors: [],
        sizes: ["XS", "S", "M", "L", "XL"],
        in_stock: true,
        is_new: index < 10,
        discount: index % 5 === 0 ? 20 : 0,
        images: item.thumbnail_url
          ? [
              {
                url: item.thumbnail_url,
                view: "front",
                is_primary: true,
              },
            ]
          : [],
      }));

      setDataSource("catalog");
      setRecommendations(processedItems);
      applyFilters(processedItems, activeFilters);
      setHasMore(processedItems.length >= 50);

      // Update stats
      const categories = [
        ...new Set(processedItems.map((item) => item.category).filter(Boolean)),
      ];
      setStats({
        totalItems: processedItems.length,
        avgMatchScore: 75,
        topCategories: categories.slice(0, 5),
      });
    } catch (err) {
      console.error("❌ Error fetching catalog:", err);
      throw err;
    }
  };

  // ============================================================================
  // FETCH RECOMMENDATIONS FROM LIVE API VIA PROXY
  // ============================================================================
  useEffect(() => {
    const email =
      localStorage.getItem("email") || localStorage.getItem("userEmail");
    const userId = "1"; // Using user ID 1 for testing

    let isMounted = true;

    const fetchData = async () => {
      try {
        setLoading(true);

        // First try to get recommendations
        if (userId) {
          try {
            console.log(
              "📡 Fetching recommendations via proxy for user:",
              userId,
            );

            const recResponse = await axios.post(
              `${API_BASE_URL}/proxy/hueiq/api/recommendations`,
              {
                user_id: parseInt(userId),
                context: {
                  source: "web",
                  email: email,
                  timestamp: new Date().toISOString(),
                },
                top_k: 50,
              },
              {
                headers: { "Content-Type": "application/json" },
                timeout: 10000,
              },
            );

            if (isMounted) {
              console.log("🔥 RECOMMENDATIONS RESPONSE:", recResponse.data);

              let rawItems = [];
              if (recResponse.data.items) rawItems = recResponse.data.items;
              else if (recResponse.data.recommendations)
                rawItems = recResponse.data.recommendations;
              else if (Array.isArray(recResponse.data))
                rawItems = recResponse.data;

              console.log("📦 RECOMMENDATIONS ITEMS COUNT:", rawItems.length);

              if (rawItems.length > 0) {
                // Process recommendation items
                const processedItems = rawItems.map((item, index) => {
                  let images = [];

                  if (item.catalog_3d_assets?.length > 0) {
                    const viewOrder = { front: 0, side: 1, back: 2, detail: 3 };
                    const sortedAssets = [...item.catalog_3d_assets].sort(
                      (a, b) =>
                        (viewOrder[a.view] || 999) - (viewOrder[b.view] || 999),
                    );
                    images = sortedAssets.map((asset) => ({
                      url: asset.texture_url || asset.image_url,
                      view: asset.view || "view",
                      is_primary: asset.view === "front",
                    }));
                  } else if (item.images?.length > 0) {
                    images = item.images.map((img) => ({
                      url: img.url || img,
                      view: img.view || "view",
                      is_primary: img.is_primary || false,
                    }));
                  } else if (item.image || item.thumbnail_url) {
                    images = [
                      {
                        url: item.image || item.thumbnail_url,
                        view: "front",
                        is_primary: true,
                      },
                    ];
                  }

                  return {
                    ...item,
                    id: item.id || item.catalog_item_id || `item_${index}`,
                    catalog_item_id:
                      item.catalog_item_id || item.id || `item_${index}`,
                    score:
                      item.final_score ||
                      item.score ||
                      item.relevance_score ||
                      0.5,
                    price: item.price || 99,
                    images: images,
                    catalog_3d_assets: item.catalog_3d_assets || [],
                    has3d: item.catalog_3d_assets?.length > 0,
                    rating: item.rating || 4.5,
                    colors: item.colors || [],
                    sizes: item.sizes || ["XS", "S", "M", "L", "XL"],
                    in_stock: item.in_stock !== false,
                    is_new: item.is_new || false,
                  };
                });

                setDataSource("recommendations");
                setRecommendations(processedItems);
                applyFilters(processedItems, activeFilters);

                // Calculate stats
                const totalItems = processedItems.length;
                const avgScore =
                  processedItems.reduce(
                    (acc, item) => acc + (item.score || 0),
                    0,
                  ) / totalItems || 0;
                const categories = [
                  ...new Set(
                    processedItems.map((item) => item.category).filter(Boolean),
                  ),
                ];

                setStats({
                  totalItems,
                  avgMatchScore: Math.round(avgScore * 100),
                  topCategories: categories.slice(0, 5),
                });

                setHasMore(processedItems.length >= 50);
                return; // Exit if we got recommendations
              }
            }
          } catch (recError) {
            console.log(
              "⚠️ No recommendations available, falling back to catalog",
            );
          }
        }

        // If no recommendations, fetch catalog
        if (isMounted) {
          await fetchCatalog();
        }
      } catch (err) {
        console.error("❌ Error fetching data:", err);
        if (isMounted) {
          if (err.response?.status === 401) {
            setError("Authentication failed. Please log in again.");
          } else if (err.code === "ECONNABORTED") {
            setError("Request timed out. Please check your connection.");
          } else if (!err.response) {
            setError(
              "Cannot connect to server. Please ensure the backend is running.",
            );
          } else {
            setError(
              `Failed to load data: ${err.response?.data?.detail || err.message}`,
            );
          }
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchData();

    return () => {
      isMounted = false;
    };
  }, []); // Run once on mount

  // ============================================================================
  // FILTERING AND SORTING
  // ============================================================================
  const applyFilters = useCallback((items, filters) => {
    let filtered = [...items];

    // Category filter
    if (filters.category !== "all") {
      filtered = filtered.filter((item) => item.category === filters.category);
    }

    // Price range filter
    filtered = filtered.filter(
      (item) =>
        (item.price || 99) >= filters.priceRange[0] &&
        (item.price || 99) <= filters.priceRange[1],
    );

    // Color filter
    if (filters.colors.length > 0) {
      filtered = filtered.filter((item) =>
        item.colors?.some((color) => filters.colors.includes(color)),
      );
    }

    // Size filter
    if (filters.sizes.length > 0) {
      filtered = filtered.filter((item) =>
        item.sizes?.some((size) => filters.sizes.includes(size)),
      );
    }

    // Sorting
    switch (filters.sortBy) {
      case "price_low":
        filtered.sort((a, b) => (a.price || 99) - (b.price || 99));
        break;
      case "price_high":
        filtered.sort((a, b) => (b.price || 99) - (a.price || 99));
        break;
      case "rating":
        filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0));
        break;
      case "newest":
        filtered.sort((a, b) => (b.is_new ? 1 : 0) - (a.is_new ? 1 : 0));
        break;
      default: // relevance
        filtered.sort((a, b) => (b.score || 0) - (a.score || 0));
    }

    setFilteredRecommendations(filtered);
  }, []);

  // Update filters when activeFilters changes
  useEffect(() => {
    if (recommendations.length > 0) {
      applyFilters(recommendations, activeFilters);
    }
  }, [recommendations, activeFilters, applyFilters]);

  // ============================================================================
  // INTERACTION HANDLERS
  // ============================================================================
  const handleQuickView = useCallback((item) => {
    setQuickViewItem(item);
    console.log("📊 Analytics: Quick view", item.id);
  }, []);

  const handleAddToBag = useCallback((item) => {
    alert(`✅ "${item.title || item.name}" added to your bag!`);
    console.log("📊 Analytics: Added to bag", item.id);
  }, []);

  const handleLike = useCallback((item, liked) => {
    console.log(`📊 Analytics: Item ${liked ? "liked" : "unliked"}`, item.id);
  }, []);

  const handleShare = useCallback((item) => {
    if (navigator.share) {
      navigator
        .share({
          title: item.title || item.name,
          text: `Check out this ${item.title || item.name} on HueIQ!`,
          url: window.location.href,
        })
        .catch(console.error);
    } else {
      navigator.clipboard.writeText(window.location.href);
      alert("🔗 Link copied to clipboard!");
    }
  }, []);

  const handleFilterChange = useCallback((filterType, value) => {
    setActiveFilters((prev) => ({
      ...prev,
      [filterType]: value,
    }));
  }, []);

  // ============================================================================
  // INFINITE SCROLL
  // ============================================================================
  useEffect(() => {
    if (loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          setPage((prev) => prev + 1);
        }
      },
      { threshold: 0.5 },
    );

    if (lastItemRef.current) {
      observer.observe(lastItemRef.current);
    }

    return () => observer.disconnect();
  }, [loading, hasMore]);

  // ============================================================================
  // SCROLL FUNCTIONS
  // ============================================================================
  const scrollRow = useCallback((category, direction) => {
    const container = rowRefs.current[category];
    if (container) {
      const scrollAmount = direction === "left" ? -400 : 400;
      container.scrollBy({ left: scrollAmount, behavior: "smooth" });
    }
  }, []);

  // ============================================================================
  // GROUP BY CATEGORY
  // ============================================================================
  const groupedRecommendations = useMemo(() => {
    return filteredRecommendations.reduce((acc, item) => {
      const category = item.category || "Featured";
      if (!acc[category]) acc[category] = [];
      acc[category].push(item);
      return acc;
    }, {});
  }, [filteredRecommendations]);

  // ============================================================================
  // CATEGORIES FOR FILTER
  // ============================================================================
  const categories = useMemo(() => {
    return [
      "all",
      ...new Set(recommendations.map((item) => item.category).filter(Boolean)),
    ];
  }, [recommendations]);

  // ============================================================================
  // RENDER LOADING STATE
  // ============================================================================
  if (loading && recommendations.length === 0) {
    return (
      <div className="fullscreen-loading">
        <div className="netflix-loader"></div>
        <p>Loading your personalized recommendations...</p>
        <p className="loading-subtitle">
          {dataSource === "catalog"
            ? "Loading catalog items..."
            : "Analyzing your style preferences"}
        </p>
      </div>
    );
  }

  // ============================================================================
  // RENDER ERROR STATE
  // ============================================================================
  if (error) {
    return (
      <div className="fullscreen-error">
        <div className="error-icon">⚠️</div>
        <h2>Oops! Something went wrong</h2>
        <p>{error}</p>
        <div className="error-actions">
          <button
            className="retry-btn"
            onClick={() => window.location.reload()}
          >
            🔄 Try Again
          </button>
          <button
            className="contact-btn"
            onClick={() => console.log("Contact support")}
          >
            📞 Contact Support
          </button>
        </div>
      </div>
    );
  }

  // ============================================================================
  // RENDER EMPTY STATE
  // ============================================================================
  if (filteredRecommendations.length === 0) {
    return (
      <div className="fullscreen-empty">
        <div className="empty-icon">🛍️</div>
        <h2>No items found</h2>
        <p>Try adjusting your filters or check back later.</p>
      </div>
    );
  }

  // ============================================================================
  // MAIN RENDER
  // ============================================================================
  return (
    <div className="netflix-recommendations-full">
      {/* Header with Stats */}
      <div className="recommendations-header">
        <div className="header-title-section">
          <h1 className="header-title">
            {dataSource === "catalog" ? "Catalog Items" : "Top Picks for You"}
            <span className="header-count">
              {filteredRecommendations.length} items
            </span>
          </h1>
          <div className="header-stats">
            <span className="stat-item">
              {dataSource === "catalog"
                ? "📦 All Items"
                : `🎯 ${stats.avgMatchScore}% avg. match`}
            </span>
            <span className="stat-item">
              📊 {stats.topCategories.slice(0, 3).join(" • ")}
            </span>
          </div>
        </div>

        {/* Filter Toggle */}
        <button
          className="filter-toggle"
          onClick={() => setShowFilters(!showFilters)}
        >
          {showFilters ? "✕ Close Filters" : "⚙️ Filters"}
        </button>
      </div>

      {/* Advanced Filters Panel */}
      {showFilters && (
        <div className="filters-panel">
          <div className="filters-grid">
            <div className="filter-group">
              <label>Category</label>
              <select
                value={activeFilters.category}
                onChange={(e) => handleFilterChange("category", e.target.value)}
              >
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat === "all" ? "All Categories" : cat}
                  </option>
                ))}
              </select>
            </div>

            <div className="filter-group">
              <label>Sort By</label>
              <select
                value={activeFilters.sortBy}
                onChange={(e) => handleFilterChange("sortBy", e.target.value)}
              >
                <option value="relevance">Relevance</option>
                <option value="price_low">Price: Low to High</option>
                <option value="price_high">Price: High to Low</option>
                <option value="rating">Top Rated</option>
                <option value="newest">Newest First</option>
              </select>
            </div>

            <div className="filter-group">
              <label>Price Range</label>
              <div className="price-range">
                <input
                  type="number"
                  placeholder="Min"
                  value={activeFilters.priceRange[0]}
                  onChange={(e) =>
                    handleFilterChange("priceRange", [
                      Number(e.target.value) || 0,
                      activeFilters.priceRange[1],
                    ])
                  }
                />
                <span>-</span>
                <input
                  type="number"
                  placeholder="Max"
                  value={activeFilters.priceRange[1]}
                  onChange={(e) =>
                    handleFilterChange("priceRange", [
                      activeFilters.priceRange[0],
                      Number(e.target.value) || 1000,
                    ])
                  }
                />
              </div>
            </div>

            <div className="filter-group">
              <label>Colors</label>
              <div className="color-options">
                {["black", "white", "red", "blue", "green", "yellow"].map(
                  (color) => (
                    <button
                      key={color}
                      className={`color-btn ${activeFilters.colors.includes(color) ? "active" : ""}`}
                      style={{ backgroundColor: color }}
                      onClick={() => {
                        const newColors = activeFilters.colors.includes(color)
                          ? activeFilters.colors.filter((c) => c !== color)
                          : [...activeFilters.colors, color];
                        handleFilterChange("colors", newColors);
                      }}
                      title={color}
                    />
                  ),
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hero Row */}
      {Object.keys(groupedRecommendations).length > 0 && (
        <section className="hero-row-full">
          <div className="row-header-full">
            <h2 className="row-title">
              {dataSource === "catalog"
                ? "📦 All Items"
                : "🔥 Recommended for You"}
            </h2>
            <div className="row-controls">
              <button
                className="row-arrow"
                onClick={() => scrollRow("hero", "left")}
              >
                ←
              </button>
              <button
                className="row-arrow"
                onClick={() => scrollRow("hero", "right")}
              >
                →
              </button>
            </div>
          </div>
          <div
            className="row-content-full"
            ref={(el) => (rowRefs.current["hero"] = el)}
          >
            {filteredRecommendations.slice(0, 20).map((item, index) => (
              <RecommendationCard
                key={item.catalog_item_id || item.id || index}
                item={item}
                onQuickView={handleQuickView}
                onAddToBag={handleAddToBag}
                onLike={handleLike}
                onShare={handleShare}
              />
            ))}
          </div>
        </section>
      )}

      {/* Category Rows */}
      {Object.entries(groupedRecommendations).map(
        ([category, items], categoryIndex) => (
          <section key={category} className="category-row-full">
            <div className="row-header-full">
              <h2 className="row-title">{category}</h2>
              <div className="row-controls">
                <button
                  className="row-arrow"
                  onClick={() => scrollRow(category, "left")}
                >
                  ←
                </button>
                <button
                  className="row-arrow"
                  onClick={() => scrollRow(category, "right")}
                >
                  →
                </button>
              </div>
            </div>
            <div
              className="row-content-full"
              ref={(el) => (rowRefs.current[category] = el)}
            >
              {items.map((item, index) => (
                <RecommendationCard
                  key={item.catalog_item_id || item.id || index}
                  item={item}
                  onQuickView={handleQuickView}
                  onAddToBag={handleAddToBag}
                  onLike={handleLike}
                  onShare={handleShare}
                />
              ))}
            </div>
          </section>
        ),
      )}

      {/* Infinite Scroll Trigger */}
      <div ref={lastItemRef} style={{ height: "20px" }} />

      {/* Loading More Indicator */}
      {loading && recommendations.length > 0 && (
        <div className="loading-more">
          <div className="spinner"></div>
          <p>Loading more items...</p>
        </div>
      )}

      {/* Quick View Modal */}
      {quickViewItem && (
        <div
          className="quick-view-modal"
          onClick={() => setQuickViewItem(null)}
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button
              className="modal-close"
              onClick={() => setQuickViewItem(null)}
            >
              ×
            </button>
            <div className="modal-grid">
              <div className="modal-image-section">
                <img
                  src={
                    quickViewItem.images?.[0]?.url ||
                    quickViewItem.thumbnail_url ||
                    quickViewItem.texture_url ||
                    quickViewItem.image
                  }
                  alt={quickViewItem.title || quickViewItem.name}
                  className="modal-image"
                />
                {quickViewItem.images?.length > 1 && (
                  <div className="thumbnail-gallery">
                    {quickViewItem.images.slice(0, 4).map((img, idx) => (
                      <img
                        key={idx}
                        src={img.url}
                        alt={`View ${idx + 1}`}
                        className="thumbnail"
                      />
                    ))}
                  </div>
                )}
              </div>
              <div className="modal-details">
                <h2>{quickViewItem.title || quickViewItem.name}</h2>
                <div className="modal-match">
                  {quickViewItem.category && (
                    <span>{quickViewItem.category}</span>
                  )}
                </div>
                <div className="modal-tags">
                  {quickViewItem.tags?.map((tag, idx) => (
                    <span key={idx} className="tag">
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="modal-price">
                  <span>${(quickViewItem.price || 99).toFixed(2)}</span>
                </div>
                <button
                  className="modal-add-to-bag"
                  onClick={() => handleAddToBag(quickViewItem)}
                >
                  Add to Bag
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Recommendations;
