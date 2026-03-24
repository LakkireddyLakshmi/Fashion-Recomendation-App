import React, { useState, useMemo, useEffect } from "react";

const API = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

const SLOTS = [
  { key: "top", label: "Top", categories: ["t-shirt", "shirt", "top", "blouse", "kurta", "winterwear", "crop top"] },
  { key: "bottom", label: "Bottom", categories: ["jeans", "trousers", "joggers", "cargo", "shorts", "skirt", "leggings"] },
  { key: "shoes", label: "Shoes (optional)", categories: ["shoes", "sneakers", "boots", "sandals", "heels", "footwear"], optional: true },
];

const resolveImg = (item) => {
  if (item?.primary_image_url) return item.primary_image_url;
  const imgs = item?.images || [];
  const p = imgs.find((i) => i.is_primary);
  return p?.image_url || imgs[0]?.image_url || item?.image || null;
};

const resolvePrice = (item) =>
  item?.discounted_price || item?.base_price || item?.price || 0;

const cleanName = (item) => {
  let n = item?.name || item?.title || "Item";
  return n.length > 40 ? n.slice(0, 37) + "..." : n;
};

const getMainColor = (item) => {
  const colors = item?.available_colors || [];
  if (colors.length) return colors[0].toLowerCase();
  const tags = (item?.style_tags || []).join(" ").toLowerCase();
  const colorList = ["black","white","blue","red","green","pink","yellow","brown","grey","navy","beige","purple","orange"];
  return colorList.find(c => tags.includes(c)) || "";
};

function getAIFeedback(outfit) {
  const top = outfit.top;
  const bottom = outfit.bottom;
  if (!top || !bottom) return null;

  const topColor = getMainColor(top);
  const bottomColor = getMainColor(bottom);
  const topCat = (top.category || top.name || "").toLowerCase();
  const bottomCat = (bottom.category || bottom.name || "").toLowerCase();

  const tips = [];

  // Color pairing
  const neutrals = ["black", "white", "grey", "beige", "navy", "cream"];
  const warm = ["red", "orange", "yellow", "coral", "rust", "brown"];
  const cool = ["blue", "green", "teal", "purple", "navy", "lavender"];

  if (topColor === bottomColor && topColor) {
    tips.push("Monochrome looks are always sophisticated. Consider adding contrasting accessories.");
  } else if (neutrals.includes(topColor) && neutrals.includes(bottomColor)) {
    tips.push("Classic neutral pairing — timeless and versatile. A pop of color in accessories would elevate this.");
  } else if ((warm.includes(topColor) && cool.includes(bottomColor)) || (cool.includes(topColor) && warm.includes(bottomColor))) {
    tips.push("Nice contrast between warm and cool tones! This creates visual interest and balance.");
  } else if (neutrals.includes(topColor) || neutrals.includes(bottomColor)) {
    tips.push("Pairing a neutral with color is a smart choice — it lets the statement piece shine.");
  }

  // Category pairing
  if (topCat.includes("blazer") && (bottomCat.includes("jean") || bottomCat.includes("trouser"))) {
    tips.push("Smart casual combo! Perfect for dates, dinners, or casual meetings.");
  } else if (topCat.includes("t-shirt") && bottomCat.includes("jogger")) {
    tips.push("Comfortable athleisure vibes — great for weekends and casual outings.");
  } else if (topCat.includes("shirt") && bottomCat.includes("trouser")) {
    tips.push("Clean and polished. Works for office, interviews, and formal events.");
  } else if (topCat.includes("t-shirt") && bottomCat.includes("jean")) {
    tips.push("A timeless casual classic. You can't go wrong with this combo.");
  }

  if (tips.length === 0) {
    tips.push("Looks like a great outfit combination!");
  }

  return tips.join(" ");
}

