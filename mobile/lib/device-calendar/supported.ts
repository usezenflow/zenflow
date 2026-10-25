import { Platform } from "react-native";

/** The phone's calendar exists on iOS and Android only. */
export const deviceCalendarSupported = (): boolean => Platform.OS !== "web";
