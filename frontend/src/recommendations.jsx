/**
 * Recommendations.jsx — HueIQ ULTRA v7
 * Real API (app.py v6.0) · Three.js 3D Viewer · Flip Cards · Wishlist/Likes/Share
 * Backend: https://hueiq-core-api.purplesand-63becfba.westus2.azurecontainerapps.io
 * Engine:  http://127.0.0.1:8002 (local fallback)
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  Suspense,
} from "react";

/* ─── CONSTANTS ───────────────────────────────────────────────────────────── */
const BOSS_API =
  "https://hueiq-core-api.purplesand-63becfba.westus2.azurecontainerapps.io";
const LOCAL_API = "http://127.0.0.1:8002";

/* ─── FALLBACK IMAGES ─────────────────────────────────────────────────────── */
const FB = {
  dress: [
    "1595777457583-95e059d581b8",
    "1566479179817-9cbf065c2a5e",
    "1612336307429-8a898d10e223",
  ],
  top: [
    "1594938298603-c8148c4b5ec4",
    "1554568218-0f1715e72254",
    "1503341504253-dff4815485f1",
  ],
  bottom: [
    "1490481651871-ab68de25d43d",
    "1584370848010-d7fe6bc767ec",
    "1542291026-7eec264c27ff",
  ],
  outerwear: [
    "1548126032-079a0fb0099d",
    "1551028719-00167b16eac5",
    "1544022613-e87ca75a784a",
  ],
  shoes: [
    "1543163521-1bf539c55dd2",
    "1595950653106-6c9ebd614d3a",
    "1542291026-7eec264c27ff",
  ],
  accessory: [
    "1611085583191-a3b181a88401",
    "1590548784585-643d2b9f2925",
    "1549298916-b41d501d3772",
  ],
  default: [
    "1558618666-fcd25c85cd64",
    "1560769629-975ec94e6a86",
    "1523275335684-37898b6baf30",
  ],
};

function fbKey(cat = "") {
  const c = cat.toLowerCase();
  if (c.includes("dress")) return "dress";
  if (["top", "shirt", "blouse", "tee", "sweat"].some((w) => c.includes(w)))
    return "top";
  if (
    ["pant", "jean", "skirt", "short", "bottom", "trouser"].some((w) =>
      c.includes(w),
    )
  )
    return "bottom";
  if (
    ["jacket", "coat", "outer", "blazer", "cardigan"].some((w) => c.includes(w))
  )
    return "outerwear";
  if (["shoe", "boot", "sneak", "heel", "sandal"].some((w) => c.includes(w)))
    return "shoes";
  if (
    ["bag", "watch", "jewel", "access", "hat", "scarf", "belt"].some((w) =>
      c.includes(w),
    )
  )
    return "accessory";
  return "default";
}

function stableImg(id, cat, idx = 0) {
  const pool = FB[fbKey(cat)] || FB.default;
  const h = [...(String(id || "x") + String(idx))].reduce(
    (a, c) => a + c.charCodeAt(0),
    0,
  );
  return `https://images.unsplash.com/photo-${pool[h % pool.length]}?w=700&fit=crop&auto=format`;
}

function getImages(item) {
  const id = item.catalog_item_id || item.id || item.title || "x";
  const cat = item.category || "";

  // Collect every possible image URL from the Boss API item fields
  const allUrls = [
    item.primary_image_url,
    item.image_url,
    item.image,
    item.thumbnail_url,
    item.cover_image,
    item.photo_url,
    item.media_url,
    item.img,
    item.picture,
    item.photo,
  ].filter((u) => u && typeof u === "string" && u.startsWith("http"));

  // Also pull from structured images array
  const imgs = item.images || [];
  const byView = { front: null, back: null, side: null };
  imgs.forEach((img) => {
    const url = img.image_url || img.url || img.src || "";
    if (!url) return;
    const v = (img.view || img.label || "").toLowerCase();
    if (v === "front" && !byView.front) byView.front = url;
    else if (v === "back" && !byView.back) byView.back = url;
    else if (v === "side" && !byView.side) byView.side = url;
    else allUrls.push(url);
  });

  // Also check image_urls array field
  (item.image_urls || []).forEach((u) => {
    if (u) allUrls.push(u);
  });

  const primary = byView.front || allUrls[0] || stableImg(id, cat, 0);
  const second = byView.back || allUrls[1] || stableImg(id, cat, 1);
  const third = byView.side || allUrls[2] || stableImg(id, cat, 2);

  return { front: primary, back: second, side: third };
}

