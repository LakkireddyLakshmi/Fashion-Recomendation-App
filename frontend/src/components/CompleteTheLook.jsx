import { useState, useMemo } from "react";

// Category groupings for outfit building
const TOPS = ["shirts","shirt","t-shirts","t-shirt","tees","tops","top","blazers","blazer","blouses","blouse","jackets","jacket","hoodies","hoodie","kurtas","kurta","shrugs","outerwear","winterwear","innerwear"];
const BOTTOMS = ["jeans","jean","trousers","trouser","pants","joggers","jogger","cargo pants","cargo","bottomwear","skirts","skirt","shorts","track-pants","leggings"];
const DRESSES = ["dresses","dress","gowns","gown","jumpsuits","jumpsuit","co-ord sets","co-ord-sets","ethnic wear","kurta-sets"];
const SHOES = ["shoes","shoe","sneakers","boots","sandals","heels","loafers","footwear"];
const ACCESSORIES = ["accessories","accessory","bags","bag","watches","watch","belts","belt","hats","hat","caps","cap","jewelry","sunglasses","scarves"];

function getCatGroup(cat) {
  const c = (cat || "").toLowerCase();
  if (TOPS.some(t => c.includes(t))) return "top";
  if (BOTTOMS.some(t => c.includes(t))) return "bottom";
  if (DRESSES.some(t => c.includes(t))) return "dress";
  if (SHOES.some(t => c.includes(t))) return "shoes";
  if (ACCESSORIES.some(t => c.includes(t))) return "accessory";
  return "other";
}

function getComplementaryGroups(group) {
  switch (group) {
    case "top": return ["bottom", "shoes", "accessory"];
    case "bottom": return ["top", "shoes", "accessory"];
    case "dress": return ["shoes", "accessory"];
    case "shoes": return ["top", "bottom", "accessory"];
    case "accessory": return ["top", "bottom", "shoes"];
    default: return ["top", "bottom", "shoes"];
  }
}

function colorScore(colorsA, colorsB) {
  const a = (colorsA || []).map(c => c.toLowerCase());
  const b = (colorsB || []).map(c => c.toLowerCase());
  // Matching colors
  const match = a.filter(c => b.includes(c)).length;
  // Complementary neutrals
  const neutrals = ["black","white","grey","gray","beige","cream","navy"];
  const hasNeutral = b.some(c => neutrals.includes(c));
  return match * 2 + (hasNeutral ? 1 : 0);
}

function generateOutfits(currentItem, allItems, count = 8) {
  const currentGroup = getCatGroup(currentItem.category);
  const currentColors = (currentItem.available_colors || []).map(c => c.toLowerCase());
  const currentGender = (currentItem.gender || "").toLowerCase();
  const currentId = currentItem.catalog_item_id || currentItem.id;
  const neededGroups = getComplementaryGroups(currentGroup);

  // Group and score all other items
  const grouped = {};
  for (const g of neededGroups) grouped[g] = [];

  allItems.forEach(item => {
    if ((item.catalog_item_id || item.id) === currentId) return;
    // Gender filter
    const g = (item.gender || "").toLowerCase();
    if (currentGender && g && g !== currentGender && g !== "unisex") return;
    const group = getCatGroup(item.category);
    if (grouped[group]) {
      const score = colorScore(currentColors, item.available_colors);
      grouped[group].push({ ...item, _score: score });
    }
  });

  // Sort each group by score
  for (const g of neededGroups) {
    grouped[g].sort((a, b) => b._score - a._score);
  }

  // Generate outfit combos
  const outfits = [];
  for (let i = 0; i < count; i++) {
    const outfit = { id: i, items: [currentItem] };
    for (const g of neededGroups) {
      const pool = grouped[g];
      if (pool.length > 0) {
        // Pick different item for each outfit (round-robin with offset)
        const idx = i % pool.length;
        outfit.items.push(pool[idx]);
        // Rotate pool for variety
        if (i > 0 && i % pool.length === 0) {
          pool.push(pool.shift());
        }
      }
    }
    if (outfit.items.length > 1) outfits.push(outfit);
  }

  return outfits;
}

