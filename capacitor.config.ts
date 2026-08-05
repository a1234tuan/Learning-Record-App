import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.noteproject.study408",
  appName: "学习日志",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  plugins: {
    FirebaseAuthentication: {
      // Cloud sync continues to use the Firebase JavaScript SDK for Firestore.
      skipNativeAuth: true,
      providers: ["google.com"],
    },
  },
};

export default config;
