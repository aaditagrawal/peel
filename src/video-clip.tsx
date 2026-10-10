import { useTheme } from "./theme";
import { useState } from "react";
import { View, Text, TextInput, Pressable } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEventListener } from "expo";
import type { DocumentPickerAsset } from "expo-document-picker";
export function VideoClip({
  asset,
  onImport,
  onCancel,
  busy,
}: {
  asset: DocumentPickerAsset;
  onImport: (start: number, duration: number) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const { colors: C } = useTheme();
  const [start, setStart] = useState("0");
  const [duration, setDuration] = useState("3");
  const player = useVideoPlayer(asset.uri, (player) => {
    player.muted = true;
    player.timeUpdateEventInterval = 0.1;
  });
  useEventListener(player, "timeUpdate", ({ currentTime }) => {
    if (currentTime >= Number(start) + Number(duration)) {
      player.pause();
      // Expo VideoPlayer is a mutable native handle, not React state.
      // eslint-disable-next-line react-hooks/immutability
      player.currentTime = Number(start);
    }
  });
  const valid =
    Number.isFinite(Number(start)) &&
    Number(start) >= 0 &&
    Number(duration) >= 1 &&
    Number(duration) <= 6;
  return (
    <View style={{ gap: 14 }}>
      <Text style={{ fontFamily: "DMSans_700Bold", color: C.ink }}>
        Trim clip
      </Text>
      <VideoView
        player={player}
        style={{ width: "100%", height: 210, borderRadius: 12 }}
        nativeControls
        contentFit="contain"
      />
      <Text
        style={{
          fontFamily: "DMSans_400Regular",
          fontSize: 12,
          color: C.muted,
        }}
      >
        1–6 seconds · No sound
      </Text>
      <View style={{ flexDirection: "row", gap: 16 }}>
        {[
          { title: "Start (s)", value: start, change: setStart },
          { title: "Length (s)", value: duration, change: setDuration },
        ].map((field) => (
          <View key={field.title} style={{ flex: 1, gap: 8 }}>
            <Text
              style={{
                fontFamily: "DMSans_500Medium",
                color: C.ink,
                fontSize: 12,
              }}
            >
              {field.title}
            </Text>
            <TextInput
              accessibilityLabel={field.title}
              keyboardType="decimal-pad"
              value={field.value}
              onChangeText={field.change}
              style={{
                backgroundColor: C.input,
                color: C.ink,
                fontFamily: "DMMono_400Regular",
                borderWidth: 1,
                borderColor: C.border,
                borderRadius: 8,
                padding: 12,
              }}
            />
          </View>
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={!valid || busy}
        onPress={() => {
          // Expo documents seeking by assigning this native property.
          // eslint-disable-next-line react-hooks/immutability
          player.currentTime = Number(start);
          player.play();
        }}
        style={{
          padding: 14,
          alignItems: "center",
          borderRadius: 8,
          backgroundColor: C.soft,
        }}
      >
        <Text style={{ color: C.ink, fontFamily: "DMSans_700Bold" }}>
          Preview
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={!valid || busy}
        onPress={() => onImport(Number(start), Number(duration))}
        style={{
          padding: 16,
          alignItems: "center",
          borderRadius: 8,
          backgroundColor: C.accent,
          opacity: !valid || busy ? 0.5 : 1,
        }}
      >
        <Text style={{ color: C.onAccent, fontFamily: "DMSans_700Bold" }}>
          Use clip
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={onCancel}
        style={{ padding: 12, alignItems: "center" }}
      >
        <Text style={{ color: C.muted, fontFamily: "DMSans_400Regular" }}>
          Cancel
        </Text>
      </Pressable>
    </View>
  );
}
