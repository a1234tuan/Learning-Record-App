import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

import { App } from "./App";
import { cleanupNativeServiceWorker } from "./lib/nativeServiceWorker";
import { isDesktopPlatform, isNativePlatform } from "./lib/platform";
import { isStage3PreviewRequest, isStage4PreviewRequest, isStage5PreviewRequest, seedStage3Preview, seedStage4Preview, seedStage5Preview } from "./preview/stage3PreviewSeed";
import "./styles.css";
import "./styles/theme.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/pages.css";
import "./styles/motion.css";

const startApplication = async () => {
  if (isStage3PreviewRequest() || isStage4PreviewRequest() || isStage5PreviewRequest()) {
    try {
      if (isStage5PreviewRequest()) await seedStage5Preview();
      else if (isStage4PreviewRequest()) await seedStage4Preview();
      else await seedStage3Preview();
    } catch (error) {
      console.error("Review coach preview data initialization failed", error);
    }
  }
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
