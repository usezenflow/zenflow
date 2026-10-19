import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { Maximize2 } from "@/components/Icons";
import { NoteSkeleton } from "@/components/tasks/note-skeleton";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { getBaseURL } from "@/lib/api-client";
import { resolveNoteFileUrls } from "@/lib/file-link";
import { noteSnippet } from "@/lib/note-html";
import { cn } from "@/lib/utils";
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import {
  BottomSheet,
  BottomSheetContent,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// The editor (tentap + tiptap + WebView) is the heaviest module in the form.
// It is only needed once the modal opens, so it is loaded then instead of
// being evaluated with the rest of the app at startup.
const DescriptionFieldEditor = lazy(() =>
  import("./description-editor").then((m) => ({
    default: m.DescriptionFieldEditor,
  })),
);

/**
 * Full-screen host for the editor: a sheet at full height, opened the same way
 * as the tag sheet, so it stacks above the task sheet (a native `Modal` or a
 * second overlay window got covered by it). Panning is off so the editor's own
 * scrolling and selection are never taken by the sheet.
 */
export function NoteScreen({
  children,
  onClose,
  height,
}: {
  children: React.ReactNode;
  onClose: () => void;
  /** Pixel height of the sheet. Defaults to 100% of its container. */
  height?: number;
}) {
  const sheet = useBottomSheet();
  useEffect(() => {
    sheet.open();
    // Opens once, when the editor is asked for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <BottomSheet>
      <BottomSheetContent
        ref={sheet.ref}
        snapPoints={[height ?? "100%"]}
        bottomInset={0}
        backgroundStyle={{ backgroundColor: "transparent", borderWidth: 0 }}
        enableDynamicSizing={false}
        enablePanDownToClose={false}
        enableContentPanningGesture={false}
        enableHandlePanningGesture={false}
        handleComponent={null}
        topInset={0}
        keyboardBehavior="extend"
        keyboardBlurBehavior="none"
        onDismiss={onClose}
      >
        <View className="flex-1">{children}</View>
      </BottomSheetContent>
    </BottomSheet>
  );
}

/**
 * Shown while the editor chunk loads. Same header as the editor (title +
 * Done) so only the body is a skeleton and the modal can still be closed.
 */
function EditorFallback({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-5 pb-3 pt-2">
        <Text className="text-[19px] font-bold tracking-tight">
          {t("Description")}
        </Text>
        <Pressable
          onPress={onClose}
          accessibilityLabel={t("Done")}
          className="h-9 flex-row items-center rounded-full bg-primary px-4"
        >
          <Text className="text-[14px] font-semibold text-primary-foreground">
            {t("Done")}
          </Text>
        </Pressable>
      </View>
      <View className="px-5 pt-5">
        <NoteSkeleton />
      </View>
    </View>
  );
}

export function DescriptionField({
  initialValue: storedValue,
  onChange,
  onDone,
  onUpload,
  disabled,
  openRef,
  hideCard,
}: {
  initialValue: string;
  onChange: (value: string) => void;
  /** Runs once when the full-screen editor closes, with the note as edited. */
  onDone?: (value: string) => void;
  onUpload?: (ids: string[]) => void;
  disabled?: boolean;
  /** Set to a function that opens the full-screen editor, for a button outside the card. */
  openRef?: { current: (() => void) | null };
  /** Render only the full-screen editor; the caller shows the note and opens it through `openRef`. */
  hideCard?: boolean;
}) {
  useLanguage();
  const { toast } = useToast();
  // The API sends file refs origin-relative; the editor WebView needs absolute.
  const initialValue = resolveNoteFileUrls(storedValue, getBaseURL());
  const [value, setValue] = useState(initialValue);
  const [open, setOpen] = useState(false);
  if (openRef) openRef.current = () => setOpen(true);
  const valueRef = useRef(initialValue);
  // A genuinely new `initialValue` from the parent (its fetch resolved after
  // mount) replaces what the card shows; echoes of our own edits are no-ops.
  useEffect(() => {
    setValue(initialValue);
    valueRef.current = initialValue;
  }, [initialValue]);
  const close = () => {
    setOpen(false);
    onDone?.(valueRef.current);
  };
  const snippet = noteSnippet(value);
  const editor = (
    <Suspense fallback={<EditorFallback onClose={close} />}>
      <DescriptionFieldEditor
        initialValue={value}
        onChange={(html) => {
          valueRef.current = html;
          setValue(html);
          onChange(html);
        }}
        onClose={close}
        onUpload={onUpload}
        disabled={disabled}
        toast={toast}
      />
    </Suspense>
  );

  return (
    <>
      {hideCard ? null : (
      <Pressable
        onPress={() => setOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={t("Description")}
        className={cn(
          "min-h-[96px] flex-row items-start gap-3 rounded-[13px] border border-glass-edge/35 bg-glass/70 dark:border-glass-edge/25 dark:bg-glass/[0.07] px-3.5 py-3 active:bg-muted/40",
          disabled && "opacity-50",
        )}
      >
        <Text
          numberOfLines={4}
          className={cn(
            "flex-1 text-[15px] leading-[21px]",
            !snippet && "text-muted-foreground",
          )}
        >
          {snippet || t("Add notes…")}
        </Text>
        <Maximize2 size={16} className="mt-0.5 text-muted-foreground" />
      </Pressable>
      )}
      {open ? <NoteScreen onClose={close}>{editor}</NoteScreen> : null}
    </>
  );
}
