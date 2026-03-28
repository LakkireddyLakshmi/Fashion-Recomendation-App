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
    case "top": return ["bottom"];
    case "bottom": return ["top"];
    case "dress": return ["top", "bottom"];
    case "shoes": return ["top", "bottom"];
    default: return ["top", "bottom"];
  }
}

function colorScore(colorsA, colorsB) {
  const a = (colorsA || []).map(c => c.toLowerCase());
  const b = (colorsB || []).map(c => c.toLowerCase());
  return a.filter(c => b.includes(c)).length * 2 + (b.some(c => ["black","white","grey","beige","cream","navy"].includes(c)) ? 1 : 0);
}

function generateOutfits(currentItem, allItems, count = 3) {
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
    if (grouped[group]) grouped[group].push({ ...item, _score: colorScore(currentColors, item.available_colors) });
  });
  for (const g of neededGroups) grouped[g].sort((a, b) => b._score - a._score);
  const outfits = [];
  for (let i = 0; i < count; i++) {
    const outfit = { id: i, items: [currentItem] };
    for (const g of neededGroups) {
      if (grouped[g].length > 0) outfit.items.push(grouped[g][i % grouped[g].length]);
    }
    if (outfit.items.length > 1) outfits.push(outfit);
  }
  return outfits;
}

function getPrice(item) {
  if (item.sale_price > 0) return item.sale_price;
  if (item.variants?.length) {
    const p = item.variants.map(v => v.price_override || item.base_price || item.price || 0).filter(p => p > 0);
    return p.length ? Math.min(...p) : (item.base_price || item.price || 0);
  }
  return item.base_price || item.price || 0;
}

function getImg(item) {
  return item.primary_image_url || item.image || (item.images?.[0]?.image_url) || "";
}

