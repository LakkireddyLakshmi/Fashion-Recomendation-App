import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";

const API = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

// Async thunks for backend sync
export const loadCart = createAsyncThunk("cart/load", async (email) => {
  const r = await fetch(`${API}/api/user/${encodeURIComponent(email)}/cart`);
  if (r.ok) { const d = await r.json(); return d.items || []; }
  return [];
});

export const syncCartAdd = createAsyncThunk("cart/syncAdd", async ({ email, itemId, size, color }) => {
  await fetch(`${API}/api/user/${encodeURIComponent(email)}/cart`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_id: itemId, action: "add", size, color }),
  }).catch(() => {});
});

export const syncCartRemove = createAsyncThunk("cart/syncRemove", async ({ email, itemId }) => {
  await fetch(`${API}/api/user/${encodeURIComponent(email)}/cart`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_id: itemId, action: "remove" }),
  }).catch(() => {});
});

const cartSlice = createSlice({
  name: "cart",
  initialState: {
    items: [],       // [{ ...product, qty }]
    isOpen: false,
    flash: false,
  },
  reducers: {
    addToCart(state, action) {
      const item = action.payload;
      const id = item.catalog_item_id || item.id;
      const existing = state.items.find(x => (x.catalog_item_id || x.id) === id);
      if (existing) {
        existing.qty = (existing.qty || 1) + 1;
      } else {
        state.items.push({ ...item, qty: 1 });
      }
      state.flash = true;
      state.isOpen = true;
    },
    removeFromCart(state, action) {
      const id = action.payload;
      state.items = state.items.filter(x => (x.catalog_item_id || x.id) !== id);
    },
    updateQty(state, action) {
      const { id, qty } = action.payload;
      const item = state.items.find(x => (x.catalog_item_id || x.id) === id);
      if (item) item.qty = qty;
    },
    clearCart(state) {
      state.items = [];
    },
    setCartOpen(state, action) {
      state.isOpen = action.payload;
    },
    clearFlash(state) {
      state.flash = false;
    },
    setCartItems(state, action) {
      state.items = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(loadCart.fulfilled, (state, action) => {
      if (action.payload.length) state.items = action.payload;
    });
  },
});

export const { addToCart, removeFromCart, updateQty, clearCart, setCartOpen, clearFlash, setCartItems } = cartSlice.actions;
export default cartSlice.reducer;
