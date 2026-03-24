import { configureStore } from "@reduxjs/toolkit";
import { persistStore, persistReducer, FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER } from "redux-persist";
import storage from "redux-persist/lib/storage"; // localStorage
import { combineReducers } from "@reduxjs/toolkit";
import authReducer from "./authSlice";
import profileReducer from "./profileSlice";
import cartReducer from "./cartSlice";
import wishlistReducer from "./wishlistSlice";
import recommendationsReducer from "./recommendationsSlice";

const rootReducer = combineReducers({
  auth: authReducer,
  profile: profileReducer,
  cart: cartReducer,
  wishlist: wishlistReducer,
  recommendations: recommendationsReducer,
});

const persistConfig = {
  key: "hueiq",
  storage,
  whitelist: ["auth", "profile", "cart", "wishlist"], // persist these, NOT recommendations (too large)
};

const persistedReducer = persistReducer(persistConfig, rootReducer);

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
    }),
});

export const persistor = persistStore(store);
