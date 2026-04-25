import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// Self-hosted fonts (see fonts.css for the rationale on font-display
// per family). Order matters: fonts must be declared before index.css
// so the cascade resolves them on the first style application.
import "./fonts.css";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
