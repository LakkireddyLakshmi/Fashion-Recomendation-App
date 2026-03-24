import React, { useState, useMemo } from "react";

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
  return p?.image_url || imgs[0]?.image_url || null;
};

const resolvePrice = (item) =>
  item?.discounted_price || item?.base_price || item?.price || 0;

const cleanName = (item) => {
  let n = item?.name || item?.title || "Item";
  return n.length > 40 ? n.slice(0, 37) + "..." : n;
};

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
            src={resolveImg(selected) || "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=200&fit=crop"}
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
                        src={resolveImg(item) || "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=120&fit=crop"}
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

export default function OutfitBuilder({ allItems, onClose, userEmail }) {
  const [outfit, setOutfit] = useState({ top: null, bottom: null, shoes: null });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const setSlot = (key, item) => setOutfit((p) => ({ ...p, [key]: item }));
  const clearSlot = (key) => setOutfit((p) => ({ ...p, [key]: null }));

  const total = Object.values(outfit).reduce((sum, item) => sum + (item ? resolvePrice(item) : 0), 0);
  const hasItems = outfit.top || outfit.bottom;

  const handleSave = async () => {
    if (!hasItems) return;
    setSaving(true);
    try {
      const outfitData = {
        email: userEmail,
        items: Object.entries(outfit)
          .filter(([, v]) => v)
          .map(([slot, item]) => ({
            slot,
            catalog_item_id: item.catalog_item_id || item.id,
            name: item.name || item.title,
            price: resolvePrice(item),
            image: resolveImg(item),
          })),
        created_at: new Date().toISOString(),
      };
      // Save to localStorage as a simple persistence
      const existing = JSON.parse(localStorage.getItem("hueiq_outfits") || "[]");
      existing.push(outfitData);
      localStorage.setItem("hueiq_outfits", JSON.stringify(existing));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error("Save outfit failed:", e);
    } finally {
      setSaving(false);
    }
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
        {/* Header */}
        <div style={{
          padding: "20px 28px 16px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>Outfit Builder</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>Mix and match to create your perfect outfit</div>
          </div>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 10,
            width: 36, height: 36, color: "rgba(255,255,255,0.6)", cursor: "pointer",
            fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center",
          }}>x</button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
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

          {/* Visual outfit stack */}
          {hasItems && (
            <div style={{
              marginTop: 32, padding: 24,
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
                        <img
                          src={resolveImg(item) || "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=200&fit=crop"}
                          alt=""
                          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                        />
                      </div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 6, textTransform: "uppercase", letterSpacing: 1 }}>
                        {key}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{
                marginTop: 20, textAlign: "center",
                fontSize: 18, fontWeight: 700, color: "#c4b5fd",
              }}>
                Total: ${total.toLocaleString("en-US")}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "16px 28px 24px", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", gap: 12 }}>
          <button onClick={onClose} style={{
            flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 14, padding: "14px 0", color: "rgba(255,255,255,0.6)",
            fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "'League Spartan'",
          }}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!hasItems || saving}
            style={{
              flex: 2,
              background: saved ? "#16a34a" : hasItems ? "linear-gradient(135deg, #7c3aed, #a855f7)" : "rgba(255,255,255,0.08)",
              border: "none", borderRadius: 14, padding: "14px 0",
              color: hasItems ? "#fff" : "rgba(255,255,255,0.3)",
              fontSize: 16, fontWeight: 700, cursor: hasItems && !saving ? "pointer" : "default",
              fontFamily: "'League Spartan'", letterSpacing: 0.5,
              boxShadow: hasItems && !saved ? "0 4px 20px rgba(124,58,237,0.4)" : "none",
              transition: "all 0.3s",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "Saving..." : saved ? "Outfit Saved!" : "Save Outfit"}
          </button>
        </div>
      </div>
    </>
  );
}
