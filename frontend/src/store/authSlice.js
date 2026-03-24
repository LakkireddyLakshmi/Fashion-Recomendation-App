import { createSlice } from "@reduxjs/toolkit";

const authSlice = createSlice({
  name: "auth",
  initialState: {
    user: null,        // { email, name, token }
    isLoggedIn: false,
    loading: false,
  },
  reducers: {
    login(state, action) {
      state.user = action.payload;
      state.isLoggedIn = true;
      state.loading = false;
      if (action.payload.token) {
        sessionStorage.setItem("hueiq_token", action.payload.token);
      }
    },
    logout(state) {
      state.user = null;
      state.isLoggedIn = false;
      sessionStorage.removeItem("hueiq_token");
    },
    setLoading(state, action) {
      state.loading = action.payload;
    },
  },
});

export const { login, logout, setLoading } = authSlice.actions;
export default authSlice.reducer;