export default function CompleteTheLook({ currentItem, allItems, onAddToCart }) {
  const [swapSlot, setSwapSlot] = useState(null);
  const [swapOptions, setSwapOptions] = useState([]);
  const [overrides, setOverrides] = useState({});

  const outfits = useMemo(() => generateOutfits(currentItem, allItems, 3),
    [currentItem?.catalog_item_id || currentItem?.id, allItems.length]);

  if (!outfits.length) return null;

  const get = (oi, si) => overrides[`${oi}-${si}`] || outfits[oi].items[si];
  const total = (oi) => outfits[oi].items.reduce((s, _, si) => s + getPrice(get(oi, si)) / 10, 0).toFixed(0);

  const handleSwap = (oi, si) => {
    const item = get(oi, si);
    const group = getCatGroup(item.category);
    const g = (currentItem.gender || "").toLowerCase();
    setSwapOptions(allItems.filter(i => {
      if ((i.catalog_item_id || i.id) === (item.catalog_item_id || item.id)) return false;
      const ig = (i.gender || "").toLowerCase();
      if (g && ig && ig !== g && ig !== "unisex") return false;
      return getCatGroup(i.category) === group;
    }).slice(0, 12));
    setSwapSlot({ oi, si });
  };

  const applySwap = (item) => {
    setOverrides(p => ({ ...p, [`${swapSlot.oi}-${swapSlot.si}`]: item }));
    setSwapSlot(null);
  };

  const addOutfit = (oi) => outfits[oi].items.forEach((_, si) => onAddToCart?.(get(oi, si)));

  return (
    <div style={{ width: "100%", marginTop: 40 }}>
      <h3 style={{ fontSize: 18, fontWeight: 700, color: "#1a1a1a", margin: "0 0 4px", fontFamily: "'League Spartan'" }}>
        Complete the Look
      </h3>
      <p style={{ fontSize: 13, color: "#999", margin: "0 0 20px", fontStyle: "italic" }}>
        AI-styled outfit recommendations
      </p>

      {/* 3 outfit cards side by side */}
      <div style={{ display: "flex", gap: 16 }}>
        {outfits.map((outfit, oi) => (
          <div key={oi} style={{
            flex: 1,
            background: "#fff",
            borderRadius: 14,
            border: "1px solid #e5e7eb",
            overflow: "hidden",
            boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
          }}>
            {/* All items in equal vertical stack */}
            <div style={{ display: "flex", flexDirection: "column", gap: 1, background: "#f0f0f0" }}>
              {outfit.items.map((_, si) => {
                const item = get(oi, si);
                const img = getImg(item);
                const isSelected = si === 0;
                return (
                  <div key={si} style={{
                    position: "relative",
                    height: 140,
                    background: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                  }}>
                    <img src={img} alt={item.name} style={{
                      height: "100%",
                      maxWidth: "100%",
                      objectFit: "contain",
                    }} onError={e => { e.target.src = "https://via.placeholder.com/200x180/f8f9fa/ccc?text=" + getCatGroup(item.category); }} />
                    {isSelected && (
                      <div style={{
                        position: "absolute", top: 8, left: 8,
                        background: "#1a1a1a", color: "#fff",
                        fontSize: 8, fontWeight: 700, padding: "2px 6px",
                        borderRadius: 3, textTransform: "uppercase", letterSpacing: 0.5,
                      }}>Selected</div>
                    )}
                    <div style={{
                      position: "absolute", bottom: 4, right: 6,
                      fontSize: 11, fontWeight: 700, color: "#1a1a1a",
                      background: "rgba(255,255,255,0.9)", padding: "1px 6px",
                      borderRadius: 4,
                    }}>${(getPrice(item) / 10).toFixed(0)}</div>
                  </div>
                );
              })}
            </div>

            {/* Swap Items + Add Outfit */}
            <div style={{ padding: "10px 12px", borderTop: "1px solid #f0f0f0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                <span style={{ fontSize: 11, color: "#999", fontFamily: "'League Spartan'" }}>Swap Items</span>
                {outfit.items.slice(1).map((_, si) => {
                  const item = get(oi, si + 1);
                  return (
                    <div key={si} onClick={() => handleSwap(oi, si + 1)} style={{
                      width: 28, height: 28, borderRadius: 6, overflow: "hidden",
                      border: "1.5px solid #e5e7eb", cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = "#7c3aed"; e.currentTarget.style.transform = "scale(1.1)"; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = "#e5e7eb"; e.currentTarget.style.transform = "scale(1)"; }}>
                      <img src={getImg(item)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        onError={e => { e.target.style.display = "none"; }} />
                    </div>
                  );
                })}
              </div>
              <button onClick={() => addOutfit(oi)} style={{
                width: "100%", padding: "10px 0",
                background: "#1a1a1a", color: "#fff",
                border: "none", borderRadius: 8,
                fontSize: 13, fontWeight: 700, cursor: "pointer",
                fontFamily: "'League Spartan'",
              }}>
                Add Full Outfit — ${total(oi)}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Swap Modal */}
      {swapSlot && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setSwapSlot(null)}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 24, width: "90%", maxWidth: 480, maxHeight: "70vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h4 style={{ color: "#1a1a1a", margin: 0, fontSize: 18, fontFamily: "'League Spartan'" }}>Swap Item</h4>
              <button onClick={() => setSwapSlot(null)} style={{ background: "none", border: "none", color: "#999", fontSize: 22, cursor: "pointer" }}>x</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              {swapOptions.map((item, i) => (
                <div key={i} onClick={() => applySwap(item)} style={{
                  cursor: "pointer", borderRadius: 10, overflow: "hidden",
                  border: "1px solid #e5e7eb", transition: "all 0.2s",
                }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "#7c3aed"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(124,58,237,0.15)"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "#e5e7eb"; e.currentTarget.style.boxShadow = "none"; }}>
                  <img src={getImg(item)} alt="" style={{ width: "100%", aspectRatio: "3/4", objectFit: "cover" }}
                    onError={e => { e.target.style.display = "none"; }} />
                  <div style={{ padding: "4px 6px" }}>
                    <div style={{ fontSize: 10, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.name?.split(" ").slice(0, 3).join(" ")}
                    </div>
                    <div style={{ fontSize: 12, color: "#1a1a1a", fontWeight: 700 }}>${(getPrice(item) / 10).toFixed(0)}</div>
                  </div>
                </div>
              ))}
              {!swapOptions.length && <div style={{ gridColumn: "1/-1", textAlign: "center", color: "#999", padding: 40 }}>No alternatives found</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { getPrice, getImg, generateOutfits, getCatGroup };