function dedup(arr) {
  const seen = new Set();
  return (arr || []).filter((it) => {
    const k =
      it.catalog_item_id ||
      it.id ||
      (it.name || it.title) + "|" + (it.category || "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function normalise(it) {
  const id = it.catalog_item_id || it.id || String(Math.random());
  const price = it.sale_price || it.base_price || it.price || 0;
  const orig =
    it.base_price && it.sale_price && it.base_price > it.sale_price
      ? it.base_price
      : null;
  return {
    ...it,
    _id: id,
    _price: price,
    _orig: orig,
    _name: it.name || it.title || "Fashion Item",
    _score: Math.round((it.match_score || it.score || 0.85) * 100),
    _tags: it.style_tags || it.tags || [],
    _stars: Math.round(it.rating || 4),
    _imgs: getImages(it),
  };
}

/* ─── MOCK REVIEWS ──────────────────────────────────────────────────────── */
const REV_NAMES = [
  "Amara K.",
  "Sofia R.",
  "Priya M.",
  "Luna T.",
  "Zara A.",
  "Mia C.",
  "Nina B.",
  "Leila H.",
];
const REV_TEXTS = [
  "Absolutely obsessed — the fit is perfection and the fabric feels luxurious.",
  "Exceeded all expectations. Already received multiple compliments.",
  "The colour in person is even richer than the photos. Truly stunning.",
  "I've been searching for something like this for years. Worth every penny.",
  "The tailoring is immaculate. True to size with a beautiful drape.",
  "Arrived beautifully packaged. Quality is evident at first touch.",
  "Versatile enough for day-to-night styling. My wardrobe staple now.",
  "The attention to detail is remarkable. Feels like true couture.",
];
function seedReviews(id) {
  const h = [...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0);
  return Array.from({ length: 2 + (h % 3) }, (_, i) => ({
    name: REV_NAMES[(h + i * 7) % REV_NAMES.length],
    stars: 4 + ((h + i) % 2),
    date: `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][(h + i * 3) % 12]} 202${4 + ((h + i) % 2)}`,
    text: REV_TEXTS[(h + i * 13) % REV_TEXTS.length],
  }));
}

/* ─── THREE.JS 3D VIEWER ─────────────────────────────────────────────────── */
const THREE_CDN =
  "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";

function Viewer3D({ item, onClose }) {
  const mountRef = useRef(null);
  const frameRef = useRef(null);
  const rendRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [mode, setMode] = useState("rotate");
  const imgs = item._imgs;

  useEffect(() => {
    let THREE_lib = window.THREE;

    function init(THREE) {
      const el = mountRef.current;
      if (!el) return;
      const W = el.clientWidth,
        H = el.clientHeight;

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
      });
      renderer.setSize(W, H);
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.shadowMap.enabled = true;
      el.appendChild(renderer.domElement);
      rendRef.current = renderer;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
      camera.position.set(0, 0, 3.2);

      // Lighting
      scene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const dir = new THREE.DirectionalLight(0xfff5e0, 1.4);
      dir.position.set(3, 5, 3);
      dir.castShadow = true;
      scene.add(dir);
      const back = new THREE.DirectionalLight(0x9b8dff, 0.4);
      back.position.set(-3, -1, -3);
      scene.add(back);
      const point = new THREE.PointLight(0xd4a853, 0.8, 10);
      point.position.set(1, 2, 2);
      scene.add(point);

      // Cloth geometry — dress/garment shape
      const loader = new THREE.TextureLoader();
      const group = new THREE.Group();

      // Front panel
      const geo = new THREE.PlaneGeometry(1.6, 2.4, 20, 30);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i),
          y = pos.getY(i);
        pos.setZ(i, Math.sin(x * 1.8) * 0.06 + Math.cos(y * 1.2) * 0.04);
      }
      geo.computeVertexNormals();

      const mat = new THREE.MeshStandardMaterial({
        roughness: 0.75,
        metalness: 0.05,
        side: THREE.FrontSide,
      });
      loader.load(
        imgs.front,
        (tex) => {
          mat.map = tex;
          mat.needsUpdate = true;
          setStatus("ready");
        },
        undefined,
        () => setStatus("ready"),
      );

      const front = new THREE.Mesh(geo, mat);
      front.castShadow = true;
      group.add(front);

      // Back panel
      const geoB = new THREE.PlaneGeometry(1.6, 2.4, 20, 30);
      const posB = geoB.attributes.position;
      for (let i = 0; i < posB.count; i++) {
        const x = posB.getX(i),
          y = posB.getY(i);
        posB.setZ(i, Math.sin(x * 1.8) * 0.06 + Math.cos(y * 1.2) * 0.04);
      }
      geoB.computeVertexNormals();
      const matB = new THREE.MeshStandardMaterial({
        roughness: 0.75,
        metalness: 0.05,
        side: THREE.BackSide,
      });
      loader.load(
        imgs.back,
        (tex) => {
          matB.map = tex;
          matB.needsUpdate = true;
        },
        undefined,
        () => {},
      );
      const back_mesh = new THREE.Mesh(geoB, matB);
      group.add(back_mesh);

      // Fabric fold edge — thin cylinder along sides
      const edgeMat = new THREE.MeshStandardMaterial({
        color: 0x222228,
        roughness: 0.9,
      });
      [-0.8, 0.8].forEach((xPos) => {
        const edgeGeo = new THREE.CylinderGeometry(0.018, 0.018, 2.4, 8);
        const edge = new THREE.Mesh(edgeGeo, edgeMat);
        edge.position.set(xPos, 0, 0);
        group.add(edge);
      });

      // Ground shadow plane
      const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(4, 4),
        new THREE.MeshStandardMaterial({
          color: 0x0b0b10,
          roughness: 1,
          transparent: true,
          opacity: 0.4,
        }),
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = -1.3;
      shadow.receiveShadow = true;
      scene.add(shadow);

      // Holographic ring
      const ringGeo = new THREE.TorusGeometry(1.0, 0.008, 8, 64);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xd4a853,
        transparent: true,
        opacity: 0.35,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -1.28;
      scene.add(ring);

      scene.add(group);

      // Mouse interaction
      let isDragging = false,
        prevX = 0,
        prevY = 0;
      let rotY = 0,
        rotX = 0,
        autoSpin = true;

      const onDown = (e) => {
        isDragging = true;
        autoSpin = false;
        prevX = e.clientX || e.touches?.[0]?.clientX;
        prevY = e.clientY || e.touches?.[0]?.clientY;
      };
      const onUp = () => {
        isDragging = false;
      };
      const onMove = (e) => {
        if (!isDragging) return;
        const cx = e.clientX || e.touches?.[0]?.clientX;
        const cy = e.clientY || e.touches?.[0]?.clientY;
        rotY += (cx - prevX) * 0.012;
        rotX += (cy - prevY) * 0.008;
        rotX = Math.max(-0.6, Math.min(0.6, rotX));
        prevX = cx;
        prevY = cy;
      };

      renderer.domElement.addEventListener("mousedown", onDown);
      renderer.domElement.addEventListener("touchstart", onDown, {
        passive: true,
      });
      window.addEventListener("mouseup", onUp);
      window.addEventListener("touchend", onUp);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("touchmove", onMove, { passive: true });

      let t = 0;
      function animate() {
        frameRef.current = requestAnimationFrame(animate);
        t += 0.016;
        if (autoSpin) rotY += 0.006;
        group.rotation.y = rotY;
        group.rotation.x = rotX;
        // Subtle cloth flutter
        const posLive = geo.attributes.position;
        for (let i = 0; i < posLive.count; i++) {
          const x = posLive.getX(i),
            y = posLive.getY(i);
          posLive.setZ(
            i,
            Math.sin(x * 1.8 + t * 0.5) * 0.055 +
              Math.cos(y * 1.2 + t * 0.3) * 0.035,
          );
        }
        posLive.needsUpdate = true;
        geo.computeVertexNormals();
        ring.rotation.z = t * 0.4;
        ring.material.opacity = 0.2 + Math.sin(t * 1.2) * 0.15;
        renderer.render(scene, camera);
      }
      animate();
      setStatus("ready");
    }

    if (THREE_lib) {
      init(THREE_lib);
    } else {
      const script = document.createElement("script");
      script.src = THREE_CDN;
      script.onload = () => {
        THREE_lib = window.THREE;
        init(THREE_lib);
      };
      script.onerror = () => setStatus("error");
      document.head.appendChild(script);
    }

    return () => {
      cancelAnimationFrame(frameRef.current);
      if (rendRef.current) {
        rendRef.current.dispose();
        const canvas = rendRef.current.domElement;
        if (canvas.parentNode === mountRef.current)
          mountRef.current?.removeChild(canvas);
      }
    };
  }, [imgs.front, imgs.back]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,.97)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 20,
          right: 20,
          display: "flex",
          gap: 10,
        }}
      >
        <button
          onClick={() => setMode((m) => (m === "rotate" ? "zoom" : "rotate"))}
          style={btnStyle}
        >
          {mode === "rotate" ? "⟳ Rotating" : "⤢ Zoom"}
        </button>
        <button
          onClick={onClose}
          style={{
            ...btnStyle,
            background: "rgba(232,80,128,.15)",
            borderColor: "rgba(232,80,128,.4)",
            color: "#e85080",
          }}
        >
          ✕ Close
        </button>
      </div>
      <div style={{ position: "absolute", top: 20, left: 20 }}>
        <div
          style={{
            fontFamily: "'Cormorant Garamond',serif",
            fontSize: 22,
            color: "#d4a853",
            fontWeight: 600,
          }}
        >
          {item._name}
        </div>
        <div
          style={{
            fontSize: 11,
            color: "#6e6c82",
            letterSpacing: ".15em",
            textTransform: "uppercase",
            marginTop: 4,
          }}
        >
          3D Holographic Preview · Drag to rotate
        </div>
      </div>
      {status === "loading" && (
        <div
          style={{
            position: "absolute",
            color: "#6e6c82",
            fontSize: 13,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              border: "2px solid #242430",
              borderTop: "2px solid #d4a853",
              borderRadius: "50%",
              animation: "spin3d 1s linear infinite",
            }}
          />
          Loading 3D model…
        </div>
      )}
      <div
        ref={mountRef}
        style={{
          width: "min(700px,95vw)",
          height: "min(700px,90vh)",
          cursor: "grab",
        }}
      />
      <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
        {["Front", "Back", "Side"].map((v, i) => (
          <div key={v} style={{ textAlign: "center", cursor: "pointer" }}>
            <img
              src={[item._imgs.front, item._imgs.back, item._imgs.side][i]}
              alt={v}
              style={{
                width: 64,
                height: 64,
                objectFit: "cover",
                borderRadius: 8,
                border: "1.5px solid #242430",
                display: "block",
              }}
              onError={(e) =>
                (e.target.src = stableImg(item._id, item.category || "", i))
              }
            />
            <span
              style={{
                fontSize: 9,
                color: "#6e6c82",
                letterSpacing: ".15em",
                textTransform: "uppercase",
                marginTop: 4,
                display: "block",
              }}
            >
              {v}
            </span>
          </div>
        ))}
      </div>
      <style>{`@keyframes spin3d{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

const btnStyle = {
  background: "rgba(212,168,83,.12)",
  border: "1px solid rgba(212,168,83,.35)",
  color: "#d4a853",
  padding: "8px 16px",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: ".08em",
  fontFamily: "inherit",
};

/* ─── CSS ─────────────────────────────────────────────────────────────────── */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;0,700;1,300;1,600&family=DM+Sans:opsz,wght@9..40,200;9..40,300;9..40,400;9..40,500;9..40,600&display=swap');
:root{
  --void:#050507;--abyss:#0a0a0f;--surface:#111118;--lift:#18181f;--rim:#222230;
  --glass:rgba(255,255,255,.025);--glass2:rgba(255,255,255,.055);
  --gold:#d4a853;--gold2:#f0c97a;--gg:rgba(212,168,83,.28);--gd:rgba(212,168,83,.1);
  --cyan:#3fe8d8;--rose:#e85080;--lav:#9b8dff;
  --ink:#ece9e0;--sub:#a09da8;--muted:#5c5a6e;
  --bdr:rgba(255,255,255,.055);--bdr2:rgba(255,255,255,.11);--bdrg:rgba(212,168,83,.2);
  --cw:268px;--r:15px;
  --ease:cubic-bezier(.25,.46,.45,.94);--spring:cubic-bezier(.34,1.56,.64,1);
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
html{color-scheme:dark;scrollbar-width:thin;scrollbar-color:var(--rim) transparent;}
::-webkit-scrollbar{width:4px;height:4px;}
::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:var(--rim);border-radius:4px;}
.hq{min-height:100vh;background:var(--void);color:var(--ink);font-family:'DM Sans',sans-serif;position:relative;overflow-x:hidden;padding-bottom:160px;}

/* AMBIENT */
.amb{position:fixed;inset:0;pointer-events:none;z-index:0;overflow:hidden;}
.blob{position:absolute;border-radius:50%;filter:blur(160px);}
.b1{width:1200px;height:1200px;background:radial-gradient(circle,rgba(100,50,210,.2),transparent 65%);top:-400px;left:-350px;}
.b2{width:900px;height:900px;background:radial-gradient(circle,rgba(10,60,190,.16),transparent 65%);bottom:-250px;right:-200px;}
.b3{width:700px;height:700px;background:radial-gradient(circle,rgba(212,168,83,.08),transparent 65%);top:40%;left:45%;}
.noise{position:fixed;inset:0;pointer-events:none;z-index:1;opacity:.5;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.055'/%3E%3C/svg%3E");}

/* HERO */
.hero{position:relative;z-index:5;padding:80px 64px 52px;background:linear-gradient(180deg,rgba(212,168,83,.04) 0%,transparent 100%);border-bottom:1px solid var(--bdr);}
.hero-tag{display:inline-flex;align-items:center;gap:8px;font-size:9.5px;font-weight:600;letter-spacing:.45em;text-transform:uppercase;color:var(--gold);margin-bottom:18px;}
.hero-dot{width:6px;height:6px;border-radius:50%;background:var(--gold);animation:blink 2.2s ease-in-out infinite;}
@keyframes blink{0%,100%{opacity:1;box-shadow:0 0 6px var(--gold)}50%{opacity:.2;box-shadow:none}}
.hero-h{font-family:'Cormorant Garamond',serif;font-size:clamp(46px,5.5vw,82px);font-weight:300;line-height:.93;letter-spacing:-.022em;margin-bottom:30px;}
.hero-h strong{font-weight:700;}
.hero-h em{font-style:italic;background:linear-gradient(135deg,var(--gold) 0%,var(--gold2) 55%,#ffb07a 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}
.hero-stats{display:flex;align-items:center;gap:28px;flex-wrap:wrap;}
.hstat{display:flex;flex-direction:column;gap:3px;}
.hnum{font-family:'Cormorant Garamond',serif;font-size:32px;font-weight:700;color:var(--gold2);line-height:1;}
.hlbl{font-size:9px;letter-spacing:.22em;text-transform:uppercase;color:var(--muted);}
.hsep{width:1px;height:38px;background:var(--bdr);}

/* BAR */
.bar{position:sticky;top:0;z-index:50;background:rgba(5,5,7,.92);backdrop-filter:blur(28px) saturate(180%);border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:10px;padding:13px 64px;flex-wrap:wrap;}
.tabs{display:flex;gap:3px;flex-wrap:wrap;}
.tab{background:none;border:1px solid transparent;border-radius:100px;padding:6.5px 17px;font:11.5px/1 'DM Sans',sans-serif;color:var(--muted);cursor:pointer;transition:all .2s;letter-spacing:.03em;white-space:nowrap;}
.tab:hover{color:var(--ink);border-color:var(--bdr);}
.tab.on{background:var(--gd);border-color:var(--bdrg);color:var(--gold2);font-weight:600;}
.spacer{flex:1;}
.sort{appearance:none;background:var(--lift);border:1px solid var(--bdr);color:var(--ink);border-radius:100px;padding:7px 36px 7px 16px;font:12px 'DM Sans',sans-serif;cursor:pointer;outline:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%235c5a6e' fill='none' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 14px center;}
.vtgl{display:flex;gap:2px;background:var(--lift);border:1px solid var(--bdr);border-radius:8px;padding:3px;}
.vb{background:none;border:none;color:var(--muted);padding:6px 10px;cursor:pointer;border-radius:6px;transition:all .2s;font-size:14px;line-height:1;}
.vb.on{background:var(--rim);color:var(--ink);}

/* CONTENT */
.content{position:relative;z-index:5;padding:40px 64px;}
.section{margin-bottom:60px;}
.sec-head{display:flex;align-items:baseline;gap:16px;margin-bottom:22px;border-bottom:1px solid var(--bdr);padding-bottom:13px;}
.sec-title{font-family:'Cormorant Garamond',serif;font-size:26px;font-weight:600;letter-spacing:-.01em;}
.sec-count{font-size:11px;color:var(--muted);letter-spacing:.07em;}
.sec-badge{margin-left:auto;font-size:9px;font-weight:700;letter-spacing:.28em;text-transform:uppercase;color:var(--gold);background:var(--gd);border:1px solid var(--bdrg);padding:4px 10px;border-radius:100px;}
.row{display:flex;gap:18px;overflow-x:auto;padding-bottom:14px;cursor:grab;scrollbar-width:none;}
.row:active{cursor:grabbing;}
.row::-webkit-scrollbar{display:none;}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(var(--cw),1fr));gap:20px;}

/* ═══ CARD ═══ */
.cw{width:var(--cw);flex-shrink:0;perspective:1000px;}
.card{width:100%;position:relative;transform-style:preserve-3d;transition:transform .7s var(--ease);cursor:pointer;}
.card.flipped{transform:rotateY(180deg);}
.face{width:100%;backface-visibility:hidden;border-radius:var(--r);overflow:hidden;background:var(--surface);border:1px solid var(--bdr);box-shadow:0 4px 28px rgba(0,0,0,.55);transition:border-color .3s,box-shadow .3s;}
.cw:hover .face{border-color:var(--bdrg);box-shadow:0 14px 60px rgba(0,0,0,.9),0 0 60px var(--gg);}
.face-back{position:absolute;top:0;left:0;transform:rotateY(180deg);width:100%;}
.cimg{position:relative;width:100%;height:320px;overflow:hidden;background:var(--lift);}
.cimg img{width:100%;height:100%;object-fit:cover;transition:transform .6s var(--ease),opacity .3s;}
.cw:hover .face:not(.face-back) .cimg img{transform:scale(1.06);}
.holo{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .45s;mix-blend-mode:screen;
  background:conic-gradient(from 180deg at 50% 50%,transparent 0deg,rgba(155,141,255,.06) 60deg,rgba(63,232,216,.05) 120deg,transparent 180deg,rgba(212,168,83,.07) 240deg,transparent 360deg);}
.cw:hover .holo{opacity:1;}

/* score ring */
.score-wrap{position:absolute;top:12px;right:12px;width:42px;height:42px;}
.score-wrap svg{width:42px;height:42px;}
.s-track{fill:none;stroke:rgba(255,255,255,.06);stroke-width:2.5;}
.s-ring{fill:none;stroke:var(--gold);stroke-width:2.5;stroke-linecap:round;transition:stroke-dasharray .8s var(--ease);}
.s-txt{font-size:8.5px;font-weight:700;fill:var(--gold2);dominant-baseline:middle;text-anchor:middle;font-family:'DM Sans',sans-serif;}
.badge-new{position:absolute;top:12px;right:62px;font-size:7.5px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;background:var(--rose);color:#fff;padding:3px 8px;border-radius:4px;}
.badge-3d{position:absolute;bottom:50px;right:10px;font-size:8px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;background:rgba(155,141,255,.18);border:1px solid rgba(155,141,255,.35);color:var(--lav);padding:3px 8px;border-radius:4px;cursor:pointer;transition:all .2s;z-index:3;}
.badge-3d:hover{background:rgba(155,141,255,.32);color:#fff;}

/* actions — always visible */
.actions{position:absolute;top:10px;left:10px;display:flex;flex-direction:column;gap:6px;opacity:1;transform:translateX(0);z-index:4;}
.act{width:34px;height:34px;border-radius:9px;background:rgba(5,5,7,.85);backdrop-filter:blur(10px);border:1px solid var(--bdr);color:var(--muted);font-size:14px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;}
.act:hover{background:var(--glass2);color:var(--ink);border-color:var(--bdr2);}
.act.wl{color:var(--rose);border-color:rgba(232,80,128,.38);background:rgba(232,80,128,.08);}
.act.lk{color:var(--gold);border-color:var(--bdrg);background:var(--gd);}
.act.sh{color:var(--cyan);border-color:rgba(63,232,216,.3);background:rgba(63,232,216,.06);}

/* view dots — always visible */
.vdots{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);display:flex;gap:5px;opacity:1;z-index:4;}
.vd{width:26px;height:26px;border-radius:7px;background:rgba(5,5,7,.85);backdrop-filter:blur(8px);border:1px solid var(--bdr);color:var(--muted);font-size:9px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;}
.vd.on,.vd:hover{background:var(--gd);border-color:var(--bdrg);color:var(--gold2);}

/* card body */
.cbody{padding:14px 16px 16px;}
.cbrand{font-size:9px;letter-spacing:.24em;text-transform:uppercase;color:var(--muted);margin-bottom:4px;}
.ctitle{font-family:'Cormorant Garamond',serif;font-size:17.5px;font-weight:600;letter-spacing:-.01em;line-height:1.22;margin-bottom:9px;}
.crow{display:flex;align-items:center;justify-content:space-between;}
.cprice{font-size:15px;font-weight:600;color:var(--gold2);}
.cprice s{font-size:11px;color:var(--muted);margin-left:5px;font-weight:400;}
.cstars{color:var(--gold);font-size:11px;letter-spacing:-1px;}
.creason{font-size:9.5px;color:var(--muted);margin-top:7px;letter-spacing:.04em;line-height:1.5;border-top:1px solid var(--bdr);padding-top:7px;}

/* card bottom action bar */
.cbar{display:flex;gap:6px;padding:10px 14px 12px;border-top:1px solid var(--bdr);background:rgba(5,5,7,.6);}
.cbar-btn{flex:1;height:30px;border-radius:8px;border:1px solid var(--bdr);background:none;color:var(--muted);font-size:11px;cursor:pointer;transition:all .2s;display:flex;align-items:center;justify-content:center;gap:4px;font-family:inherit;white-space:nowrap;}
.cbar-btn:hover{color:var(--ink);border-color:var(--bdr2);}
.cbar-btn.wl{color:var(--rose);border-color:rgba(232,80,128,.38);background:rgba(232,80,128,.07);}
.cbar-btn.lk{color:var(--gold);border-color:var(--bdrg);background:var(--gd);}
.cbar-btn.sh{color:var(--cyan);border-color:rgba(63,232,216,.28);background:rgba(63,232,216,.05);}

/* BACK FACE */
.face-back .cimg{height:210px;}
.bpad{padding:14px 16px 16px;}
.bname{font-family:'Cormorant Garamond',serif;font-size:15px;font-weight:700;color:var(--gold2);margin-bottom:10px;}
.bln{font-size:11px;color:var(--muted);margin-bottom:5px;line-height:1.55;}
.bln strong{color:var(--ink);}
.btags{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px;}
.btag{font-size:9px;padding:3px 8px;border-radius:100px;background:var(--lift);border:1px solid var(--bdr);color:var(--muted);letter-spacing:.05em;}
.bbtn{width:100%;padding:9px;border-radius:9px;background:linear-gradient(135deg,var(--gold) 0%,var(--gold2) 100%);border:none;color:var(--void);font:600 11px/1 'DM Sans',sans-serif;letter-spacing:.08em;cursor:pointer;transition:opacity .2s;margin-bottom:6px;}
.bbtn:hover{opacity:.85;}
.bflip{width:100%;padding:8px;border-radius:9px;background:none;border:1px solid var(--bdr);color:var(--muted);font:400 11px/1 'DM Sans',sans-serif;cursor:pointer;transition:all .2s;}
.bflip:hover{color:var(--ink);border-color:var(--bdr2);}

/* SKELETON */
.skel{width:var(--cw);flex-shrink:0;border-radius:var(--r);background:var(--surface);border:1px solid var(--bdr);overflow:hidden;}
.si{height:320px;background:linear-gradient(90deg,var(--surface) 25%,var(--lift) 50%,var(--surface) 75%);background-size:200% 100%;animation:shimmer 1.7s infinite;}
.sb{padding:14px 16px;}
.sl{height:10px;border-radius:6px;margin-bottom:8px;background:linear-gradient(90deg,var(--surface) 25%,var(--lift) 50%,var(--surface) 75%);background-size:200% 100%;animation:shimmer 1.7s infinite;}
@keyframes shimmer{to{background-position:-200% 0}}

/* ERROR */
.errbox{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 40px;text-align:center;color:var(--muted);gap:16px;}
.erricon{font-size:50px;opacity:.35;}
.retry{padding:10px 28px;border-radius:100px;background:var(--gd);border:1px solid var(--bdrg);color:var(--gold2);font:12px 'DM Sans',sans-serif;cursor:pointer;transition:all .2s;}
.retry:hover{background:var(--gold);color:var(--void);}

/* ═══ MODAL ═══ */
.mbg{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.9);backdrop-filter:blur(28px);display:flex;align-items:center;justify-content:center;padding:20px;animation:fIn .3s var(--ease);}
@keyframes fIn{from{opacity:0}to{opacity:1}}
.modal{width:100%;max-width:1000px;max-height:94vh;background:var(--abyss);border:1px solid var(--bdrg);border-radius:20px;overflow:hidden;display:flex;animation:sUp .35s var(--spring);box-shadow:0 40px 120px rgba(0,0,0,.95),0 0 120px var(--gg);position:relative;}
@keyframes sUp{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:translateY(0)}}
.mgallery{width:420px;flex-shrink:0;display:flex;flex-direction:column;background:var(--surface);border-right:1px solid var(--bdr);}
.mmain{flex:1;position:relative;overflow:hidden;min-height:320px;}
.mmain img{width:100%;height:100%;object-fit:cover;transition:transform .5s var(--ease);}
.mmain:hover img{transform:scale(1.04);}
.mthumbs{display:flex;gap:8px;padding:12px;background:var(--abyss);border-top:1px solid var(--bdr);}
.mthumb{flex:1;height:74px;border-radius:9px;overflow:hidden;cursor:pointer;border:1.5px solid var(--bdr);transition:all .2s;position:relative;}
.mthumb.on{border-color:var(--gold);}
.mthumb img{width:100%;height:100%;object-fit:cover;}
.mthumb-lbl{position:absolute;bottom:3px;left:0;right:0;text-align:center;font-size:7px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-family:'DM Sans',sans-serif;}
.mthumb.on .mthumb-lbl{color:var(--gold);}
.mbody{flex:1;overflow-y:auto;padding:30px;scrollbar-width:thin;scrollbar-color:var(--rim) transparent;}
.mbrand{font-size:9px;letter-spacing:.3em;text-transform:uppercase;color:var(--gold);margin-bottom:5px;}
.mtitle{font-family:'Cormorant Garamond',serif;font-size:30px;font-weight:600;line-height:1.1;letter-spacing:-.02em;margin-bottom:8px;}
.mpricerow{display:flex;align-items:baseline;gap:12px;margin-bottom:10px;}
.mprice{font-size:22px;font-weight:600;color:var(--gold2);}
.moprice{font-size:14px;color:var(--muted);text-decoration:line-through;}
.mreason{font-size:11.5px;color:var(--lav);margin-bottom:20px;line-height:1.55;border-left:2px solid rgba(155,141,255,.3);padding-left:12px;}
.mclose{position:absolute;top:14px;right:14px;z-index:10;background:var(--lift);border:1px solid var(--bdr);color:var(--muted);width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;transition:all .2s;}
.mclose:hover{color:var(--ink);border-color:var(--bdr2);}
.m3d-btn{width:100%;padding:10px;border-radius:9px;background:rgba(155,141,255,.1);border:1px solid rgba(155,141,255,.3);color:var(--lav);font:600 11.5px/1 'DM Sans',sans-serif;letter-spacing:.08em;cursor:pointer;transition:all .2s;margin-bottom:14px;display:flex;align-items:center;justify-content:center;gap:8px;}
.m3d-btn:hover{background:rgba(155,141,255,.22);color:#fff;}

/* scores */
.scores{margin-bottom:22px;}
.scores-ttl{font-size:9px;font-weight:700;letter-spacing:.28em;text-transform:uppercase;color:var(--muted);margin-bottom:12px;}
.sbar{margin-bottom:9px;}
.sbar-head{display:flex;justify-content:space-between;margin-bottom:4px;}
.sbar-lbl{font-size:11px;color:var(--muted);}
.sbar-val{font-size:11px;font-weight:600;color:var(--gold2);}
.sbar-track{height:3.5px;border-radius:100px;background:var(--rim);overflow:hidden;}
.sbar-fill{height:100%;border-radius:100px;background:linear-gradient(90deg,var(--gold) 0%,var(--gold2) 100%);animation:grow .9s var(--ease) both;transform-origin:left;}
@keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}

/* sizes */
.szs{margin-bottom:22px;}
.szs-ttl{font-size:9px;font-weight:700;letter-spacing:.28em;text-transform:uppercase;color:var(--muted);margin-bottom:10px;}
.sz-chips{display:flex;gap:7px;flex-wrap:wrap;}
.sz{min-width:40px;height:36px;border-radius:8px;border:1px solid var(--bdr);background:none;color:var(--muted);font:12px/1 'DM Sans',sans-serif;cursor:pointer;transition:all .2s;padding:0 10px;display:flex;align-items:center;justify-content:center;}
.sz:hover{border-color:var(--bdr2);color:var(--ink);}
.sz.on{background:var(--gd);border-color:var(--bdrg);color:var(--gold2);font-weight:600;}

/* colors */
.colors{margin-bottom:20px;}
.colors-ttl{font-size:9px;font-weight:700;letter-spacing:.28em;text-transform:uppercase;color:var(--muted);margin-bottom:10px;}
.col-chips{display:flex;gap:8px;flex-wrap:wrap;}
.col-chip{padding:5px 12px;border-radius:100px;border:1px solid var(--bdr);background:none;color:var(--muted);font:11px 'DM Sans',sans-serif;cursor:pointer;transition:all .2s;}
.col-chip.on{border-color:var(--bdrg);color:var(--gold2);background:var(--gd);}

/* modal btns */
.mbtns{display:flex;gap:9px;margin-bottom:24px;}
.mbtn{flex:1;padding:12px;border-radius:10px;font:600 11.5px/1 'DM Sans',sans-serif;letter-spacing:.06em;cursor:pointer;transition:all .22s;display:flex;align-items:center;justify-content:center;gap:7px;border:1px solid transparent;}
.mbtn-p{background:linear-gradient(135deg,var(--gold) 0%,var(--gold2) 100%);color:var(--void);border-color:var(--gold);}
.mbtn-p:hover{opacity:.84;transform:translateY(-1px);}
.mbtn-g{background:var(--lift);color:var(--ink);border-color:var(--bdr);}
.mbtn-g:hover{border-color:var(--bdrg);}
.mbtn-g.wl{color:var(--rose);border-color:rgba(232,80,128,.38);background:rgba(232,80,128,.07);}
.mbtn-g.sh{color:var(--cyan);border-color:rgba(63,232,216,.28);background:rgba(63,232,216,.05);}

/* tags */
.mtags{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:24px;}
.mtag{font-size:10px;padding:5px 12px;border-radius:100px;background:var(--lift);border:1px solid var(--bdr);color:var(--muted);letter-spacing:.04em;}

/* variants */
.var-section{margin-bottom:20px;}
.var-ttl{font-size:9px;font-weight:700;letter-spacing:.28em;text-transform:uppercase;color:var(--muted);margin-bottom:8px;}
.var-row{display:flex;gap:8px;flex-wrap:wrap;}
.var-chip{padding:5px 12px;border-radius:8px;border:1px solid var(--bdr);color:var(--muted);font:11px 'DM Sans',sans-serif;background:none;}

/* reviews */
.rev-ttl{font-size:9px;font-weight:700;letter-spacing:.28em;text-transform:uppercase;color:var(--muted);margin-bottom:12px;}
.rev{padding:15px;border-radius:10px;background:var(--surface);border:1px solid var(--bdr);margin-bottom:9px;}
.rev-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;}
.rev-who{font-size:12px;font-weight:600;color:var(--ink);}
.rev-stars{color:var(--gold);font-size:11px;letter-spacing:-1px;}
.rev-date{font-size:10px;color:var(--muted);margin-top:2px;}
.rev-txt{font-size:12px;color:var(--muted);line-height:1.68;}

/* TOAST */
.toast{position:fixed;bottom:110px;left:50%;transform:translateX(-50%);z-index:500;background:var(--lift);border:1px solid var(--bdrg);color:var(--gold2);font-size:12px;padding:10px 24px;border-radius:100px;box-shadow:0 8px 32px rgba(0,0,0,.65);animation:tIn .3s var(--spring),tOut .3s var(--ease) 2.5s both;white-space:nowrap;pointer-events:none;}
@keyframes tIn{from{opacity:0;transform:translateX(-50%) translateY(20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
@keyframes tOut{to{opacity:0}}

/* SHARE PANEL */
.share-panel{position:fixed;bottom:0;left:50%;transform:translateX(-50%);z-index:400;width:min(420px,95vw);background:var(--abyss);border:1px solid var(--bdrg);border-bottom:none;border-radius:20px 20px 0 0;padding:24px;animation:slideUp .3s var(--spring);box-shadow:0 -8px 40px rgba(0,0,0,.7);}
@keyframes slideUp{from{transform:translateX(-50%) translateY(100%)}to{transform:translateX(-50%) translateY(0)}}
.sp-title{font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:600;margin-bottom:16px;color:var(--gold2);}
.sp-url{display:flex;gap:8px;margin-bottom:16px;}
.sp-input{flex:1;background:var(--lift);border:1px solid var(--bdr);border-radius:8px;padding:9px 12px;color:var(--ink);font-size:11px;font-family:inherit;outline:none;}
.sp-copy{padding:9px 16px;border-radius:8px;background:var(--gd);border:1px solid var(--bdrg);color:var(--gold2);font:600 11px 'DM Sans',sans-serif;cursor:pointer;white-space:nowrap;}
.sp-close{position:absolute;top:16px;right:16px;background:none;border:1px solid var(--bdr);color:var(--muted);width:28px;height:28px;border-radius:7px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;}
.sp-btns{display:flex;gap:10px;}
.sp-btn{flex:1;padding:11px;border-radius:9px;background:var(--lift);border:1px solid var(--bdr);color:var(--sub);font:12px 'DM Sans',sans-serif;cursor:pointer;transition:all .2s;text-align:center;}
.sp-btn:hover{border-color:var(--bdrg);color:var(--ink);}

/* FAB */
.fab{position:fixed;bottom:36px;right:36px;z-index:100;width:58px;height:58px;border-radius:16px;background:linear-gradient(135deg,var(--gold) 0%,var(--gold2) 100%);border:none;color:var(--void);font-size:23px;cursor:pointer;box-shadow:0 8px 32px var(--gg);display:flex;align-items:center;justify-content:center;transition:transform .2s var(--spring),box-shadow .2s;}
.fab:hover{transform:scale(1.09);box-shadow:0 14px 50px var(--gg);}
.fab-badge{position:absolute;top:-5px;right:-5px;width:20px;height:20px;border-radius:50%;background:var(--rose);color:#fff;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid var(--void);}

@media(max-width:900px){
  .hero,.bar,.content{padding-left:20px;padding-right:20px;}
  .modal{flex-direction:column;}
  .mgallery{width:100%;height:280px;}
}
`;

/* ─── SCORE RING ──────────────────────────────────────────────────────────── */
function ScoreRing({ pct }) {
  const r = 14,
    circ = 2 * Math.PI * r,
    dash = (pct / 100) * circ;
  return (
    <svg viewBox="0 0 36 36">
      <circle className="s-track" cx="18" cy="18" r={r} />
      <circle
        className="s-ring"
        cx="18"
        cy="18"
        r={r}
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeDashoffset={circ * 0.25}
      />
      <text className="s-txt" x="18" y="18">
        {pct}
      </text>
    </svg>
  );
}

/* ─── SMART IMAGE ─────────────────────────────────────────────────────────── */
function SImg({ src, fallback, alt, className, style }) {
  const [cur, set] = useState(src);
  const tried = useRef(false);
  useEffect(() => {
    set(src);
    tried.current = false;
  }, [src]);
  return (
    <img
      src={cur}
      alt={alt || ""}
      className={className}
      style={style}
      onError={() => {
        if (!tried.current && fallback && cur !== fallback) {
          tried.current = true;
          set(fallback);
        }
      }}
    />
  );
}

/* ─── SHARE PANEL ─────────────────────────────────────────────────────────── */
function SharePanel({ item, onClose, showToast }) {
  const url = `${window.location.origin}?item=${item._id}`;
  const copy = () => {
    navigator.clipboard?.writeText(url).catch(() => {});
    showToast("Link copied! 🔗");
    onClose();
  };
  return (
    <div className="share-panel">
      <button className="sp-close" onClick={onClose}>
        ✕
      </button>
      <div className="sp-title">Share "{item._name}"</div>
      <div className="sp-url">
        <input className="sp-input" readOnly value={url} />
        <button className="sp-copy" onClick={copy}>
          Copy
        </button>
      </div>
      <div className="sp-btns">
        {[
          ["🐦 Twitter", "https://twitter.com/share?url=" + url],
          ["💼 LinkedIn", "https://linkedin.com/share?url=" + url],
          ["📱 WhatsApp", "https://wa.me/?text=" + url],
        ].map(([lbl, href]) => (
          <a
            key={lbl}
            className="sp-btn"
            href={href}
            target="_blank"
            rel="noreferrer"
            onClick={onClose}
          >
            {lbl}
          </a>
        ))}
      </div>
    </div>
  );
}

/* ─── CARD ────────────────────────────────────────────────────────────────── */
function Card({
  item,
  onOpen,
  onWishlist,
  onLike,
  onShare,
  onBag,
  on3D,
  wishlisted,
  liked,
  inBag,
}) {
  const [flipped, setFlipped] = useState(false);
  const [viewIdx, setViewIdx] = useState(0);
  const wrapRef = useRef(null);
  const id = item._id;

  const views = [
    { label: "Front", icon: "◈", url: item._imgs.front },
    { label: "Back", icon: "◉", url: item._imgs.back },
    { label: "Side", icon: "◍", url: item._imgs.side },
  ];
  const fallback = (idx) => stableImg(id, item.category || "", idx);

  const onMouseMove = useCallback(
    (e) => {
      if (flipped) return;
      const el = wrapRef.current;
      if (!el) return;
      const rc = el.getBoundingClientRect();
      const x = ((e.clientX - rc.left) / rc.width - 0.5) * 16;
      const y = ((e.clientY - rc.top) / rc.height - 0.5) * -16;
      const card = el.querySelector(".card");
      if (card) {
        card.style.transform = `rotateY(${x}deg) rotateX(${y}deg) scale(1.015)`;
      }
    },
    [flipped],
  );
  const onMouseLeave = useCallback(() => {
    const c = wrapRef.current?.querySelector(".card");
    if (c) c.style.transform = "";
  }, []);

  return (
    <div
      className="cw"
      ref={wrapRef}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      <div className={`card${flipped ? " flipped" : ""}`}>
        {/* FRONT */}
        <div className="face" onClick={() => onOpen(item)}>
          <div className="cimg">
            <SImg
              src={views[viewIdx].url}
              fallback={fallback(viewIdx)}
              alt={item._name}
            />
            <div className="holo" />
            {item.is_new && <div className="badge-new">New</div>}
            <div className="score-wrap">
              <ScoreRing pct={item._score} />
            </div>
            {/* 3D badge */}
            <div
              className="badge-3d"
              onClick={(e) => {
                e.stopPropagation();
                on3D(item);
              }}
            >
              ⬡ 3D View
            </div>
            <div className="actions" onClick={(e) => e.stopPropagation()}>
              <button
                className={`act${wishlisted ? " wl" : ""}`}
                onClick={() => onWishlist(id)}
                title="Wishlist"
              >
                {wishlisted ? "♥" : "♡"}
              </button>
              <button
                className={`act${liked ? " lk" : ""}`}
                onClick={() => onLike(id)}
                title="Like"
              >
                {liked ? "★" : "☆"}
              </button>
              <button
                className="act sh"
                onClick={(e) => {
                  e.stopPropagation();
                  onShare(item);
                }}
                title="Share"
              >
                ⤢
              </button>
              <button
                className="act"
                onClick={(e) => {
                  e.stopPropagation();
                  setFlipped((f) => !f);
                }}
                title="Flip card"
              >
                ⟳
              </button>
            </div>
            <div className="vdots" onClick={(e) => e.stopPropagation()}>
              {views.map((v, i) => (
                <div
                  key={i}
                  className={`vd${viewIdx === i ? " on" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setViewIdx(i);
                  }}
                  title={v.label}
                >
                  {v.icon}
                </div>
              ))}
            </div>
          </div>
          <div className="cbody">
            <div className="cbrand">
              {item.brand || item.category || "HueIQ"}
            </div>
            <div className="ctitle">{item._name}</div>
            <div className="crow">
              <span className="cprice">
                {item.currency || "$"}
                {item._price || "—"}
                {item._orig && (
                  <s>
                    &nbsp;{item.currency || "$"}
                    {item._orig}
                  </s>
                )}
              </span>
              <span className="cstars">
                {"★".repeat(item._stars)}
                {"☆".repeat(5 - item._stars)}
              </span>
            </div>
            {item.recommendation_reason && (
              <div className="creason">✦ {item.recommendation_reason}</div>
            )}
          </div>
          {/* BOTTOM ACTION BAR — always visible */}
          <div className="cbar" onClick={(e) => e.stopPropagation()}>
            <button
              className={`cbar-btn wl${wishlisted ? " wl" : ""}`}
              onClick={() => onWishlist(id)}
            >
              {wishlisted ? "♥" : "♡"} Save
            </button>
            <button
              className={`cbar-btn lk${liked ? " lk" : ""}`}
              onClick={() => onLike(id)}
            >
              {liked ? "★" : "☆"} Like
            </button>
            <button className="cbar-btn sh" onClick={() => onShare(item)}>
              ⤢ Share
            </button>
            <button
              className="cbar-btn"
              onClick={(e) => {
                e.stopPropagation();
                onBag(item);
              }}
            >
              🛍 Bag
            </button>
          </div>
        </div>

        {/* BACK */}
        <div className="face face-back">
          <div className="cimg">
            <SImg
              src={item._imgs.back}
              fallback={fallback(1)}
              alt="back view"
            />
          </div>
          <div className="bpad">
            <div className="bname">{item._name}</div>
            <div className="bln">
              <strong>Category:</strong> {item.category || "Fashion"}
            </div>
            {item.brand && (
              <div className="bln">
                <strong>Brand:</strong> {item.brand}
              </div>
            )}
            <div className="bln">
              <strong>Rating:</strong>{" "}
              {item.rating ? `${item.rating}/5` : "4.8/5"}
            </div>
            {item.available_sizes?.length > 0 && (
              <div className="bln">
                <strong>Sizes:</strong> {item.available_sizes.join(", ")}
              </div>
            )}
            <div className="btags">
              {item._tags.slice(0, 5).map((t, i) => (
                <span key={i} className="btag">
                  {t}
                </span>
              ))}
            </div>
            <button
              className="bbtn"
              onClick={(e) => {
                e.stopPropagation();
                onBag(item);
              }}
            >
              {inBag ? "✓ In Bag" : "+ Add to Bag"}
            </button>
            <button
              className="bflip"
              onClick={(e) => {
                e.stopPropagation();
                setFlipped(false);
              }}
            >
              ← Front View
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── MODAL ───────────────────────────────────────────────────────────────── */
function Modal({
  item,
  onClose,
  onWishlist,
  onLike,
  onBag,
  onShare,
  on3D,
  wishlisted,
  liked,
  inBag,
}) {
  const [viewIdx, setViewIdx] = useState(0);
  const [selSz, setSelSz] = useState("");
  const [selCol, setSelCol] = useState("");
  const id = item._id;
  const reviews = useMemo(() => seedReviews(id), [id]);
  const breakdown = item.score_breakdown || {};
  const scoreFields = [
    ["Style Match", Math.round(item._score)],
    ["Collaborative", Math.round((breakdown.collaborative || 0) * 100)],
    ["Content", Math.round((breakdown.content || 0) * 100)],
    ["Fit Score", Math.round((breakdown.fit || 0) * 100)],
    ["Seasonal", Math.round((breakdown.seasonal || 0) * 100)],
    ["Trending", Math.round((breakdown.trending || 0) * 100)],
  ];

  const views = [
    { label: "Front", url: item._imgs.front },
    { label: "Back", url: item._imgs.back },
    { label: "Side", url: item._imgs.side },
  ];
  const fallback = (idx) => stableImg(id, item.category || "", idx);
  const sizes = item.available_sizes?.length
    ? item.available_sizes
    : ["XS", "S", "M", "L", "XL", "XXL"];
  const colors = item.available_colors?.length ? item.available_colors : [];
  const variants = item.variants || [];

  useEffect(() => {
    const fn = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);

  return (
    <div className="mbg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="mclose" onClick={onClose}>
          ✕
        </button>
        {/* GALLERY */}
        <div className="mgallery">
          <div className="mmain">
            <SImg
              src={views[viewIdx].url}
              fallback={fallback(viewIdx)}
              alt={item._name}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </div>
          <div className="mthumbs">
            {views.map((v, i) => (
              <div
                key={i}
                className={`mthumb${viewIdx === i ? " on" : ""}`}
                onClick={() => setViewIdx(i)}
              >
                <SImg src={v.url} fallback={fallback(i)} alt={v.label} />
                <div className="mthumb-lbl">{v.label}</div>
              </div>
            ))}
          </div>
        </div>
        {/* BODY */}
        <div className="mbody">
          <div className="mbrand">
            {item.brand || item.category || "HueIQ Curated"}
          </div>
          <div className="mtitle">{item._name}</div>
          <div className="mpricerow">
            <span className="mprice">
              {item.currency || "$"}
              {item._price || "—"}
            </span>
            {item._orig && (
              <span className="moprice">
                {item.currency || "$"}
                {item._orig}
              </span>
            )}
            {item.discount_percent && (
              <span
                style={{ fontSize: 11, color: "var(--rose)", fontWeight: 600 }}
              >
                −{Math.round(item.discount_percent)}%
              </span>
            )}
          </div>
          {item.recommendation_reason && (
            <div className="mreason">✦ {item.recommendation_reason}</div>
          )}

          {/* 3D BUTTON */}
          <button
            className="m3d-btn"
            onClick={() => {
              onClose();
              setTimeout(() => on3D(item), 50);
            }}
          >
            ⬡ View in 3D — Holographic Preview
          </button>

          {/* AI SCORES */}
          <div className="scores">
            <div className="scores-ttl">AI Match Analysis</div>
            {scoreFields.map(([lbl, val]) => (
              <div key={lbl} className="sbar">
                <div className="sbar-head">
                  <span className="sbar-lbl">{lbl}</span>
                  <span className="sbar-val">{val}%</span>
                </div>
                <div className="sbar-track">
                  <div
                    className="sbar-fill"
                    style={{ width: `${Math.max(val, 4)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* COLORS */}
          {colors.length > 0 && (
            <div className="colors">
              <div className="colors-ttl">Available Colors</div>
              <div className="col-chips">
                {colors.map((c) => (
                  <button
                    key={c}
                    className={`col-chip${selCol === c ? " on" : ""}`}
                    onClick={() => setSelCol(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* SIZES */}
          <div className="szs">
            <div className="szs-ttl">Select Size</div>
            <div className="sz-chips">
              {sizes.map((s) => (
                <button
                  key={s}
                  className={`sz${selSz === s ? " on" : ""}`}
                  onClick={() => setSelSz(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* VARIANTS */}
          {variants.length > 0 && (
            <div className="var-section">
              <div className="var-ttl">Variants ({variants.length})</div>
              <div className="var-row">
                {variants.slice(0, 4).map((v, i) => (
                  <span key={i} className="var-chip">
                    {[v.color, v.size].filter(Boolean).join(" / ")}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ACTIONS */}
          <div className="mbtns">
            <button className="mbtn mbtn-p" onClick={() => onBag(item)}>
              🛍 {inBag ? "In Your Bag" : "Add to Bag"}
            </button>
            <button
              className={`mbtn mbtn-g${wishlisted ? " wl" : ""}`}
              onClick={() => onWishlist(id)}
            >
              {wishlisted ? "♥ Wishlisted" : "♡ Wishlist"}
            </button>
            <button
              className={`mbtn mbtn-g${liked ? " " : ""}`}
              onClick={() => onLike(id)}
            >
              {liked ? "★ Liked" : "☆ Like"}
            </button>
            <button className="mbtn mbtn-g sh" onClick={() => onShare(item)}>
              ⤢ Share
            </button>
          </div>

          {/* TAGS */}
          <div className="mtags">
            {item._tags.map((t, i) => (
              <span key={i} className="mtag">
                {t}
              </span>
            ))}
            {item.knowledge_tags?.map((t, i) => (
              <span
                key={"kg" + i}
                className="mtag"
                style={{ color: "var(--lav)" }}
              >
                ◆ {t}
              </span>
            ))}
          </div>

          {/* DESCRIPTION */}
          {item.description && (
            <div
              style={{
                fontSize: 12.5,
                color: "var(--sub)",
                lineHeight: 1.72,
                marginBottom: 24,
                borderTop: "1px solid var(--bdr)",
                paddingTop: 16,
              }}
            >
              {item.description}
            </div>
          )}

          {/* REVIEWS */}
          <div className="rev-ttl">Customer Reviews</div>
          {reviews.map((rv, i) => (
            <div key={i} className="rev">
              <div className="rev-head">
                <div>
                  <div className="rev-who">{rv.name}</div>
                  <div className="rev-date">{rv.date}</div>
                </div>
                <div className="rev-stars">
                  {"★".repeat(rv.stars)}
                  {"☆".repeat(5 - rv.stars)}
                </div>
              </div>
              <div className="rev-txt">{rv.text}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── MAIN COMPONENT ─────────────────────────────────────────────────────── */
export default function Recommendations({ userEmail }) {
  const email =
    userEmail ||
    (typeof window !== "undefined" && window.__hq_email) ||
    "demo@hueiq.com";

  const [raw, setRaw] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [sortBy, setSortBy] = useState("score");
  const [viewMode, setViewMode] = useState("row");
  const [modal, setModal] = useState(null);
  const [viewer3D, setViewer3D] = useState(null);
  const [shareItem, setShareItem] = useState(null);
  const [bag, setBag] = useState([]);
  const [wishlist, setWishlist] = useState(new Set());
  const [likes, setLikes] = useState(new Set());
  const [toast, setToast] = useState(null);
  const toastRef = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  /* fetch */
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let items = null;

      // 1. Try local engine first
      try {
        const r = await fetch(
          `${LOCAL_API}/api/recommendations/${encodeURIComponent(email)}`,
          {
            signal: AbortSignal.timeout(4000),
          },
        );
        if (r.ok) {
          const j = await r.json();
          const arr =
            j.recommendations || j.items || (Array.isArray(j) ? j : null);
          if (arr?.length) items = arr;
        }
      } catch (_) {}

      // 2. Boss API — personalised
      if (!items) {
        try {
          const r = await fetch(
            `${BOSS_API}/api/recommendations/${encodeURIComponent(email)}`,
            {
              signal: AbortSignal.timeout(10000),
            },
          );
          if (r.ok) {
            const j = await r.json();
            const arr =
              j.recommendations || j.items || (Array.isArray(j) ? j : null);
            if (arr?.length) items = arr;
          }
        } catch (_) {}
      }

      // 3. Trending fallback
      if (!items) {
        const r = await fetch(
          `${BOSS_API}/api/recommendations/trending?limit=40`,
          {
            signal: AbortSignal.timeout(10000),
          },
        );
        if (r.ok) {
          const j = await r.json();
          items = j.recommendations || j.items || (Array.isArray(j) ? j : null);
        }
      }

      if (!items || !Array.isArray(items))
        throw new Error("No recommendations returned from API.");
      setRaw(dedup(items).map(normalise));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [email]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /* interactions */
  const handleWishlist = useCallback(
    (id) => {
      setWishlist((w) => {
        const n = new Set(w);
        if (n.has(id)) {
          n.delete(id);
          showToast("Removed from wishlist");
        } else {
          n.add(id);
          showToast("Added to wishlist ♥");
        }
        return n;
      });
    },
    [showToast],
  );

  const handleLike = useCallback(
    (id) => {
      setLikes((l) => {
        const n = new Set(l);
        if (n.has(id)) {
          n.delete(id);
          showToast("Unliked");
        } else {
          n.add(id);
          showToast("Liked ★");
        }
        return n;
      });
    },
    [showToast],
  );

  const handleBag = useCallback(
    (item) => {
      if (bag.some((b) => b._id === item._id)) {
        showToast("Already in your bag");
        return;
      }
      setBag((b) => [...b, item]);
      showToast("Added to bag 🛍");
    },
    [bag, showToast],
  );

  const handleShare = useCallback((item) => {
    setShareItem(item);
  }, []);

  /* filtering / sorting */
  const categories = useMemo(() => {
    const cats = [...new Set(raw.map((i) => i.category).filter(Boolean))];
    return ["all", ...cats];
  }, [raw]);

  const sorted = useMemo(() => {
    const s = [...raw];
    if (sortBy === "score") s.sort((a, b) => b._score - a._score);
    if (sortBy === "price_lo")
      s.sort((a, b) => (a._price || 0) - (b._price || 0));
    if (sortBy === "price_hi")
      s.sort((a, b) => (b._price || 0) - (a._price || 0));
    if (sortBy === "rating")
      s.sort((a, b) => (b.rating || 4) - (a.rating || 4));
    if (sortBy === "newest")
      s.sort((a, b) => (b.is_new ? 1 : 0) - (a.is_new ? 1 : 0));
    return s;
  }, [raw, sortBy]);

  const filtered = useMemo(
    () =>
      filter === "all" ? sorted : sorted.filter((i) => i.category === filter),
    [sorted, filter],
  );

  const heroItems = useMemo(() => sorted.slice(0, 24), [sorted]);
  const byCategory = useMemo(() => {
    const heroSet = new Set(heroItems.map((i) => i._id));
    const m = {};
    sorted.forEach((i) => {
      if (heroSet.has(i._id)) return;
      const c = i.category || "Other";
      if (!m[c]) m[c] = [];
      m[c].push(i);
    });
    return m;
  }, [sorted, heroItems]);

  const avgScore = useMemo(
    () =>
      raw.length
        ? Math.round(raw.reduce((a, i) => a + i._score, 0) / raw.length)
        : 0,
    [raw],
  );

  const cp = (it) => ({
    item: it,
    onOpen: setModal,
    onWishlist: handleWishlist,
    onLike: handleLike,
    onShare: handleShare,
    onBag: handleBag,
    on3D: setViewer3D,
    wishlisted: wishlist.has(it._id),
    liked: likes.has(it._id),
    inBag: bag.some((b) => b._id === it._id),
  });

  const Skels = ({ n = 8 }) =>
    Array.from({ length: n }, (_, i) => (
      <div className="skel" key={i}>
        <div className="si" />
        <div className="sb">
          <div className="sl" style={{ width: "60%" }} />
          <div className="sl" style={{ width: "85%" }} />
          <div className="sl" style={{ width: "40%" }} />
        </div>
      </div>
    ));

  return (
    <div className="hq">
      <style>{CSS}</style>
      <div className="amb">
        <div className="blob b1" />
        <div className="blob b2" />
        <div className="blob b3" />
      </div>
      <div className="noise" />

      {/* HERO */}
      <div className="hero">
        <div className="hero-tag">
          <div className="hero-dot" /> AI-Powered Recommendations · Real-Time
        </div>
        <div className="hero-h">
          Your <em>curated</em>
          <br />
          <strong>wardrobe</strong> awaits
        </div>
        <div className="hero-stats">
          {[
            ["Pieces Found", raw.length],
            ["Avg Match", `${avgScore}%`],
            ["Wishlisted", wishlist.size],
            ["In Bag", bag.length],
            ["Liked", likes.size],
          ].map(([lbl, val], i, arr) => (
            <React.Fragment key={lbl}>
              <div className="hstat">
                <span className="hnum">{val}</span>
                <span className="hlbl">{lbl}</span>
              </div>
              {i < arr.length - 1 && <div className="hsep" />}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* TOOLBAR */}
      <div className="bar">
        <div className="tabs">
          {categories.map((c) => (
            <button
              key={c}
              className={`tab${filter === c ? " on" : ""}`}
              onClick={() => setFilter(c)}
            >
              {c === "all" ? "All" : c}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <select
          className="sort"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
        >
          <option value="score">Best Match</option>
          <option value="rating">Top Rated</option>
          <option value="price_lo">Price ↑</option>
          <option value="price_hi">Price ↓</option>
          <option value="newest">Newest</option>
        </select>
        <div className="vtgl">
          <button
            className={`vb${viewMode === "row" ? " on" : ""}`}
            onClick={() => setViewMode("row")}
          >
            ⠿
          </button>
          <button
            className={`vb${viewMode === "grid" ? " on" : ""}`}
            onClick={() => setViewMode("grid")}
          >
            ⊞
          </button>
        </div>
      </div>

      {/* CONTENT */}
      <div className="content">
        {loading ? (
          <div className="section">
            <div className="row">
              <Skels />
            </div>
          </div>
        ) : error ? (
          <div className="errbox">
            <div className="erricon">✦</div>
            <div
              style={{
                fontSize: 13,
                color: "var(--muted)",
                lineHeight: 1.65,
                maxWidth: 340,
                textAlign: "center",
              }}
            >
              Could not load recommendations.
              <br />
              {error}
            </div>
            <button className="retry" onClick={fetchData}>
              Try Again
            </button>
          </div>
        ) : viewMode === "grid" ? (
          <div className="section">
            <div className="sec-head">
              <span className="sec-title">All Recommendations</span>
              <span className="sec-count">{filtered.length} pieces</span>
            </div>
            <div className="grid">
              {filtered.length === 0 && (
                <div
                  style={{
                    gridColumn: "1/-1",
                    padding: "60px 40px",
                    textAlign: "center",
                    color: "var(--muted)",
                  }}
                >
                  No items in this category.
                </div>
              )}
              {filtered.map((it) => (
                <Card key={it._id} {...cp(it)} />
              ))}
            </div>
          </div>
        ) : filter !== "all" ? (
          <div className="section">
            <div className="sec-head">
              <span className="sec-title">{filter}</span>
              <span className="sec-count">{filtered.length} pieces</span>
            </div>
            <div className="row">
              {filtered.map((it) => (
                <Card key={it._id} {...cp(it)} />
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="section">
              <div className="sec-head">
                <span className="sec-title">Top Picks For You</span>
                <span className="sec-count">{heroItems.length} pieces</span>
                <span className="sec-badge">AI Curated</span>
              </div>
              <div className="row">
                {heroItems.map((it) => (
                  <Card key={it._id} {...cp(it)} />
                ))}
              </div>
            </div>
            {Object.entries(byCategory).map(([cat, items]) => (
              <div className="section" key={cat}>
                <div className="sec-head">
                  <span className="sec-title">{cat}</span>
                  <span className="sec-count">{items.length} pieces</span>
                </div>
                <div className="row">
                  {items.map((it) => (
                    <Card key={it._id} {...cp(it)} />
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* MODAL */}
      {modal && (
        <Modal
          item={modal}
          onClose={() => setModal(null)}
          onWishlist={handleWishlist}
          onLike={handleLike}
          onBag={handleBag}
          onShare={handleShare}
          on3D={setViewer3D}
          wishlisted={wishlist.has(modal._id)}
          liked={likes.has(modal._id)}
          inBag={bag.some((b) => b._id === modal._id)}
        />
      )}

      {/* 3D VIEWER */}
      {viewer3D && (
        <Viewer3D item={viewer3D} onClose={() => setViewer3D(null)} />
      )}

      {/* SHARE PANEL */}
      {shareItem && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 399 }}
            onClick={() => setShareItem(null)}
          />
          <SharePanel
            item={shareItem}
            onClose={() => setShareItem(null)}
            showToast={showToast}
          />
        </>
      )}

      {/* TOAST */}
      {toast && (
        <div key={toast} className="toast">
          {toast}
        </div>
      )}

      {/* FAB */}
      <button
        className="fab"
        onClick={() =>
          showToast(
            `${bag.length} item${bag.length !== 1 ? "s" : ""} in your bag`,
          )
        }
      >
        🛍
        {bag.length > 0 && <div className="fab-badge">{bag.length}</div>}
      </button>
    </div>
  );
}
