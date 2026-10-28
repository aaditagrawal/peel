import { memo, useMemo } from "react";
import {
  type StyleProp,
  type TextStyle,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import { Sticker as StickerIcon, type LucideIcon } from "lucide-react-native";
import { useTheme, type Colors } from "./theme";
import type { Sticker } from "./library";

export const face = {
  regular: "DMSans_400Regular",
  medium: "DMSans_500Medium",
  bold: "DMSans_700Bold",
  display: "DMSans_700Bold",
  mono: "DMMono_400Regular",
};
export function Label({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  const { colors: C } = useTheme();
  const s = styles(C);
  return <Text style={[s.text, style]}>{children}</Text>;
}
export function IconButton({
  icon: Icon,
  label,
  onPress,
  danger = false,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const { colors: C } = useTheme();
  const s = styles(C);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [s.iconButton, pressed && { opacity: 0.5 }]}
    >
      <Icon size={20} color={danger ? C.accent : C.ink} strokeWidth={1.7} />
    </Pressable>
  );
}
export function Button({
  title,
  onPress,
  icon: Icon,
  secondary = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  icon?: LucideIcon;
  secondary?: boolean;
  disabled?: boolean;
}) {
  const { colors: C } = useTheme();
  const s = styles(C);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        secondary && s.secondary,
        (pressed || disabled) && { opacity: 0.55 },
      ]}
    >
      {Icon && (
        <Icon
          size={18}
          color={secondary ? C.ink : C.onAccent}
          strokeWidth={1.8}
        />
      )}
      <Label
        style={{
          color: secondary ? C.ink : C.onAccent,
          fontFamily: face.bold,
          fontSize: 14,
        }}
      >
        {title}
      </Label>
    </Pressable>
  );
}
export const Art = memo(function Art({
  sticker,
  size = 90,
  rotation = 0,
  playing = true,
}: {
  sticker: Sticker;
  size?: number;
  rotation?: number;
  playing?: boolean;
}) {
  // Browsers cannot pause animated WebP images. Swap to the existing still frame
  // outside the viewport, releasing the animated decoder on every platform.
  const still = sticker.animated && !playing && !!sticker.tray;
  const data = still ? sticker.tray : sticker.data;
  const source = useMemo(
    () => ({ uri: `data:image/${still ? "png" : "webp"};base64,${data}` }),
    [data, still],
  );
  return (
    <Image
      source={source}
      accessibilityLabel={sticker.name}
      contentFit="contain"
      style={{
        width: size,
        height: size,
        transform: [{ rotate: `${rotation}deg` }],
      }}
    />
  );
});
export function Brand() {
  const { colors: C } = useTheme();
  const s = styles(C);
  return (
    <View style={s.brand}>
      <View style={s.brandMark}>
        <StickerIcon size={25} color="#fff" strokeWidth={1.8} />
      </View>
      <Text style={s.logo}>
        peel<Text style={{ color: C.accent }}>.</Text>
      </Text>
    </View>
  );
}

