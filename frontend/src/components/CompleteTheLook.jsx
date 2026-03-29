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
  // Only pair tops with bottoms and vice versa — no accessories, no shoes
  switch (group) {
    case "top": return ["bottom"];
    case "bottom": return ["top"];
    case "dress": return ["top"];
    default: return ["top", "bottom"];
  }
}

// Style categories for occasion matching
const FORMAL_TAGS = ["formal","office","business","professional","classic","elegant","corporate","work"];
const CASUAL_TAGS = ["casual","relaxed","everyday","street","streetwear","weekend","comfort"];
const PARTY_TAGS = ["party","evening","cocktail","glam","festive","night","club"];
const SPORTY_TAGS = ["sport","athletic","gym","active","workout","jogger","track"];

function getStyleVibe(item) {
  const tags = (item.style_tags || []).map(t => t.toLowerCase());
  const cat = (item.category || "").toLowerCase();
  const name = (item.name || "").toLowerCase();
  const all = [...tags, cat, name].join(" ");
  if (FORMAL_TAGS.some(t => all.includes(t))) return "formal";
  if (SPORTY_TAGS.some(t => all.includes(t))) return "sporty";
  if (PARTY_TAGS.some(t => all.includes(t))) return "party";
  if (CASUAL_TAGS.some(t => all.includes(t))) return "casual";
  // Infer from category
  if (/blazer|shirt|trouser|formal/.test(cat)) return "formal";
  if (/jogger|track|cargo/.test(cat)) return "casual";
  return "casual";
}

// Complementary color pairs (dark top → light bottom, etc.)
const COMPLEMENTARY = {
  "black": ["white","beige","cream","grey","khaki","light blue"],
  "navy": ["white","beige","cream","khaki","light grey"],
  "white": ["black","navy","blue","grey","charcoal","denim"],
  "blue": ["white","beige","khaki","cream","black"],
  "red": ["black","white","navy","denim","grey"],
  "pink": ["white","black","grey","navy","denim"],
  "green": ["black","white","beige","cream","khaki"],
  "grey": ["black","white","navy","blue","burgundy"],
  "brown": ["white","beige","cream","navy","black"],
  "beige": ["black","navy","brown","white","burgundy"],
};

function matchScore(currentItem, candidateItem) {
  let score = 0;
  const aColors = (currentItem.available_colors || []).map(c => c.toLowerCase());
  const bColors = (candidateItem.available_colors || []).map(c => c.toLowerCase());
  const aTags = (currentItem.style_tags || []).map(t => t.toLowerCase());
  const bTags = (candidateItem.style_tags || []).map(t => t.toLowerCase());

  // 1. Style/occasion match (+5 for same vibe)
  const vibeA = getStyleVibe(currentItem);
  const vibeB = getStyleVibe(candidateItem);
  if (vibeA === vibeB) score += 5;
  else if ((vibeA === "formal" && vibeB === "casual") || (vibeA === "casual" && vibeB === "formal")) score += 1;

  // 2. Color harmony (+3 for complementary, +2 for matching, +1 for neutral)
  const neutrals = ["black","white","grey","gray","beige","cream","navy","charcoal"];
  for (const ac of aColors) {
    const complements = COMPLEMENTARY[ac] || [];
    if (bColors.some(bc => complements.includes(bc))) { score += 3; break; }
  }
  if (aColors.some(c => bColors.includes(c))) score += 2;
  if (bColors.some(c => neutrals.includes(c))) score += 1;

  // 3. Style tag overlap (+2 per shared tag, max 6)
  const tagOverlap = aTags.filter(t => bTags.includes(t)).length;
  score += Math.min(tagOverlap * 2, 6);

  // 4. Fit compatibility (+2)
  const aFit = (currentItem.style_tags || []).find(t => /slim|regular|loose|oversized|relaxed|fitted/.test(t.toLowerCase()));
  const bFit = (candidateItem.style_tags || []).find(t => /slim|regular|loose|oversized|relaxed|fitted/.test(t.toLowerCase()));
  if (aFit && bFit && aFit.toLowerCase() === bFit.toLowerCase()) score += 2;

  // 5. Price range similarity (+1 if within 50% price range)
  const priceA = getPrice(currentItem);
  const priceB = getPrice(candidateItem);
  if (priceA > 0 && priceB > 0) {
    const ratio = Math.min(priceA, priceB) / Math.max(priceA, priceB);
    if (ratio > 0.5) score += 1;
  }

  return score;
}

function generateOutfits(currentItem, allItems, count = 3) {
  const currentGroup = getCatGroup(currentItem.category);
  const currentGender = (currentItem.gender || "").toLowerCase();
  const currentId = currentItem.catalog_item_id || currentItem.id;
  const neededGroups = getComplementaryGroups(currentGroup);
  const grouped = {};
  for (const g of neededGroups) grouped[g] = [];
  allItems.forEach(item => {
    if ((item.catalog_item_id || item.id) === currentId) return;
    // Skip items with no price
    const price = getPrice(item);
    if (price <= 0) return;
    // Skip accessories
    const grp = getCatGroup(item.category);
    if (grp === "accessory" || grp === "shoes" || grp === "other") return;
    const g = (item.gender || "").toLowerCase();
    if (currentGender && g && g !== currentGender && g !== "unisex") return;
    const group = grp;
    if (grouped[group]) grouped[group].push({ ...item, _score: matchScore(currentItem, item) });
  });
  for (const g of neededGroups) grouped[g].sort((a, b) => b._score - a._score);
  const outfits = [];
  const used = {}; // track used items per group to avoid repeats
  for (const g of neededGroups) used[g] = new Set();

  for (let i = 0; i < count; i++) {
    const outfit = { id: i, items: [currentItem] };
    let isDifferent = false;
    for (const g of neededGroups) {
      if (outfit.items.length >= 3) break; // Max 3 items per outfit (current + 2)
      const pool = grouped[g];
      if (pool.length === 0) continue;
      // Find an unused item first, then fall back to round-robin
      let picked = null;
      for (let j = 0; j < pool.length; j++) {
        const idx = (i + j) % pool.length;
        const id = pool[idx].catalog_item_id || pool[idx].id;
        if (!used[g].has(id)) {
          picked = pool[idx];
          used[g].add(id);
          isDifferent = true;
          break;
        }
      }
      if (!picked) {
        picked = pool[i % pool.length];
      }
      outfit.items.push(picked);
    }
    if (outfit.items.length > 1 && (isDifferent || i === 0)) outfits.push(outfit);
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
