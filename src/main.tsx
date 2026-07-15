import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { getStoredThemeMode, syncThemeToDocument } from "./theme";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "./shared/styles/app-drag-region.css";
syncThemeToDocument(getStoredThemeMode("dark"));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
