import { useState, useMemo } from "react";

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
    case "top": return ["bottom", "shoes"];
    case "bottom": return ["top", "shoes"];
    case "dress": return ["shoes", "accessory"];
    case "shoes": return ["top", "bottom"];
    default: return ["top", "bottom", "shoes"];
  }
}

function colorScore(colorsA, colorsB) {
  const a = (colorsA || []).map(c => c.toLowerCase());
  const b = (colorsB || []).map(c => c.toLowerCase());
  const match = a.filter(c => b.includes(c)).length;
  const neutrals = ["black","white","grey","gray","beige","cream","navy"];
  const hasNeutral = b.some(c => neutrals.includes(c));
  return match * 2 + (hasNeutral ? 1 : 0);
}

function generateOutfits(currentItem, allItems, count = 6) {
  const currentGroup = getCatGroup(currentItem.category);
  const currentColors = (currentItem.available_colors || []).map(c => c.toLowerCase());
  const currentGender = (currentItem.gender || "").toLowerCase();
  const currentId = currentItem.catalog_item_id || currentItem.id;
  const neededGroups = getComplementaryGroups(currentGroup);

  const grouped = {};
  for (const g of neededGroups) grouped[g] = [];

  allItems.forEach(item => {
    if ((item.catalog_item_id || item.id) === currentId) return;
    const g = (item.gender || "").toLowerCase();
    if (currentGender && g && g !== currentGender && g !== "unisex") return;
    const group = getCatGroup(item.category);
    if (grouped[group]) {
      const score = colorScore(currentColors, item.available_colors);
      grouped[group].push({ ...item, _score: score });
    }
  });

  for (const g of neededGroups) {
    grouped[g].sort((a, b) => b._score - a._score);
  }

  const outfits = [];
  for (let i = 0; i < count; i++) {
    const outfit = { id: i, items: [currentItem] };
    for (const g of neededGroups) {
      const pool = grouped[g];
      if (pool.length > 0) {
        const idx = i % pool.length;
        outfit.items.push(pool[idx]);
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

function getImg(item) {
  return item.primary_image_url || item.image || (item.images?.[0]?.image_url) || "";
}

export default function CompleteTheLook({ currentItem, allItems, onAddToCart, onItemClick, selectedOutfit, onSelectOutfit }) {
  const [swapSlot, setSwapSlot] = useState(null);
  const [swapOptions, setSwapOptions] = useState([]);
  const [outfitOverrides, setOutfitOverrides] = useState({});

  const outfits = useMemo(
    () => generateOutfits(currentItem, allItems, 6),
    [currentItem?.catalog_item_id || currentItem?.id, allItems.length]
  );

  if (!outfits.length) return null;

  const handleSwap = (outfitIdx, slotIdx) => {
    const item = getOutfitItem(outfitIdx, slotIdx);
    const group = getCatGroup(item.category);
    const currentGender = (currentItem.gender || "").toLowerCase();
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
    <div style={{ width: "100%", maxWidth: 700, marginTop: 32 }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h3 style={{ fontFamily: "'League Spartan'", fontSize: 20, fontWeight: 700, color: "#fff", margin: 0 }}>
          Complete the Look
        </h3>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 2, fontStyle: "italic" }}>
          AI-styled outfit recommendations
        </p>
      </div>

      {/* Outfit Cards - Horizontal Scroll */}
      <div style={{
        display: "flex",
        gap: 16,
        overflowX: "auto",
        paddingBottom: 12,
        scrollSnapType: "x mandatory",
        WebkitOverflowScrolling: "touch",
      }}>
        {outfits.map((outfit, oi) => {
          const isSelected = selectedOutfit === oi;
          return (
            <div
              key={oi}
              onClick={() => onSelectOutfit?.(oi)}
              style={{
                minWidth: 200,
                maxWidth: 200,
                background: isSelected ? "rgba(124,58,237,0.12)" : "rgba(255,255,255,0.04)",
                borderRadius: 14,
                border: isSelected ? "2px solid #7c3aed" : "1px solid rgba(255,255,255,0.08)",
                overflow: "hidden",
                scrollSnapAlign: "start",
                flexShrink: 0,
                cursor: "pointer",
                transition: "all 0.2s",
              }}
            >
              {/* Vertical stack of outfit items */}
              <div style={{ display: "flex", flexDirection: "column" }}>
                {outfit.items.map((_, si) => {
                  const item = getOutfitItem(oi, si);
                  const img = getImg(item);
                  const isMain = si === 0;
                  return (
                    <div key={si} style={{
                      position: "relative",
                      height: isMain ? 120 : 90,
                      borderBottom: si < outfit.items.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none",
                      display: "flex",
                      alignItems: "center",
                      padding: "6px 8px",
                      gap: 10,
                    }}>
                      <img
                        src={img}
                        alt={item.name}
                        style={{
                          width: isMain ? 80 : 60,
                          height: isMain ? 100 : 72,
                          objectFit: "cover",
                          borderRadius: 8,
                          border: isMain ? "2px solid #7c3aed" : "1px solid rgba(255,255,255,0.1)",
                        }}
                        onError={e => { e.target.style.display = "none"; }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 11,
                          color: isMain ? "#a78bfa" : "rgba(255,255,255,0.7)",
                          fontWeight: 600,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          textTransform: "uppercase",
                          letterSpacing: 0.3,
                          marginBottom: 2,
                        }}>
                          {getCatGroup(item.category)}
                        </div>
                        <div style={{
                          fontSize: 10,
                          color: "rgba(255,255,255,0.5)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}>
                          {item.name?.split(" ").slice(0, 3).join(" ")}
                        </div>
                        <div style={{ fontSize: 12, color: "#fff", fontWeight: 700, marginTop: 2 }}>
                          ${(getPrice(item) / 10).toFixed(0)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Swap + Price */}
              <div style={{ padding: "8px 8px 10px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                {/* Swap buttons as small thumbnails */}
                <div style={{ display: "flex", gap: 4, marginBottom: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginRight: 4 }}>Swap Items</span>
                  {outfit.items.slice(1, 4).map((_, si) => {
                    const item = getOutfitItem(oi, si + 1);
                    const img = getImg(item);
                    return (
                      <div
                        key={si}
                        onClick={(e) => { e.stopPropagation(); handleSwap(oi, si + 1); }}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 6,
                          overflow: "hidden",
                          border: "1px solid rgba(255,255,255,0.2)",
                          cursor: "pointer",
                        }}
                      >
                        <img src={img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={e => { e.target.style.display = "none"; }} />
                      </div>
                    );
                  })}
                </div>

                <button
                  onClick={(e) => { e.stopPropagation(); addFullOutfit(oi); }}
                  style={{
                    width: "100%",
                    padding: "8px 0",
                    background: isSelected ? "#7c3aed" : "rgba(255,255,255,0.08)",
                    color: "#fff",
                    border: isSelected ? "none" : "1px solid rgba(255,255,255,0.15)",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "'League Spartan'",
                  }}
                >
                  Add Full Outfit — ${getOutfitTotal(oi)}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Swap Modal */}
      {swapSlot && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setSwapSlot(null)}>
          <div style={{ background: "#1a1a2e", borderRadius: 20, padding: 24, width: "90%", maxWidth: 500, maxHeight: "70vh", overflow: "auto", border: "1px solid rgba(255,255,255,0.1)" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h4 style={{ fontFamily: "'League Spartan'", color: "#fff", margin: 0, fontSize: 18 }}>Swap Item</h4>
              <button onClick={() => setSwapSlot(null)} style={{ background: "none", border: "none", color: "#fff", fontSize: 20, cursor: "pointer" }}>x</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              {swapOptions.map((item, i) => (
                <div key={i} onClick={() => applySwap(item)} style={{ cursor: "pointer", borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", transition: "border-color 0.2s" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "#7c3aed"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"}>
                  <img src={getImg(item)} alt={item.name} style={{ width: "100%", aspectRatio: "3/4", objectFit: "cover" }} onError={e => { e.target.style.display = "none"; }} />
                  <div style={{ padding: "4px 6px" }}>
                    <div style={{ fontSize: 10, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name?.split(" ").slice(0, 3).join(" ")}</div>
                    <div style={{ fontSize: 11, color: "#a78bfa", fontWeight: 700 }}>${(getPrice(item) / 10).toFixed(0)}</div>
                  </div>
                </div>
              ))}
              {!swapOptions.length && <div style={{ gridColumn: "1/-1", textAlign: "center", color: "rgba(255,255,255,0.4)", padding: 40 }}>No alternatives found</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Export utilities for parent components
export { getPrice, getImg, generateOutfits, getCatGroup };
