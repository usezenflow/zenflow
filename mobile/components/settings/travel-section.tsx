import { updateBasicInfo } from "@/api/users";
import { CampusMap } from "@/components/calendar/campus-map";
import { PlacePalette, type Stop } from "@/components/calendar/place-palette";
import { ChevronRight, Home } from "@/components/Icons";
import { OptionSheet, type OptionSheetHandle } from "@/components/settings/option-sheet";
import { SettingsSectionLabel } from "@/components/settings/settings-header";
import { VEHICLE_ICONS } from "@/components/vehicle-icons";
import { NoteScreen } from "@/components/tasks/note/description-field";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { useLanguage } from "@/hooks/use-language";
import { useMyLocationStop } from "@/hooks/use-my-location-stop";
import { useUserStore } from "@/hooks/use-user-store";
import { VEHICLES, vehicleFor } from "@/lib/campus-route";
import { homeStop } from "@/lib/home-stop";
import { t } from "@/lib/i18n";
import { CAMPUS_PLACES } from "@zenflow/core";
import type { CommuteTransport } from "@zenflow/shared";
import { type ComponentType, useRef, useState } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** The campus gate: where the map opens before a home is picked. */
const CAMPUS_CENTER = CAMPUS_PLACES.find((place) => place.kind === "GATE") ?? CAMPUS_PLACES[0];

function Row({
  Icon,
  title,
  value,
  onPress,
  testID,
}: {
  Icon: ComponentType<{ size?: number; className?: string }>;
  title: string;
  value: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable testID={testID} onPress={onPress} className="flex-row items-center gap-[13px] px-4 py-3.5">
      <View className="h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-muted">
        <Icon size={18} className="text-foreground" />
      </View>
      <Text className="text-[16px] font-semibold">{title}</Text>
      <Text numberOfLines={1} className="min-w-0 flex-1 text-right text-[15px] font-medium text-muted-foreground">
        {value}
      </Text>
      <ChevronRight size={18} className="text-muted-foreground" />
    </Pressable>
  );
}

/** Full-screen picker for the place trips to campus start from. */
function HomeScreen({ initial, onClose }: { initial: Stop | null; onClose: (home: Stop | null) => void }) {
  useLanguage();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [home, setHome] = useState<Stop | null>(initial);
  const [searching, setSearching] = useState(false);
  const myLocation = useMyLocationStop();
  const closed = useRef(false);

  // Done closes the screen, and unmounting its sheet then fires the sheet's
  // dismiss handler: only the first close counts.
  const finish = (value: Stop | null) => {
    if (closed.current) return;
    closed.current = true;
    onClose(value);
  };

  const closePalette = () => {
    setSearching(false);
    myLocation.clear();
  };

  return (
    <NoteScreen height={height} onClose={() => finish(initial)}>
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center justify-between px-5 pb-3 pt-2">
          <Text className="text-[19px] font-bold tracking-tight">{t("Home")}</Text>
          <Pressable
            testID="settings.home.done"
            accessibilityRole="button"
            onPress={() => finish(home)}
            className="h-9 items-center justify-center rounded-full bg-primary px-5 active:opacity-80"
          >
            <Text className="text-[14px] font-semibold text-primary-foreground">{t("Done")}</Text>
          </Pressable>
        </View>

        <View className="flex-1 overflow-hidden rounded-t-3xl">
          <View className="absolute inset-0">
            <CampusMap
              fill
              point={home?.point ?? CAMPUS_CENTER}
              name={home?.text ?? ""}
              onPick={(point) => setHome({ text: home?.text.trim() || t("Pinned location"), point })}
            />
          </View>
          <View className="absolute inset-x-5 top-3 overflow-hidden rounded-2xl border border-border bg-card">
            <Pressable
              testID="settings.home.field"
              accessibilityRole="button"
              onPress={() => setSearching(true)}
              className="h-12 flex-row items-center gap-3 px-3 active:bg-muted/60"
            >
              <Home size={18} className="text-primary" />
              <Text numberOfLines={1} className="min-w-0 flex-1 text-[16px]">
                {home?.text || t("Add home")}
              </Text>
            </Pressable>
            {home && (
              <>
                <View className="h-px bg-border" />
                <Pressable
                  testID="settings.home.remove"
                  accessibilityRole="button"
                  onPress={() => setHome(null)}
                  className="h-11 justify-center px-3 active:bg-muted/60"
                >
                  <Text className="text-[15px] font-medium text-destructive">{t("Remove home")}</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>

        {searching && (
          <PlacePalette
            title={t("Home")}
            placeholder={t("Search places")}
            onChoose={(stop) => {
              setHome(stop);
              closePalette();
            }}
            onClose={closePalette}
            onPickOnMap={closePalette}
            onMyLocation={() =>
              void myLocation.locate().then((point) => {
                if (!point) return;
                setHome({ text: t("My location"), point });
                closePalette();
              })
            }
            locating={myLocation.locating}
            locationNote={myLocation.note}
            settingsNeeded={myLocation.settingsNeeded}
          />
        )}
      </View>
    </NoteScreen>
  );
}

/** Where trips start and how the student gets to campus, filled into every session with a place. */
export function TravelSection() {
  useLanguage();
  const user = useUserStore((s) => s.user);
  const { toast } = useToast();
  const [picking, setPicking] = useState(false);
  const vehicleSheet = useRef<OptionSheetHandle>(null);

  const home = homeStop(user);

  const save = async (patch: Parameters<typeof updateBasicInfo>[0]) => {
    try {
      useUserStore.getState().updateUser(await updateBasicInfo(patch));
    } catch {
      toast({ title: t("Could not save. Try again."), variant: "destructive" });
    }
  };

  const saveHome = (next: Stop | null) => {
    setPicking(false);
    if (next?.text === home?.text && next?.point?.lat === home?.point?.lat && next?.point?.lng === home?.point?.lng)
      return;
    void save(
      next?.point
        ? { homeLocation: next.text, homeLat: next.point.lat, homeLng: next.point.lng }
        : { homeLocation: null, homeLat: null, homeLng: null },
    );
  };

  if (!user) return null;
  const vehicle = vehicleFor(user.defaultTransport);

  return (
    <>
      <SettingsSectionLabel>{t("Travel")}</SettingsSectionLabel>
      <View className="overflow-hidden rounded-2xl border border-border bg-card">
        <Row
          testID="settings.home"
          Icon={Home}
          title={t("Home")}
          value={home?.text ?? t("Add home")}
          onPress={() => setPicking(true)}
        />
        <View className="h-px bg-border" />
        <Row
          testID="settings.vehicle"
          Icon={VEHICLE_ICONS[vehicle.id]}
          title={t("Vehicle")}
          value={t(vehicle.labelKey)}
          onPress={() => vehicleSheet.current?.open()}
        />
      </View>
      <OptionSheet
        ref={vehicleSheet}
        title={t("Vehicle")}
        options={VEHICLES.map((item) => ({ value: item.id, label: t(item.labelKey), icon: VEHICLE_ICONS[item.id] }))}
        value={vehicle.id}
        onSelect={(defaultTransport: CommuteTransport) => void save({ defaultTransport })}
      />
      {picking && <HomeScreen initial={home} onClose={saveHome} />}
    </>
  );
}
