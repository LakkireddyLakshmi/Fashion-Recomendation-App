import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";

const API = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

export const fetchRecommendations = createAsyncThunk(
  "recommendations/fetch",
  async ({ email, token }) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const r = await fetch(`${API}/api/recommendations/${encodeURIComponent(email)}?limit=100`, {
      headers, signal: AbortSignal.timeout(90000),
    });
    if (r.ok) {
      const d = await r.json();
      return d.recommendations || d.items || [];
    }
    // Fallback to trending
    const r2 = await fetch(`${API}/api/recommendations/trending?limit=100`);
    if (r2.ok) {
      const d = await r2.json();
      return d.recommendations || d.items || [];
    }
    return [];
  }
);

const recommendationsSlice = createSlice({
  name: "recommendations",
  initialState: {
    items: [],
    loading: false,
    error: null,
    recentlyViewed: [],
  },
  reducers: {
    setRecommendations(state, action) {
      state.items = action.payload;
    },
    addRecentlyViewed(state, action) {
      const item = action.payload;
      const id = item.catalog_item_id || item.id;
      state.recentlyViewed = [
        item,
        ...state.recentlyViewed.filter(x => (x.catalog_item_id || x.id) !== id),
      ].slice(0, 10);
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchRecommendations.pending, (state) => { state.loading = true; state.error = null; })
      .addCase(fetchRecommendations.fulfilled, (state, action) => { state.items = action.payload; state.loading = false; })
      .addCase(fetchRecommendations.rejected, (state, action) => { state.loading = false; state.error = action.error.message; });
  },
});

export const { setRecommendations, addRecentlyViewed } = recommendationsSlice.actions;
export default recommendationsSlice.reducer;
