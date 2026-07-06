import { Capacitor } from "@capacitor/core";

export const isNativePlatform = (): boolean => Capacitor.isNativePlatform();

export const isAndroidPlatform = (): boolean => Capacitor.getPlatform() === "android";

export const platformLabel = (): "android" | "ios" | "web" => Capacitor.getPlatform() as "android" | "ios" | "web";
