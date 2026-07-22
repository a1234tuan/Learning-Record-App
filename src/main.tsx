import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

import { App } from "./App";
import { cleanupNativeServiceWorker } from "./lib/nativeServiceWorker";
import { isDesktopPlatform, isNativePlatform } from "./lib/platform";
import "./styles.css";
import "./styles/theme.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/pages.css";
import "./styles/motion.css";

const startApplication = async () => {
  if (isNativePlatform()) {
    const shouldReload = await cleanupNativeServiceWorker();
    if (shouldReload) {
      window.location.reload();
      return;
    }
  } else if (!isDesktopPlatform()) {
    registerSW({ immediate: true });
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
};

void startApplication();
