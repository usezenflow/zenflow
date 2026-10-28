import { decideConsent, disconnectApp, getConsent, listConnectedApps } from "@/api/oauth";
import { ErrorMark } from "@/components/brand/state-marks";
import { Link2 } from "@/components/Icons";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetInput,
  BottomSheetView,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { DelayedSpinner } from "@/components/ui/delayed-spinner";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import type { ConnectedApp, OAuthConsentInfo } from "@zenflow/shared";
import { isAxiosError } from "axios";
import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Step =
  | { kind: "enter" }
  | { kind: "ask"; info: OAuthConsentInfo }
  | { kind: "done"; approved: boolean }
  | { kind: "failed"; message: string };

const CODE_LENGTH = 8;
const clean = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const message = (error: unknown) =>
  t(isAxiosError(error) && error.response?.data?.message ? error.response.data.message : "Couldn't connect. Try again.");

/**
 * Approves an AI assistant from the phone. The assistant's browser page shows
 * a code (or links here with it); the user types it, sees who is asking, and
 * allows or refuses. The browser page moves on by itself.
 */
export function AssistantConnect({ initialCode }: { initialCode?: string }) {
  useLanguage();
  const { toast } = useToast();
  const insets = useSafeAreaInsets();
  const sheet = useBottomSheet();
  const [apps, setApps] = useState<ConnectedApp[]>([]);
  const [step, setStep] = useState<Step>({ kind: "enter" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listConnectedApps().then((r) => setApps(r.apps), () => undefined);
  }, []);
  useEffect(load, [load]);

  const open = useCallback(
    (prefill = "") => {
      setCode(clean(prefill).slice(0, CODE_LENGTH));
      setStep({ kind: "enter" });
      sheet.open();
    },
    [sheet],
  );
  useEffect(() => {
    if (initialCode) open(initialCode);
    // Only the link that opened the screen prefills; later edits are the user's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

  async function run(work: () => Promise<Step>) {
    setBusy(true);
    try {
      setStep(await work());
    } catch (error) {
      setStep({ kind: "failed", message: message(error) });
    } finally {
      setBusy(false);
    }
  }

  const look = () => run(async () => ({ kind: "ask", info: await getConsent(code) }));
  const decide = (approve: boolean) =>
    run(async () => {
      await decideConsent(code, approve);
      load();
      return { kind: "done", approved: approve };
    });

  async function disconnect(app: ConnectedApp) {
    try {
      setApps((await disconnectApp(app.clientId)).apps);
    } catch {
      toast({ title: t("Couldn't disconnect"), variant: "destructive", icon: Link2 });
    }
  }

  return (
    <>
      <Pressable
        testID="assistants.connect"
        onPress={() => open()}
        accessibilityRole="button"
        className="flex-row items-center gap-[13px] px-4 py-3.5 active:opacity-70"
      >
        <View className="h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-muted">
          <Link2 size={18} className="text-foreground" />
        </View>
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-[16px] font-semibold">{t("Connect an assistant")}</Text>
          <Text className="text-[13px] leading-[18px] text-muted-foreground">
            {t("Enter the code your assistant shows.")}
          </Text>
        </View>
      </Pressable>
      {apps.map((app) => (
        <View key={app.clientId} className="flex-row items-center gap-2 border-t border-border px-4 py-2.5">
          <Text numberOfLines={1} className="min-w-0 flex-1 text-[15px]">
            {app.name}
          </Text>
          <Pressable
            testID={`assistants.disconnect.${app.clientId}`}
            onPress={() => void disconnect(app)}
            accessibilityRole="button"
            className="min-h-11 justify-center px-2 active:opacity-70"
          >
            <Text className="text-[14px] font-semibold text-destructive">{t("Disconnect")}</Text>
          </Pressable>
        </View>
      ))}

      <BottomSheet>
        <BottomSheetContent ref={sheet.ref}>
          <BottomSheetView hadHeader={false} style={{ paddingBottom: insets.bottom + 32 }}>
            {step.kind === "enter" ? (
              <>
                <View className="pb-3 pt-1">
                  <Text className="text-xl font-bold tracking-tight">{t("Connect an assistant")}</Text>
                </View>
                <Text className="mb-4 text-[13.5px] leading-relaxed text-muted-foreground">
                  {t("Enter the code your assistant shows.")}
                </Text>
                <BottomSheetInput
                  testID="assistants.code"
                  value={code}
                  onChangeText={(v: string) => setCode(clean(v).slice(0, CODE_LENGTH))}
                  placeholder="ABCD2345"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  editable={!busy}
                  className="mb-5 text-center font-mono text-[22px] tracking-widest"
                />
                <Button
                  testID="assistants.look"
                  className="h-[52px] w-full rounded-full"
                  disabled={code.length !== CODE_LENGTH || busy}
                  onPress={() => void look()}
                >
                  <DelayedSpinner busy={busy} size={18} tone="onPrimary" wrapperClassName="mr-2" />
                  <Text className="font-semibold text-primary-foreground">{t("Continue")}</Text>
                </Button>
              </>
            ) : null}

            {step.kind === "ask" ? (
              <>
                <View className="pb-3 pt-1">
                  <Text className="text-xl font-bold tracking-tight">
                    {t("Allow {name}?", { name: step.info.clientName })}
                  </Text>
                </View>
                <Text className="text-[13.5px] leading-relaxed text-muted-foreground">
                  {t("It can read your calendar and add or change your tasks.")}
                </Text>
                <Text className="mb-5 mt-1.5 text-[13px] text-muted-foreground">
                  {t("You will be sent back to {host}.", { host: step.info.redirectHost })}
                </Text>
                <View className="flex-row gap-2.5">
                  <Button
                    variant="outline"
                    testID="assistants.deny"
                    className="h-[52px] flex-1 rounded-full"
                    disabled={busy}
                    onPress={() => void decide(false)}
                  >
                    <Text className="font-semibold text-foreground">{t("Cancel")}</Text>
                  </Button>
                  <Button
                    testID="assistants.allow"
                    className="h-[52px] flex-1 rounded-full"
                    disabled={busy}
                    onPress={() => void decide(true)}
                  >
                    <DelayedSpinner busy={busy} size={18} tone="onPrimary" wrapperClassName="mr-2" />
                    <Text className="font-semibold text-primary-foreground">{t("Allow")}</Text>
                  </Button>
                </View>
              </>
            ) : null}

            {step.kind === "done" ? (
              <View className="items-center gap-3 pb-2 pt-4">
                <Text className="text-xl font-bold tracking-tight">
                  {step.approved ? t("Connected") : t("Cancelled")}
                </Text>
                <Text className="text-center text-[13.5px] text-muted-foreground">
                  {t("Return to your assistant.")}
                </Text>
                <Button className="mt-2 h-[52px] w-full rounded-full" onPress={() => sheet.close()}>
                  <Text className="font-semibold text-primary-foreground">{t("Done")}</Text>
                </Button>
              </View>
            ) : null}

            {step.kind === "failed" ? (
              <View className="items-center gap-3 pb-2 pt-4">
                <ErrorMark />
                <Text testID="assistants.error" className="text-center text-[14px] leading-5 text-muted-foreground">
                  {step.message}
                </Text>
                <Button
                  variant="outline"
                  className="mt-2 h-[52px] w-full rounded-full"
                  onPress={() => setStep({ kind: "enter" })}
                >
                  <Text className="font-semibold text-foreground">{t("Try again")}</Text>
                </Button>
              </View>
            ) : null}
          </BottomSheetView>
        </BottomSheetContent>
      </BottomSheet>
    </>
  );
}
