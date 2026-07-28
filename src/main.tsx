import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app.component";
import { getStoredThemeMode, syncThemeToDocument } from "./theme";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "./shared/styles/app-drag-region.css";

syncThemeToDocument(getStoredThemeMode("dark"));

const rootElement = document.getElementById("root");
if (!rootElement) {
  const error = new Error("Missing #root element");
  throw error;
}

const reactRoot = ReactDOM.createRoot(rootElement);

reactRoot.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
