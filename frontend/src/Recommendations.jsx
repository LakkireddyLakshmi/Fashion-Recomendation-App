import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import "./recommendations.css";

const RecommendationCard = ({ item, onQuickView, onAddToBag }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  // Auto-cycle images on hover
  // Auto-cycle images on hover
  useEffect(() => {
    let interval;

    if (isHovered && item.images && item.images.length > 1) {
      interval = setInterval(() => {
        setCurrentImageIndex((prev) => (prev + 1) % item.images.length);
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isHovered, item.images]);

  // Separate useEffect for resetting when not hovered
  useEffect(() => {
    if (!isHovered) {
      setCurrentImageIndex(0);
    }
  }, [isHovered]);

  const getImageUrl = () => {
    // Use the current image index for cycling
    if (item.images && item.images.length > 0) {
      return item.images[currentImageIndex].url;
    }

    // Fallback to catalog_3d_assets if images array is empty
    if (item.catalog_3d_assets && item.catalog_3d_assets.length > 0) {
      return item.catalog_3d_assets[
        currentImageIndex % item.catalog_3d_assets.length
      ]?.texture_url;
    }

    return "https://images.unsplash.com/photo-1441986300919-14419ef2a5ad?w=400";
  };

  const getCurrentView = () => {
    if (item.images && item.images.length > currentImageIndex) {
      return item.images[currentImageIndex].view || "view";
    }
    if (
      item.catalog_3d_assets &&
      item.catalog_3d_assets.length > currentImageIndex
    ) {
      return item.catalog_3d_assets[currentImageIndex].view || "view";
    }
    return "";
  };

  const getModelUrl = () => {
    if (item.catalog_3d_assets && item.catalog_3d_assets.length > 0) {
      return item.catalog_3d_assets[0].model_url;
    }
    return null;
  };

  const getMatchScore = () => {
    return item.final_score || item.score || 0;
  };

  return (
    <div
      className={`netflix-card ${isHovered ? "hovered" : ""}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {getModelUrl() && (
        <div className="card-badge-3d">
          <span>🎯 3D</span>
        </div>
      )}

      <div className="card-image-wrapper">
        <img
          src={getImageUrl()}
          alt={item.name}
          className="card-image"
          loading="lazy"
          onError={(e) => {
            e.target.src =
              "https://images.unsplash.com/photo-1441986300919-14419ef2a5ad?w=400";
          }}
        />

        {/* View indicator showing front/side/back */}
        {((item.images && item.images.length > 1) ||
          (item.catalog_3d_assets && item.catalog_3d_assets.length > 1)) && (
          <div className="view-indicator">
            {getCurrentView()} • {currentImageIndex + 1}/
            {item.images?.length || item.catalog_3d_assets?.length || 1}
          </div>
        )}

        <div className="card-overlay">
          <div className="card-overlay-content">
            <div className="card-buttons">
              <button
                className="card-btn play-btn"
                onClick={() => onQuickView(item)}
              >
                ▶
              </button>
              <button className="card-btn like-btn">♡</button>
              {getModelUrl() && (
                <button
                  className="card-btn model-btn"
                  onClick={() => window.open(getModelUrl())}
                >
                  🧊
                </button>
              )}
            </div>
            <div className="card-metadata">
              <span className="match-score">
                {Math.round(getMatchScore() * 100)}% Match
              </span>
              <span className="card-rating">⭐ {item.rating || 4.5}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card-info">
        <h3 className="card-title">{item.name}</h3>
        <div className="card-tags">
          {item.category && <span className="tag">{item.category}</span>}
          {item.fit && <span className="tag">{item.fit}</span>}
          {item.color && <span className="tag">{item.color}</span>}
          {item.is_new && <span className="tag new">NEW</span>}
        </div>
        <div className="card-footer">
          <span className="card-price">
            ${(item.price || 99).toLocaleString()}
            {item.discount > 0 && (
              <span className="discount">-{item.discount}%</span>
            )}
          </span>
          <button className="add-to-bag-btn" onClick={() => onAddToBag(item)}>
            Add to Bag
          </button>
        </div>
      </div>
    </div>
  );
};

const Recommendations = () => {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [quickViewItem, setQuickViewItem] = useState(null);

  // Refs for horizontal scrolling
  const rowRefs = useRef({});

  useEffect(() => {
    const email = localStorage.getItem("email");
    if (!email) {
      setLoading(false);
      setError("Please log in to see recommendations");
      return;
    }

    const fetchRecommendations = async () => {
      try {
        setLoading(true);
        const response = await axios.get(
          `/test-integration/recommendations/${encodeURIComponent(email)}`,
          { params: { limit: 50 } },
        );

        console.log("🔥 RAW BACKEND RESPONSE:", response.data);

        const rawItems = response.data.recommendations || [];
        console.log("📦 RAW ITEMS COUNT:", rawItems.length);

        if (rawItems.length > 0) {
          console.log("🔍 FIRST RAW ITEM:", rawItems[0]);
          console.log(
            "🔍 FIRST ITEM CATALOG_3D_ASSETS:",
            rawItems[0].catalog_3d_assets,
          );
        }

        // Process items - ensure images array exists
        const processedItems = rawItems.map((item, index) => {
          console.log(`\n🔄 Processing item ${index}: ${item.name}`);

          // Create images array from catalog_3d_assets
          let images = [];

          // If item has catalog_3d_assets with multiple views
          if (item.catalog_3d_assets && item.catalog_3d_assets.length > 0) {
            console.log(`   Found ${item.catalog_3d_assets.length} 3D assets`);

            // Sort by view order: front first, then side, then back
            const viewOrder = { front: 0, side: 1, back: 2 };
            const sortedAssets = [...item.catalog_3d_assets].sort((a, b) => {
              return (viewOrder[a.view] || 999) - (viewOrder[b.view] || 999);
            });

            images = sortedAssets.map((asset) => ({
              url: asset.texture_url,
              view: asset.view || "view",
              is_primary: asset.view === "front",
            }));

            console.log(
              `   Created ${images.length} images with views:`,
              images.map((i) => i.view),
            );
          } else {
            console.log("   ⚠️ No 3D assets found for this item");
          }

          return {
            ...item,
            catalog_item_id: item.catalog_item_id || item.id || `item_${index}`,
            score: item.final_score || item.score || 0.5,
            price: item.price || 99,
            images: images,
            catalog_3d_assets: item.catalog_3d_assets || [],
            has3d: item.catalog_3d_assets?.length > 0,
          };
        });

        console.log("\n✅ PROCESSED ITEMS:", processedItems.length);
        if (processedItems.length > 0) {
          console.log(
            "✅ FIRST PROCESSED ITEM IMAGES:",
            processedItems[0].images,
          );
        }

        setRecommendations(processedItems);
      } catch (err) {
        console.error("❌ Error:", err);
        setError("Failed to load recommendations");
      } finally {
        setLoading(false);
      }
    };

    fetchRecommendations();
  }, []);

  const handleQuickView = (item) => setQuickViewItem(item);
  const handleAddToBag = (item) => {
    alert(`✅ "${item.name}" added to bag!`);
  };

  // Scroll functions
  const scrollRow = (category, direction) => {
    const container = rowRefs.current[category];
    if (container) {
      const scrollAmount = direction === "left" ? -400 : 400;
      container.scrollBy({ left: scrollAmount, behavior: "smooth" });
    }
  };

  // Group by category
  const groupedRecommendations = recommendations.reduce((acc, item) => {
    const category = item.category || "Featured";
    if (!acc[category]) acc[category] = [];
    acc[category].push(item);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="fullscreen-loading">
        <div className="netflix-loader"></div>
        <p>Loading your recommendations...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fullscreen-error">
        <div className="error-icon">⚠️</div>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="netflix-recommendations-full">
      {/* Header */}
      <div className="recommendations-header">
        <h1 className="header-title">
          Top Picks for You
          <span className="header-count">{recommendations.length} items</span>
        </h1>
      </div>

      {/* Hero Row */}
      {recommendations.length > 0 && (
        <section className="hero-row-full">
          <div className="row-header-full">
            <h2 className="row-title">🔥 Recommended for You</h2>
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
            {recommendations.map((item) => (
              <RecommendationCard
                key={item.catalog_item_id}
                item={item}
                onQuickView={handleQuickView}
                onAddToBag={handleAddToBag}
              />
            ))}
          </div>
        </section>
      )}

      {/* Category Rows */}
      {Object.entries(groupedRecommendations).map(([category, items]) => (
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
            {items.map((item) => (
              <RecommendationCard
                key={item.catalog_item_id}
                item={item}
                onQuickView={handleQuickView}
                onAddToBag={handleAddToBag}
              />
            ))}
          </div>
        </section>
      ))}

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
                    quickViewItem.catalog_3d_assets?.[0]?.texture_url
                  }
                  alt={quickViewItem.name}
                  className="modal-image"
                />
                {quickViewItem.images && quickViewItem.images.length > 1 && (
                  <div className="thumbnail-gallery">
                    {quickViewItem.images.map((img, idx) => (
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
                <h2>{quickViewItem.name}</h2>
                <div className="modal-match">
                  {Math.round(
                    (quickViewItem.final_score || quickViewItem.score || 0) *
                      100,
                  )}
                  % Match
                </div>
                <div className="modal-tags">
                  <span>{quickViewItem.category}</span>
                  <span>{quickViewItem.fit}</span>
                  <span>{quickViewItem.color}</span>
                </div>
                <div className="modal-price">
                  ${(quickViewItem.price || 99).toLocaleString()}
                  {quickViewItem.discount > 0 && (
                    <span className="modal-discount">
                      -{quickViewItem.discount}%
                    </span>
                  )}
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
