import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { runSelfTest } from "./selftest.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("no #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (location.search.includes("selftest")) void runSelfTest();