const styleCache = new WeakMap<Colors, ReturnType<typeof createStyles>>();
export function styles(colors: Colors) {
  let value = styleCache.get(colors);
  if (!value) {
    value = createStyles(colors);
    styleCache.set(colors, value);
  }
  return value;
}
const createStyles = (C: Colors) =>
  StyleSheet.create({
    settingTitle: { fontFamily: face.bold, fontSize: 17, color: C.ink },
    themeOption: {
      flex: 1,
      minHeight: 48,
      borderWidth: 1,
      borderColor: C.line,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
    },
    app: { flex: 1, flexDirection: "row", backgroundColor: C.bg },
    text: { fontFamily: face.regular, fontSize: 14, color: C.muted },
    row: { flexDirection: "row", alignItems: "center", gap: 10 },
    sidebar: {
      width: 240,
      borderRightWidth: 1,
      borderColor: C.line,
      padding: 26,
      backgroundColor: C.surface,
    },
    brand: { flexDirection: "row", alignItems: "center", gap: 10 },
    brandMark: {
      width: 37,
      height: 39,
      borderRadius: 11,
      borderBottomRightRadius: 20,
      backgroundColor: C.accent,
      alignItems: "center",
      justifyContent: "center",
      transform: [{ rotate: "-8deg" }],
    },
    logo: {
      fontFamily: face.display,
      fontSize: 37,
      color: C.ink,
      letterSpacing: -2,
    },
    navItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 15,
      borderRadius: 8,
      marginHorizontal: -8,
    },
    navActive: { backgroundColor: C.accentSoft },
    count: {
      marginLeft: "auto",
      backgroundColor: C.accentSoft,
      borderRadius: 5,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    topbar: {
      height: 82,
      borderBottomWidth: 1,
      borderColor: C.line,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    headingRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },
    pageTitle: {
      fontFamily: face.display,
      fontSize: 40,
      color: C.ink,
      letterSpacing: -1.5,
      marginTop: 10,
    },
    button: {
      backgroundColor: C.accent,
      borderRadius: 8,
      minHeight: 47,
      paddingHorizontal: 19,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 9,
    },
    secondary: {
      backgroundColor: C.soft,
      borderWidth: 1,
      borderColor: C.line,
    },
    sectionTitle: {
      fontFamily: face.display,
      fontSize: 22,
      color: C.ink,
      letterSpacing: -0.5,
    },
    neutralCount: {
      borderWidth: 1,
      borderColor: C.line,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 6,
    },
    filterRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 14,
    },
    filters: { flexDirection: "row", gap: 5 },
    filter: {
      minHeight: 44,
      justifyContent: "center",
      paddingHorizontal: 15,
      paddingVertical: 11,
      borderRadius: 7,
    },
    filterSelected: { backgroundColor: C.ink },
    search: {
      width: 200,
      flexDirection: "row",
      gap: 8,
      alignItems: "center",
      borderWidth: 1,
      borderColor: C.line,
      borderRadius: 7,
      paddingHorizontal: 12,
      backgroundColor: C.input,
    },
    searchInput: {
      flex: 1,
      fontFamily: face.regular,
      color: C.ink,
      fontSize: 12,
      minHeight: 40,
    },
    packCard: {
      borderWidth: 1,
      borderColor: C.line,
      borderRadius: 12,
      overflow: "hidden",
      backgroundColor: C.surface,
    },
    packArt: { height: 173, padding: 12 },
    packInfo: {
      padding: 17,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    packArrow: { backgroundColor: C.soft, padding: 8, borderRadius: 20 },
    newCard: {
      minHeight: 250,
      borderWidth: 1,
      borderColor: C.border,
      borderStyle: "dashed",
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      gap: 9,
      padding: 20,
    },
    newPlus: {
      width: 51,
      height: 51,
      borderRadius: 17,
      backgroundColor: C.soft,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 7,
    },
    bottomNav: {
      flexDirection: "row",
      borderTopWidth: 1,
      borderColor: C.line,
      paddingTop: 12,
      backgroundColor: C.bg,
    },
    bottomNavItem: { flex: 1, alignItems: "center", gap: 6, minHeight: 44 },
    settingsCard: {
      padding: 24,
      gap: 16,
      borderWidth: 1,
      borderColor: C.line,
      borderRadius: 12,
      backgroundColor: C.surface,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: "#24291E88",
      justifyContent: "center",
      alignItems: "center",
      padding: 16,
    },
    sheet: {
      width: "100%",
      maxWidth: 540,
      backgroundColor: C.bg,
      borderRadius: 22,
      overflow: "hidden",
    },
    sheetHeader: {
      padding: 24,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      borderBottomWidth: 1,
      borderColor: C.line,
    },
    iconButton: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 22,
    },
    input: {
      fontFamily: face.medium,
      color: C.ink,
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.input,
      borderRadius: 8,
      padding: 14,
      fontSize: 16,
    },
    dropzone: {
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: C.border,
      backgroundColor: C.soft,
      padding: 20,
      alignItems: "center",
      gap: 8,
      borderRadius: 12,
    },
    stickerGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
    stickerCell: {
      width: 100,
      minHeight: 104,
      backgroundColor: C.soft,
      borderRadius: 10,
      padding: 7,
      alignItems: "center",
    },
    removeSticker: {
      position: "absolute",
      right: -6,
      top: -6,
      backgroundColor: C.input,
      borderRadius: 16,
      width: 32,
      height: 32,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: C.line,
    },
    sheetFooter: {
      paddingHorizontal: 24,
      paddingTop: 20,
      borderTopWidth: 1,
      borderColor: C.line,
    },
    notice: {
      width: "100%",
      maxWidth: 420,
      padding: 24,
      backgroundColor: C.bg,
      borderRadius: 18,
      gap: 20,
    },
  });
