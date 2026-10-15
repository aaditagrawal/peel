import { memo } from "react";
import { Pressable, View } from "react-native";
import { ArrowRight, MessageCircle } from "lucide-react-native";
import { useTheme } from "./theme";
import { validatePack, type Pack } from "./library";
import { Art, Button, Label, face, styles } from "./studio-ui";

export const PackCard = memo(function PackCard({
  pack,
  mobile,
  cardWidth,
  disabled,
  playing,
  onOpen,
  onMenu,
  onExport,
}: {
  pack: Pack;
  mobile: boolean;
  cardWidth: number;
  disabled: boolean;
  playing: boolean;
  onOpen: (id: string) => void;
  onMenu: (id: string) => void;
  onExport: (pack: Pack) => void;
}) {
  const { colors: C } = useTheme();
  const s = styles(C);
  const validation = validatePack(pack);
  return (
    <View style={[s.packCard, { width: cardWidth }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${pack.name}`}
        accessibilityHint="Hold for pack options"
        accessibilityActions={[{ name: "longpress", label: "Pack options" }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "longpress") onMenu(pack.id);
        }}
        onLongPress={() => onMenu(pack.id)}
        delayLongPress={450}
        disabled={disabled}
        onPress={() => onOpen(pack.id)}
        style={({ pressed }) => ({
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <View style={[s.packArt, { backgroundColor: pack.color }]}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "center",
              alignItems: "center",
              paddingTop: 38,
            }}
          >
            {pack.stickers.slice(0, 3).map((sticker, i) => (
              <View
                key={sticker.id}
                style={{
                  marginHorizontal: -7,
                  marginTop: i === 1 ? -18 : 20,
                }}
              >
                <Art
                  sticker={sticker}
                  playing={playing}
                  size={mobile ? 100 : 90}
                  rotation={i === 0 ? -14 : i === 2 ? 14 : 0}
                />
              </View>
            ))}
          </View>
        </View>
        <View style={s.packInfo}>
          <View style={{ flex: 1 }}>
            <Label
              style={{
                color: C.ink,
                fontFamily: face.bold,
                fontSize: 15,
              }}
            >
              {pack.name}
            </Label>
            <Label style={{ fontSize: 11, marginTop: 6 }}>
              {pack.stickers.length}{" "}
              {pack.stickers.length === 1 ? "sticker" : "stickers"}
              {pack.stickers.length < 3 ? " · Draft" : ""}
            </Label>
          </View>
          <View style={s.packArrow}>
            <ArrowRight size={16} color={C.ink} />
          </View>
        </View>
      </Pressable>
      <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
        <Button
          title={
            pack.stickers.length < 3
              ? `Add ${3 - pack.stickers.length} more stickers`
              : "Import to WhatsApp"
          }
          icon={MessageCircle}
          disabled={disabled}
          onPress={() =>
            pack.stickers.length < 3 ? onOpen(pack.id) : onExport(pack)
          }
        />
        {!!validation && (
          <Label style={{ fontSize: 11, marginTop: 8 }}>{validation}</Label>
        )}
      </View>
    </View>
  );
});

// Keep vertical spacing inside measured cells so list window calculations include it.
export function PackRowSeparator() {
  return <View style={{ height: 20 }} />;
}

// A partially visible card should already be playing as it enters the viewport.
export const PACK_PREVIEW_VIEWABILITY = { itemVisiblePercentThreshold: 1 };
