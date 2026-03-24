import { createSlice } from "@reduxjs/toolkit";

const profileSlice = createSlice({
  name: "profile",
  initialState: {
    data: null,        // { gender, age, colors, categories, fit, height, weight, bodyType }
    isComplete: false,
  },
  reducers: {
    setProfile(state, action) {
      state.data = action.payload;
      state.isComplete = true;
    },
    updateProfile(state, action) {
      if (state.data) {
        state.data = { ...state.data, ...action.payload };
      } else {
        state.data = action.payload;
      }
    },
    clearProfile(state) {
      state.data = null;
      state.isComplete = false;
    },
  },
});

export const { setProfile, updateProfile, clearProfile } = profileSlice.actions;
export default profileSlice.reducer;
