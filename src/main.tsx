import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

import { App } from "./App";
import "./styles.css";
import "./styles/theme.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/pages.css";
import "./styles/motion.css";

registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