function SlotPicker({ slot, items, selected, onSelect, onClear }) {
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    return items.filter((item) => {
      const cat = (item.category || "").toLowerCase();
      const tags = (item.style_tags || []).join(" ").toLowerCase();
      const name = (item.name || "").toLowerCase();
      return slot.categories.some(
        (c) => cat.includes(c) || tags.includes(c) || name.includes(c)
      );
    });
  }, [items, slot.categories]);

  return (
    <div style={{ flex: 1, minWidth: 200 }}>
      <div style={{
        fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 8,
        textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 600,
        fontFamily: "'League Spartan', sans-serif",
      }}>
        {slot.label}
      </div>

      {selected ? (
        <div style={{
          background: "rgba(255,255,255,0.06)", border: "1px solid rgba(168,85,247,0.3)",
          borderRadius: 16, padding: 12, position: "relative",
        }}>
          <button onClick={onClear} style={{
            position: "absolute", top: 8, right: 8,
            background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 8,
            width: 24, height: 24, color: "rgba(255,255,255,0.6)", cursor: "pointer",
            fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center",
          }}>x</button>
          <img
            src={resolveImg(selected) || ""}
            alt=""
            style={{ width: "100%", height: 160, objectFit: "contain", borderRadius: 12, background: "#fff", marginBottom: 8 }}
          />
          <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", fontFamily: "'League Spartan'" }}>
            {cleanName(selected)}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#c4b5fd", marginTop: 4, fontFamily: "'League Spartan'" }}>
            ${resolvePrice(selected).toLocaleString("en-US")}
          </div>
        </div>
      ) : (
        <div>
          <button onClick={() => setOpen(!open)} style={{
            width: "100%", padding: "40px 16px",
            background: "rgba(255,255,255,0.04)", border: "2px dashed rgba(255,255,255,0.15)",
            borderRadius: 16, color: "rgba(255,255,255,0.4)", cursor: "pointer",
            fontSize: 14, fontFamily: "'League Spartan'", fontWeight: 600,
            transition: "all 0.2s",
          }}>
            + Pick {slot.label}
          </button>
          {open && (
            <div style={{
              marginTop: 8, maxHeight: 300, overflowY: "auto",
              background: "rgba(15,15,26,0.98)", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 12, padding: 8,
            }}>
              {filtered.length === 0 ? (
                <div style={{ padding: 20, textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>
                  No {slot.label.toLowerCase()} found in catalog
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
                  {filtered.slice(0, 20).map((item) => (
                    <div
                      key={item.catalog_item_id || item.id}
                      onClick={() => { onSelect(item); setOpen(false); }}
                      style={{
                        background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: 8,
                        cursor: "pointer", border: "1px solid rgba(255,255,255,0.06)",
                        transition: "all 0.15s",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(168,85,247,0.4)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; }}
                    >
                      <img
                        src={resolveImg(item) || ""}
                        alt=""
                        style={{ width: "100%", height: 80, objectFit: "contain", borderRadius: 8, background: "#fff", marginBottom: 4 }}
                      />
                      <div style={{ fontSize: 11, color: "#fff", fontWeight: 600, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {cleanName(item)}
                      </div>
                      <div style={{ fontSize: 12, color: "#c4b5fd", fontWeight: 700, marginTop: 2 }}>
                        ${resolvePrice(item).toLocaleString("en-US")}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function OutfitBuilder({ allItems, onClose, userEmail, onAddToBag }) {
  const [outfit, setOutfit] = useState({ top: null, bottom: null, shoes: null });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [tab, setTab] = useState("build"); // "build" | "saved"
  const [savedOutfits, setSavedOutfits] = useState([]);
  const [copied, setCopied] = useState(false);

  const setSlot = (key, item) => setOutfit((p) => ({ ...p, [key]: item }));
  const clearSlot = (key) => setOutfit((p) => ({ ...p, [key]: null }));

  const total = Object.values(outfit).reduce((sum, item) => sum + (item ? resolvePrice(item) : 0), 0);
  const hasItems = outfit.top || outfit.bottom;
  const feedback = getAIFeedback(outfit);

  // Load saved outfits
  useEffect(() => {
    loadSavedOutfits();
  }, [userEmail]);

  const loadSavedOutfits = async () => {
    try {
      const r = await fetch(`${API}/api/user/${userEmail}/outfits`);
      if (r.ok) {
        const d = await r.json();
        setSavedOutfits(d.outfits || []);
      }
    } catch {
      // Fallback to localStorage
      setSavedOutfits(JSON.parse(localStorage.getItem("hueiq_outfits") || "[]"));
    }
  };

  const handleSave = async () => {
    if (!hasItems) return;
    setSaving(true);
    try {
      const outfitItems = Object.entries(outfit)
        .filter(([, v]) => v)
        .map(([slot, item]) => ({
          slot,
          catalog_item_id: item.catalog_item_id || item.id,
          name: item.name || item.title,
          price: resolvePrice(item),
          image: resolveImg(item),
        }));

      const r = await fetch(`${API}/api/user/${userEmail}/outfits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: outfitItems, name: `Outfit ${new Date().toLocaleDateString()}` }),
      });

      if (r.ok) {
        // Also save to localStorage as backup
        const existing = JSON.parse(localStorage.getItem("hueiq_outfits") || "[]");
        existing.push({ items: outfitItems, created_at: new Date().toISOString() });
        localStorage.setItem("hueiq_outfits", JSON.stringify(existing));
      }

      setSaved(true);
      setToast("Outfit saved successfully!");
      setTimeout(() => { setSaved(false); setToast(""); }, 2500);
      loadSavedOutfits();
    } catch (e) {
      console.error("Save outfit failed:", e);
      setToast("Failed to save. Try again.");
      setTimeout(() => setToast(""), 2500);
    } finally {
      setSaving(false);
    }
  };

  const handleAddAllToCart = () => {
    if (!onAddToBag) return;
    const items = Object.values(outfit).filter(Boolean);
    items.forEach(item => {
      onAddToBag(item);
    });
    setToast(`Added ${items.length} items to bag!`);
    setTimeout(() => setToast(""), 2500);
  };

  const handleShare = async () => {
    const items = Object.entries(outfit).filter(([, v]) => v);
    const text = items.map(([slot, item]) =>
      `${slot.toUpperCase()}: ${item.name || item.title} - $${resolvePrice(item)}`
    ).join("\n");
    const shareText = `Check out my HueIQ outfit!\n\n${text}\n\nTotal: $${total.toLocaleString("en-US")}`;

    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setToast("Outfit copied to clipboard!");
      setTimeout(() => { setCopied(false); setToast(""); }, 2500);
    } catch {
      setToast("Couldn't copy. Try again.");
      setTimeout(() => setToast(""), 2500);
    }
  };

  const handleDeleteOutfit = async (outfitId) => {
    try {
      await fetch(`${API}/api/user/${userEmail}/outfits/${outfitId}`, { method: "DELETE" });
      loadSavedOutfits();
      setToast("Outfit deleted");
      setTimeout(() => setToast(""), 2000);
    } catch {}
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 400, backdropFilter: "blur(4px)" }} />
      <div style={{
        position: "fixed", inset: "5vh 5vw",
        background: "linear-gradient(135deg, #0f0f1a 0%, #1a1030 100%)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 28, zIndex: 401,
        display: "flex", flexDirection: "column",
        fontFamily: "'League Spartan', sans-serif",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        overflow: "hidden",
      }}>
        {/* Toast */}
        {toast && (
          <div style={{
            position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)",
            background: saved ? "#16a34a" : "#7c3aed", color: "#fff",
            padding: "10px 24px", borderRadius: 12, fontSize: 14, fontWeight: 600,
            zIndex: 410, boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
            animation: "fadeIn 0.3s ease",
          }}>
            {toast}
          </div>
        )}

        {/* Header */}
        <div style={{
          padding: "20px 28px 0",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          display: "flex", flexDirection: "column",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>Outfit Builder</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>Mix and match to create your perfect outfit</div>
            </div>
            <button onClick={onClose} style={{
              background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 10,
              width: 36, height: 36, color: "rgba(255,255,255,0.6)", cursor: "pointer",
              fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center",
            }}>X</button>
          </div>
          {/* Tabs */}
          <div style={{ display: "flex", gap: 0 }}>
            {["build", "saved"].map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                flex: 1, padding: "10px 0", background: "none", border: "none",
                borderBottom: tab === t ? "2px solid #a855f7" : "2px solid transparent",
                color: tab === t ? "#fff" : "rgba(255,255,255,0.4)",
                fontSize: 14, fontWeight: 600, cursor: "pointer",
                fontFamily: "'League Spartan'", textTransform: "uppercase", letterSpacing: 1,
              }}>
                {t === "build" ? "Build Outfit" : `Saved (${savedOutfits.length})`}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
          {tab === "build" ? (
            <>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                {SLOTS.map((slot) => (
                  <SlotPicker
                    key={slot.key}
                    slot={slot}
                    items={allItems}
                    selected={outfit[slot.key]}
                    onSelect={(item) => setSlot(slot.key, item)}
                    onClear={() => clearSlot(slot.key)}
                  />
                ))}
              </div>

              {/* AI Feedback */}
              {feedback && hasItems && (
                <div style={{
                  marginTop: 20, padding: "14px 20px",
                  background: "linear-gradient(135deg, rgba(168,85,247,0.15), rgba(124,58,237,0.1))",
                  border: "1px solid rgba(168,85,247,0.2)", borderRadius: 14,
                  display: "flex", alignItems: "flex-start", gap: 12,
                }}>
                  <span style={{ fontSize: 20 }}>&#x2728;</span>
                  <div>
                    <div style={{ fontSize: 12, color: "#c4b5fd", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
                      AI Stylist Tip
                    </div>
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.5 }}>
                      {feedback}
                    </div>
                  </div>
                </div>
              )}

              {/* Outfit preview */}
              {hasItems && (
                <div style={{
                  marginTop: 24, padding: 24,
                  background: "rgba(255,255,255,0.04)", borderRadius: 20,
                  border: "1px solid rgba(255,255,255,0.08)",
                }}>
                  <div style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", marginBottom: 16, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
                    Your Outfit
                  </div>
                  <div style={{ display: "flex", justifyContent: "center", gap: 20, alignItems: "flex-end", flexWrap: "wrap" }}>
                    {["top", "bottom", "shoes"].map((key) => {
                      const item = outfit[key];
                      if (!item) return null;
                      return (
                        <div key={key} style={{ textAlign: "center" }}>
                          <div style={{
                            width: 140, height: key === "shoes" ? 100 : 160,
                            background: "#fff", borderRadius: 16, overflow: "hidden",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            padding: 8, border: "2px solid rgba(168,85,247,0.3)",
                          }}>
                            <img src={resolveImg(item) || ""} alt=""
                              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                          </div>
                          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 6, textTransform: "uppercase", letterSpacing: 1 }}>
                            {key}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 20, textAlign: "center", fontSize: 18, fontWeight: 700, color: "#c4b5fd" }}>
                    Total: ${total.toLocaleString("en-US")}
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Saved Outfits Gallery */
            <div>
              {savedOutfits.length === 0 ? (
                <div style={{ textAlign: "center", padding: "60px 20px", color: "rgba(255,255,255,0.3)" }}>
                  <div style={{ fontSize: 48, marginBottom: 16 }}>&#128090;</div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>No saved outfits yet</div>
                  <div style={{ fontSize: 13, marginTop: 8 }}>Build your first outfit and save it!</div>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280, 1fr))", gap: 16 }}>
                  {savedOutfits.map((o, idx) => (
                    <div key={o.id || idx} style={{
                      background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 16, padding: 16, position: "relative",
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>{o.name || `Outfit ${idx + 1}`}</div>
                        <button onClick={() => handleDeleteOutfit(o.id)} style={{
                          background: "rgba(239,68,68,0.2)", border: "none", borderRadius: 6,
                          padding: "4px 8px", color: "#ef4444", cursor: "pointer", fontSize: 11,
                        }}>Delete</button>
                      </div>
                      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                        {(o.items || []).map((item, i) => (
                          <div key={i} style={{ textAlign: "center" }}>
                            <div style={{
                              width: 70, height: 80, background: "#fff", borderRadius: 10,
                              overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center",
                              padding: 4,
                            }}>
                              <img src={item.image || ""} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                            </div>
                            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 4, textTransform: "uppercase" }}>{item.slot}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ marginTop: 10, fontSize: 13, color: "#c4b5fd", fontWeight: 600, textAlign: "center" }}>
                        ${(o.items || []).reduce((s, i) => s + (i.price || 0), 0).toLocaleString("en-US")}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {tab === "build" && (
          <div style={{ padding: "16px 28px 24px", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button onClick={onClose} style={{
              flex: "1 1 100px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 14, padding: "14px 0", color: "rgba(255,255,255,0.6)",
              fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'League Spartan'",
            }}>
              Cancel
            </button>
            {hasItems && (
              <>
                <button onClick={handleShare} style={{
                  flex: "1 1 100px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 14, padding: "14px 0", color: copied ? "#16a34a" : "rgba(255,255,255,0.6)",
                  fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'League Spartan'",
                }}>
                  {copied ? "Copied!" : "Share"}
                </button>
                <button onClick={handleAddAllToCart} style={{
                  flex: "1 1 100px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 14, padding: "14px 0", color: "rgba(255,255,255,0.6)",
                  fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'League Spartan'",
                }}>
                  Add All to Bag
                </button>
              </>
            )}
            <button
              onClick={handleSave}
              disabled={!hasItems || saving}
              style={{
                flex: "2 1 200px",
                background: saved ? "#16a34a" : hasItems ? "linear-gradient(135deg, #7c3aed, #a855f7)" : "rgba(255,255,255,0.08)",
                border: "none", borderRadius: 14, padding: "14px 0",
                color: hasItems ? "#fff" : "rgba(255,255,255,0.3)",
                fontSize: 16, fontWeight: 700, cursor: hasItems && !saving ? "pointer" : "default",
                fontFamily: "'League Spartan'", letterSpacing: 0.5,
                boxShadow: hasItems && !saved ? "0 4px 20px rgba(124,58,237,0.4)" : "none",
                transition: "all 0.3s", opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? "Saving..." : saved ? "Outfit Saved!" : "Save Outfit"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