function getPrice(item) {
  if (item.sale_price && item.sale_price > 0) return item.sale_price;
  if (item.variants?.length) {
    const prices = item.variants.map(v => v.price_override || item.base_price || item.price || 0).filter(p => p > 0);
    return prices.length ? Math.min(...prices) : (item.base_price || item.price || 0);
  }
  return item.base_price || item.price || 0;
}

export default function CompleteTheLook({ currentItem, allItems, onAddToCart, onItemClick }) {
  const [swapSlot, setSwapSlot] = useState(null); // { outfitIdx, slotIdx }
  const [swapOptions, setSwapOptions] = useState([]);
  const [outfitOverrides, setOutfitOverrides] = useState({}); // { "outfitIdx-slotIdx": item }

  const outfits = useMemo(
    () => generateOutfits(currentItem, allItems, 8),
    [currentItem?.catalog_item_id || currentItem?.id, allItems.length]
  );

  if (!outfits.length) return null;

  const handleSwap = (outfitIdx, slotIdx) => {
    const item = outfits[outfitIdx].items[slotIdx];
    const group = getCatGroup(item.category);
    const currentGender = (currentItem.gender || "").toLowerCase();
    // Find alternatives in the same category group
    const alternatives = allItems.filter(i => {
      if ((i.catalog_item_id || i.id) === (item.catalog_item_id || item.id)) return false;
      const g = (i.gender || "").toLowerCase();
      if (currentGender && g && g !== currentGender && g !== "unisex") return false;
      return getCatGroup(i.category) === group;
    }).slice(0, 12);
    setSwapOptions(alternatives);
    setSwapSlot({ outfitIdx, slotIdx });
  };

  const applySwap = (newItem) => {
    const key = `${swapSlot.outfitIdx}-${swapSlot.slotIdx}`;
    setOutfitOverrides(prev => ({ ...prev, [key]: newItem }));
    setSwapSlot(null);
    setSwapOptions([]);
  };

  const getOutfitItem = (outfitIdx, slotIdx) => {
    const key = `${outfitIdx}-${slotIdx}`;
    return outfitOverrides[key] || outfits[outfitIdx].items[slotIdx];
  };

  const getOutfitTotal = (outfitIdx) => {
    const outfit = outfits[outfitIdx];
    return outfit.items.reduce((sum, _, slotIdx) => {
      const item = getOutfitItem(outfitIdx, slotIdx);
      return sum + (getPrice(item) / 10);
    }, 0).toFixed(0);
  };

  const addFullOutfit = (outfitIdx) => {
    const outfit = outfits[outfitIdx];
    outfit.items.forEach((_, slotIdx) => {
      const item = getOutfitItem(outfitIdx, slotIdx);
      if (onAddToCart) onAddToCart(item);
    });
  };

  return (
    <div style={{ width: "100%", maxWidth: 1100, marginTop: 40, paddingBottom: 40 }}>
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontFamily: "'League Spartan'", fontSize: 22, fontWeight: 700, color: "#fff", margin: 0 }}>
          Complete the Look
        </h3>
        <p style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>
          AI-styled outfit recommendations
        </p>
      </div>

      {/* Horizontal scroll of outfit cards */}
      <div style={{
        display: "flex",
        gap: 20,
        overflowX: "auto",
        paddingBottom: 16,
        scrollSnapType: "x mandatory",
        WebkitOverflowScrolling: "touch",
      }}>
        {outfits.map((outfit, oi) => (
          <div key={oi} style={{
            minWidth: 280,
            maxWidth: 280,
            background: "rgba(255,255,255,0.06)",
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.1)",
            overflow: "hidden",
            scrollSnapAlign: "start",
            flexShrink: 0,
          }}>
            {/* Outfit items grid */}
            <div style={{
              display: "grid",
              gridTemplateColumns: outfit.items.length <= 2 ? "1fr 1fr" : "1fr 1fr",
              gap: 2,
              padding: 2,
            }}>
              {outfit.items.map((_, si) => {
                const item = getOutfitItem(oi, si);
                const img = item.primary_image_url || item.image || (item.images?.[0]?.image_url);
                const isCurrentItem = si === 0;
                return (
                  <div key={si} style={{
                    position: "relative",
                    aspectRatio: "3/4",
                    overflow: "hidden",
                    cursor: "pointer",
                    borderRadius: si === 0 ? "14px 0 0 0" : si === 1 ? "0 14px 0 0" : undefined,
                  }}
                    onClick={() => !isCurrentItem && onItemClick?.(item)}
                  >
                    <img
                      src={img}
                      alt={item.name}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        opacity: isCurrentItem ? 1 : 0.9,
                      }}
                      onError={e => { e.target.style.display = "none"; }}
                    />
                    {isCurrentItem && (
                      <div style={{
                        position: "absolute",
                        top: 6,
                        left: 6,
                        background: "#7c3aed",
                        color: "#fff",
                        fontSize: 9,
                        fontWeight: 700,
                        padding: "2px 6px",
                        borderRadius: 4,
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                      }}>
                        Selected
                      </div>
                    )}
                    {!isCurrentItem && (
                      <div style={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        background: "linear-gradient(transparent, rgba(0,0,0,0.7))",
                        padding: "16px 6px 4px",
                      }}>
                        <div style={{ fontSize: 10, color: "#fff", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {item.name?.split(" ").slice(0, 4).join(" ")}
                        </div>
                        <div style={{ fontSize: 11, color: "#a78bfa", fontWeight: 700 }}>
                          ${(getPrice(item) / 10).toFixed(0)}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Swap + Add to Cart buttons */}
            <div style={{ padding: "10px 12px" }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                {outfit.items.map((_, si) => {
                  if (si === 0) return null; // Can't swap the selected item
                  const item = getOutfitItem(oi, si);
                  const group = getCatGroup(item.category);
                  return (
                    <button
                      key={si}
                      onClick={() => handleSwap(oi, si)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        background: "rgba(255,255,255,0.08)",
                        border: "1px solid rgba(255,255,255,0.15)",
                        borderRadius: 20,
                        padding: "4px 10px",
                        color: "rgba(255,255,255,0.7)",
                        fontSize: 11,
                        cursor: "pointer",
                        fontFamily: "'League Spartan'",
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
                      </svg>
                      Swap {group}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => addFullOutfit(oi)}
                style={{
                  width: "100%",
                  padding: "10px 0",
                  background: "linear-gradient(135deg, #7c3aed, #a855f7)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "'League Spartan'",
                  letterSpacing: 0.5,
                }}
              >
                Add Full Outfit — ${getOutfitTotal(oi)}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Swap Modal */}
      {swapSlot && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.8)",
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
          onClick={() => setSwapSlot(null)}
        >
          <div
            style={{
              background: "#1a1a2e",
              borderRadius: 20,
              padding: 24,
              width: "90%",
              maxWidth: 600,
              maxHeight: "80vh",
              overflow: "auto",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h4 style={{ fontFamily: "'League Spartan'", color: "#fff", margin: 0, fontSize: 18 }}>
                Swap Item
              </h4>
              <button
                onClick={() => setSwapSlot(null)}
                style={{ background: "none", border: "none", color: "#fff", fontSize: 20, cursor: "pointer" }}
              >
                x
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {swapOptions.map((item, i) => {
                const img = item.primary_image_url || item.image || (item.images?.[0]?.image_url);
                return (
                  <div
                    key={i}
                    onClick={() => applySwap(item)}
                    style={{
                      cursor: "pointer",
                      borderRadius: 12,
                      overflow: "hidden",
                      border: "1px solid rgba(255,255,255,0.1)",
                      background: "rgba(255,255,255,0.05)",
                      transition: "border-color 0.2s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = "#7c3aed"}
                    onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"}
                  >
                    <img
                      src={img}
                      alt={item.name}
                      style={{ width: "100%", aspectRatio: "3/4", objectFit: "cover" }}
                      onError={e => { e.target.style.display = "none"; }}
                    />
                    <div style={{ padding: "6px 8px" }}>
                      <div style={{ fontSize: 11, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.name?.split(" ").slice(0, 4).join(" ")}
                      </div>
                      <div style={{ fontSize: 12, color: "#a78bfa", fontWeight: 700 }}>
                        ${(getPrice(item) / 10).toFixed(0)}
                      </div>
                    </div>
                  </div>
                );
              })}
              {!swapOptions.length && (
                <div style={{ gridColumn: "1/-1", textAlign: "center", color: "rgba(255,255,255,0.4)", padding: 40 }}>
                  No alternatives found
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
