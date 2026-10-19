import { type PlaceResult, searchPlaces } from "@/api/places";
import { ErrorMark, NoResultsMark } from "@/components/brand/state-marks";
import { LocateFixed, MapPin, Search, X, type LucideIcon } from "@/components/Icons";
import { BottomSheetTextInput } from "@/components/ui/bottom-sheet";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import type { MapPoint } from "@/lib/campus-map";
import { t } from "@/lib/i18n";
import { searchCampusPlaces } from "@zenflow/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export interface Stop {
  text: string;
  point: MapPoint | null;
}

const SEARCH_DELAY_MS = 300;
const MIN_REMOTE_QUERY = 3;
const CAMPUS_LIMIT = 4;

function Row({
  label,
  detail,
  onPress,
  testID,
  icon: Icon = MapPin,
}: {
  label: string;
  detail?: string;
  onPress: () => void;
  testID: string;
  icon?: LucideIcon;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="flex-row items-center gap-3 px-5 py-3 active:bg-muted/60"
    >
      <View className="h-9 w-9 items-center justify-center rounded-full bg-muted">
        <Icon size={17} className="text-muted-foreground" />
      </View>
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[15px] font-medium">
          {label}
        </Text>
        {detail ? (
          <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
            {detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <Text className="px-5 pb-1 pt-4 text-[12px] font-semibold text-muted-foreground">{children}</Text>;
}

function SkeletonRows() {
  return (
    <View className="gap-3 px-5 pt-4">
      {[0, 1, 2].map((i) => (
        <View key={i} className="flex-row items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-full bg-muted" />
          <View className="flex-1 gap-2">
            <Skeleton className="h-3.5 w-2/3 rounded bg-muted" />
            <Skeleton className="h-3 w-full rounded bg-muted" />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * Search overlay for one stop: a focused input over campus and map results.
 * Lives above the route screen so results never crowd the map.
 */
export function PlacePalette({
  title,
  placeholder,
  onChoose,
  onClose,
  onPickOnMap,
  onMyLocation,
  locating,
  locationNote,
  settingsNeeded,
}: {
  title: string;
  placeholder: string;
  onChoose: (stop: Stop) => void;
  onClose: () => void;
  onPickOnMap: () => void;
  /** Present only for the start, which can be the user's position. */
  onMyLocation?: () => void;
  locating: boolean;
  locationNote: string | null;
  /** The system will not ask again; offer settings. */
  settingsNeeded: boolean;
}) {
  useLanguage();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const q = query.trim();
  const campus = useMemo(() => searchCampusPlaces(q, CAMPUS_LIMIT), [q]);

  useEffect(() => {
    setFailed(false);
    if (q.length < MIN_REMOTE_QUERY) {
      setRemote([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      searchPlaces(q, controller.signal)
        .then((places) => setRemote(places))
        .catch(() => {
          if (!controller.signal.aborted) setFailed(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const typed = q !== "";
  const nothing = typed && !searching && !failed && campus.length === 0 && remote.length === 0;

  return (
    <View
      testID="session.location.palette"
      className="absolute inset-0 z-10 bg-background"
      style={{ paddingTop: insets.top }}
    >
      <View className="flex-row items-center justify-between px-5 pb-3 pt-2">
        <Text className="text-[19px] font-bold tracking-tight">{title}</Text>
        <Pressable
          testID="session.location.palette.close"
          accessibilityRole="button"
          accessibilityLabel={t("Cancel")}
          hitSlop={8}
          onPress={onClose}
          className="h-9 w-9 items-center justify-center rounded-full bg-muted active:opacity-80"
        >
          <X size={18} className="text-foreground" />
        </Pressable>
      </View>

      <View className="mx-5 h-12 flex-row items-center gap-3 rounded-2xl border border-border bg-card px-4">
        <Search size={18} className="text-muted-foreground" />
        <BottomSheetTextInput
          testID="session.location.palette.input"
          autoFocus
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          placeholder={placeholder}
          accessibilityLabel={placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          className="h-12 min-w-0 flex-1 border-0 bg-transparent px-0 text-[16px] text-foreground"
        />
        {typed && (
          <Pressable
            testID="session.location.palette.clear"
            accessibilityRole="button"
            accessibilityLabel={t("Clear")}
            hitSlop={8}
            onPress={() => setQuery("")}
            className="h-6 w-6 items-center justify-center rounded-full bg-muted"
          >
            <X size={14} className="text-muted-foreground" />
          </Pressable>
        )}
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        className="mt-2 flex-1"
      >
        {!typed && (
          <>
            {onMyLocation && (
              <Row
                testID="session.location.mine"
                icon={LocateFixed}
                label={locating ? t("Finding your location…") : t("Use my location")}
                onPress={onMyLocation}
              />
            )}
            <Row testID="session.location.pick" label={t("Pick on map")} onPress={onPickOnMap} />
            {locationNote && (
              <Notice
                testID="session.location.note"
                title={locationNote}
                className="mx-5 mb-2 mt-1"
                actionLabel={settingsNeeded ? t("Open settings") : undefined}
                onAction={settingsNeeded ? () => void Linking.openSettings() : undefined}
              />
            )}
          </>
        )}

        {campus.length > 0 && (
          <>
            <SectionTitle>{t("Campus")}</SectionTitle>
            {campus.map((suggestion) => (
              <Row
                key={`${suggestion.value}-${suggestion.place.name}`}
                testID="session.location.suggestion"
                label={suggestion.value}
                detail={suggestion.value === suggestion.place.name ? undefined : suggestion.place.name}
                onPress={() =>
                  onChoose({ text: suggestion.value, point: { lat: suggestion.place.lat, lng: suggestion.place.lng } })
                }
              />
            ))}
          </>
        )}

        {remote.length > 0 && (
          <>
            <SectionTitle>{t("Places")}</SectionTitle>
            {remote.map((place) => (
              <Row
                key={`${place.lat},${place.lng},${place.name}`}
                testID="session.location.place"
                label={place.name}
                detail={place.address}
                onPress={() => onChoose({ text: place.name, point: { lat: place.lat, lng: place.lng } })}
              />
            ))}
          </>
        )}

        {typed && searching && remote.length === 0 && <SkeletonRows />}

        {failed && (
          <View className="items-center gap-3 px-8 pt-24">
            <ErrorMark size={72} />
            <Text className="text-center text-[15px] text-muted-foreground">{t("Couldn't search. Try again.")}</Text>
            <Pressable
              testID="session.location.retry"
              accessibilityRole="button"
              onPress={retry}
              className="h-9 items-center justify-center rounded-full bg-muted px-4 active:opacity-80"
            >
              <Text className="text-[14px] font-semibold">{t("Try again")}</Text>
            </Pressable>
          </View>
        )}

        {nothing && (
          <View className="items-center gap-3 px-8 pt-24">
            <NoResultsMark size={72} />
            <Text className="text-center text-[15px] text-muted-foreground">{t("No places found")}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
