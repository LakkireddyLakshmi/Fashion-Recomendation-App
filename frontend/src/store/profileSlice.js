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
    clearProfile(state) {
      state.data = null;
      state.isComplete = false;
    },
  },
});

export const { setProfile, clearProfile } = profileSlice.actions;
export default profileSlice.reducer;
