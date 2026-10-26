import { useAppUpdate } from "@/hooks/use-app-update";
import { useLanguage } from "@/hooks/use-language";
import { Stack } from "expo-router";

export default function AppLayout() {
  useLanguage();
  useAppUpdate();
  return <Stack screenOptions={{ headerShown: false }} />;
}
