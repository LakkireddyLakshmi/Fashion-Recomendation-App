import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";

const API = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

export const loadWishlist = createAsyncThunk("wishlist/load", async (email) => {
  const r = await fetch(`${API}/api/user/${encodeURIComponent(email)}/wishlist`);
  if (r.ok) { const d = await r.json(); return d.items || []; }
  return [];
});

export const syncWishlistToggle = createAsyncThunk("wishlist/syncToggle", async ({ email, itemId }) => {
  await fetch(`${API}/api/user/${encodeURIComponent(email)}/wishlist`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_id: itemId, action: "toggle" }),
  }).catch(() => {});
});

const wishlistSlice = createSlice({
  name: "wishlist",
  initialState: {
    items: [],       // array of catalog_item_ids
    isOpen: false,
  },
  reducers: {
    toggleWishlistItem(state, action) {
      const id = action.payload;
      const idx = state.items.indexOf(id);
      if (idx >= 0) state.items.splice(idx, 1);
      else state.items.push(id);
    },
    setWishlistOpen(state, action) {
      state.isOpen = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(loadWishlist.fulfilled, (state, action) => {
      if (action.payload.length) state.items = action.payload;
    });
  },
});

export const { toggleWishlistItem, setWishlistOpen } = wishlistSlice.actions;

// Selector: check if item is in wishlist
export const selectIsWishlisted = (state, itemId) => state.wishlist.items.includes(itemId);

export default wishlistSlice.reducer;
