import { useTheme } from "./theme";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Pencil, Check, X } from "lucide-react-native";

export function NameEditor({
  value,
  kind,
  onSave,
  disabled = false,
  initiallyEditing = false,
  onCancel,
}: {
  value: string;
  kind: "pack" | "sticker";
  onSave: (value: string) => void;
  disabled?: boolean;
  initiallyEditing?: boolean;
  onCancel?: () => void;
}) {
  const { colors: C } = useTheme();
  const [editing, setEditing] = useState(initiallyEditing);
  const [draft, setDraft] = useState(value);
  const limit = kind === "pack" ? 70 : 125;
  const save = () => {
    if (!draft.trim() || disabled) return;
    onSave(draft.trim());
    setEditing(false);
  };
  if (!editing)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Rename ${kind} ${value}`}
        disabled={disabled}
        onPress={() => {
          setDraft(value);
          setEditing(true);
        }}
        style={({ pressed }) => ({
          flexDirection: "row",
          gap: 8,
          alignItems: "center",
          width: "100%",
          minHeight: 44,
          padding: 8,
          borderRadius: 8,
          backgroundColor: kind === "pack" ? C.soft : "transparent",
          opacity: pressed || disabled ? 0.5 : 1,
        })}
      >
        <Text
          numberOfLines={2}
          style={{
            flex: 1,
            fontFamily: "DMSans_600SemiBold",
            fontSize: kind === "pack" ? 16 : 12,
            color: C.ink,
          }}
        >
          {value}
        </Text>
        <Pencil size={15} color={C.olive} />
      </Pressable>
    );
  return (
    <View style={{ gap: 6, width: "100%" }}>
      <TextInput
        autoFocus
        accessibilityLabel={`${kind === "pack" ? "Pack" : "Sticker"} name`}
        value={draft}
        onChangeText={setDraft}
        maxLength={limit}
        editable={!disabled}
        returnKeyType="done"
        onSubmitEditing={save}
        style={{
          fontFamily: "DMSans_400Regular",
          minHeight: 44,
          padding: 10,
          backgroundColor: C.input,
          borderWidth: 1,
          borderColor: C.olive,
          borderRadius: 8,
          color: C.ink,
          fontSize: 14,
        }}
      />
      {!draft.trim() && (
        <Text
          accessibilityRole="alert"
          style={{
            fontFamily: "DMSans_400Regular",
            color: C.accent,
            fontSize: 11,
          }}
        >
          Enter a name.
        </Text>
      )}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Save ${kind} name`}
          disabled={!draft.trim() || disabled}
          onPress={save}
          style={{
            flex: 1,
            minHeight: 44,
            backgroundColor: C.olive,
            borderRadius: 8,
            alignItems: "center",
            justifyContent: "center",
            opacity: !draft.trim() || disabled ? 0.45 : 1,
          }}
        >
          <Check size={19} color={C.inverse} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Cancel ${kind} rename`}
          disabled={disabled}
          onPress={() => {
            setEditing(false);
            onCancel?.();
          }}
          style={{
            width: 44,
            minHeight: 44,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <X size={18} color={C.muted} />
        </Pressable>
      </View>
    </View>
  );
}
