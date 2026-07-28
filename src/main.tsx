import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app.component";
import { getStoredThemeMode, syncThemeToDocument } from "./theme";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/inter/latin-ext-700.css";
import "@fontsource/inter/latin-800.css";
import "@fontsource/inter/latin-ext-800.css";
import "@fontsource/barlow-condensed/latin-900.css";
import "@fontsource/barlow-condensed/latin-ext-900.css";
import "@fontsource/anton/latin-400.css";
import "@fontsource/anton/latin-ext-400.css";
import "@fontsource/dancing-script/latin-700.css";
import "@fontsource/dancing-script/latin-ext-700.css";
import "@fontsource/montserrat/latin-900-italic.css";
import "@fontsource/montserrat/latin-ext-900-italic.css";
import "@fontsource/outfit/latin-800.css";
import "@fontsource/outfit/latin-ext-800.css";
import "@fontsource/outfit/latin-900.css";
import "@fontsource/outfit/latin-ext-900.css";
import "@fontsource/poppins/latin-900.css";
import "@fontsource/poppins/latin-ext-900.css";
import "@fontsource/rajdhani/latin-700.css";
import "@fontsource/rajdhani/latin-ext-700.css";
import "./shared/styles/app-drag-region.css";
import { ensureCaptionFontsReady } from "./features/clipper/lib/captions/caption-presets.util";

syncThemeToDocument(getStoredThemeMode("dark"));

const rootElement = document.getElementById("root");
if (!rootElement) {
  const error = new Error("Missing #root element");
  throw error;
}

const reactRoot = ReactDOM.createRoot(rootElement);

void ensureCaptionFontsReady().finally(() => {
  reactRoot.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
