import { useMemo, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { Check, Layers, Search, X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { planCombination } from "./combine-packs";
import type { Pack } from "./library-store";
import { Art, Button, IconButton, Label, face, styles } from "./studio-ui";
import { useTheme } from "./theme";

export function CombinePacksSheet({
  packs,
  initialIds,
  onClose,
  onCreate,
}: {
  packs: Pack[];
  initialIds: string[];
  onClose: () => void;
  onCreate: (ids: string[], name: string) => void;
}) {
  const { colors: C } = useTheme();
  const s = styles(C);
  const insets = useSafeAreaInsets();
  const [ids, setIds] = useState(initialIds);
  const [name, setName] = useState("My combined pack");
  const [query, setQuery] = useState("");
  const plan = useMemo(() => {
    const byId = new Map(packs.map((pack) => [pack.id, pack]));
    return planCombination(ids.flatMap((id) => byId.get(id) ?? []));
  }, [packs, ids]);
  const visible = useMemo(
    () =>
      packs.filter((pack) =>
        pack.name.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [packs, query],
  );
  const canCreate =
    plan.sourceCount >= 2 && !!plan.stickers.length && !!name.trim();
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View
          style={[s.modalBackdrop, { paddingTop: Math.max(insets.top, 16) }]}
        >
          <View
            style={[
              s.sheet,
              { height: "94%", paddingBottom: Math.max(insets.bottom, 24) },
            ]}
          >
            <View style={s.sheetHeader}>
              <Text style={[s.sectionTitle, { flex: 1 }]}>Combine packs</Text>
              <IconButton
                icon={X}
                label="Cancel combining packs"
                onPress={onClose}
              />
            </View>
            <FlatList
              style={{ flex: 1 }}
              data={visible}
              extraData={ids}
              keyExtractor={(pack) => pack.id}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentInsetAdjustmentBehavior="automatic"
              contentContainerStyle={{
                paddingHorizontal: 24,
                paddingBottom: 16,
              }}
              initialNumToRender={6}
              windowSize={5}
              ListHeaderComponent={
                <View style={{ paddingTop: 24, paddingBottom: 16, gap: 12 }}>
                  <Label>
                    Choose two or more packs. Your original packs stay in your
                    library.
                  </Label>
                  <TextInput
                    accessibilityLabel="Combined pack name"
                    placeholder="Name your combined pack"
                    placeholderTextColor={C.muted}
                    maxLength={70}
                    value={name}
                    onChangeText={setName}
                    style={s.input}
                    returnKeyType="done"
                  />
                  {!name.trim() && (
                    <Text
                      accessibilityRole="alert"
                      style={{ color: C.accent, fontFamily: face.regular }}
                    >
                      Give your combined pack a name.
                    </Text>
                  )}
                  <View style={[s.search, { width: "100%" }]}>
                    <Search size={16} color={C.muted} />
                    <TextInput
                      accessibilityLabel="Search packs to combine"
                      placeholder="Find a pack…"
                      placeholderTextColor={C.muted}
                      value={query}
                      onChangeText={setQuery}
                      style={s.searchInput}
                      returnKeyType="search"
                    />
                  </View>
                </View>
              }
              renderItem={({ item: pack }) => {
                const checked = ids.includes(pack.id);
                return (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityLabel={`${pack.name}, ${pack.stickers.length} stickers, ${pack.animated ? "animated" : "static"}`}
                    aria-checked={checked}
                    onPress={() =>
                      setIds((current) =>
                        current.includes(pack.id)
                          ? current.filter((id) => id !== pack.id)
                          : [...current, pack.id],
                      )
                    }
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      padding: 12,
                      marginBottom: 8,
                      borderWidth: 1,
                      borderRadius: 12,
                      borderColor: checked ? C.olive : C.line,
                      backgroundColor: checked ? C.soft : C.surface,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <View
                      style={{
                        width: 48,
                        height: 48,
                        backgroundColor: pack.color,
                        borderRadius: 8,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {pack.stickers[0] ? (
                        <Art
                          sticker={pack.stickers[0]}
                          size={44}
                          playing={false}
                        />
                      ) : (
                        <Layers size={22} color={C.olive} />
                      )}
                    </View>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text
                        numberOfLines={2}
                        style={{
                          color: C.ink,
                          fontFamily: face.bold,
                          fontSize: 14,
                        }}
                      >
                        {pack.name}
                      </Text>
                      <Label style={{ fontSize: 11 }}>
                        {pack.stickers.length} stickers ·{" "}
                        {pack.animated ? "Animated" : "Static"}
                      </Label>
                    </View>
                    <View
                      style={{
                        width: 24,
                        height: 24,
                        borderWidth: 1,
                        borderRadius: 6,
                        borderColor: checked ? C.olive : C.border,
                        backgroundColor: checked ? C.olive : C.input,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {checked && <Check size={17} color={C.inverse} />}
                    </View>
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <Label style={{ paddingVertical: 16 }}>
                  No matching packs.
                </Label>
              }
            />
            <View style={[s.sheetFooter, { gap: 10 }]}>
              <Text
                accessibilityLiveRegion="polite"
                style={{ color: C.ink, fontFamily: face.bold, fontSize: 13 }}
              >
                {plan.sourceCount} packs selected · {plan.stickers.length}{" "}
                unique stickers
              </Text>
              {plan.sourceCount < 2 ? (
                <Label style={{ fontSize: 12 }}>
                  Choose at least two packs to combine.
                </Label>
              ) : !plan.stickers.length ? (
                <Label style={{ fontSize: 12 }}>
                  Choose packs with stickers in them.
                </Label>
              ) : (
                <Label style={{ fontSize: 12 }}>
                  {plan.packCount === 1
                    ? "Creates one new pack."
                    : `Creates ${plan.packCount} new packs with up to 30 stickers each.`}
                  {plan.mixed
                    ? " Static and animated stickers go into separate packs."
                    : ""}
                  {plan.duplicates
                    ? ` Skips ${plan.duplicates} exact duplicate ${plan.duplicates === 1 ? "sticker" : "stickers"}.`
                    : ""}
                  {plan.hasDrafts
                    ? " Packs with fewer than 3 stickers stay as drafts until you add more."
                    : ""}
                </Label>
              )}
              <Button
                title={
                  plan.packCount > 1
                    ? `Create ${plan.packCount} packs`
                    : "Create combined pack"
                }
                icon={Layers}
                disabled={!canCreate}
                onPress={() => onCreate(ids, name)}
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
