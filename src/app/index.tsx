import { exportBackup, importBackup } from "../backup";
import { useTheme, type Colors } from "../theme";
import { useRef, useState } from "react";
import Constants from "expo-constants";
import { makePacks, appendImported } from "../import-packs";
import {
  type StyleProp,
  type TextStyle,
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { VideoClip } from "../video-clip";
import { NameEditor } from "../name-editor";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowRight,
  Pencil,
  Check,
  Sun,
  Moon,
  FolderHeart,
  ImagePlus,
  Layers,
  MessageCircle,
  Plus,
  Search,
  Settings2,
  Sticker as StickerIcon,
  Trash2,
  X,
  Zap,
} from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import {
  addPacks,
  restorePacks,
  clearError,
  retrySave,
  retryLoad,
  removePack,
  updatePack,
  useLibrary,
  validatePack,
  type Pack,
  type Sticker,
} from "../library";
import { convert } from "../conversion";
import { conversionError } from "../conversion-error";
import { addToWhatsApp } from "../whatsapp";

const face = {
  regular: "DMSans_400Regular",
  medium: "DMSans_500Medium",
  bold: "DMSans_700Bold",
  display: "DMSans_700Bold",
  mono: "DMMono_400Regular",
};
type Page = "library" | "settings";
function Label({
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
function IconButton({
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
function Button({
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
function Art({
  sticker,
  size = 90,
  rotation = 0,
}: {
  sticker: Sticker;
  size?: number;
  rotation?: number;
}) {
  return (
    <Image
      source={{ uri: `data:image/webp;base64,${sticker.data}` }}
      accessibilityLabel={sticker.name}
      contentFit="contain"
      style={{
        width: size,
        height: size,
        transform: [{ rotate: `${rotation}deg` }],
      }}
    />
  );
}
function Brand() {
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

export default function Home() {
  const theme = useTheme();
  const C = theme.colors;
  const s = styles(C);
  const { width } = useWindowDimensions();
  const wide = width >= 1000;
  const mobile = width < 650;
  const insets = useSafeAreaInsets();
  const { packs, ready, error, dirty, saving } = useLibrary();
  const [page, setPage] = useState<Page>("library");
  const [filter, setFilter] = useState("All packs");
  const [query, setQuery] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [menuMode, setMenuMode] = useState<"actions" | "rename" | "delete">(
    "actions",
  );
  const menuPack = packs.find((pack) => pack.id === menuId);
  function openMenu(id: string) {
    if (lock.current || !ready) return;
    setMenuMode("actions");
    setMenuId(id);
  }
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("My sticker pack");
  const [draft, setDraft] = useState<Sticker[]>([]);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{
    title: string;
    message: string;
    retry?: boolean;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [video, setVideo] = useState<DocumentPicker.DocumentPickerAsset | null>(
    null,
  );
  const [failedImport, setFailedImport] = useState<{
    assets: DocumentPicker.DocumentPickerAsset[];
    packId?: string;
  } | null>(null);
  const lock = useRef(false);
  const selectedPack = packs.find((p) => p.id === selected);
  const visible = packs.filter(
    (p) =>
      p.name.toLowerCase().includes(query.toLowerCase()) &&
      (filter === "All packs" ||
        (filter === "Animated" ? p.animated : !p.animated)),
  );
  const total = packs.reduce((n, p) => n + p.stickers.length, 0);
  const notify = (title: string, message: string, retry = false) =>
    setNotice({ title, message, retry });
  async function backupLibrary(restore: boolean) {
    if (lock.current || !ready) return;
    lock.current = true;
    setBusy(restore ? "Restoring backup…" : "Saving backup…");
    try {
      if (restore) {
        const incoming = await importBackup();
        if (incoming) {
          const result = await restorePacks(incoming);
          notify(
            "Backup restored",
            result.added
              ? `${result.added} ${result.added === 1 ? "pack added" : "packs added"}. Your existing packs were kept.`
              : "These packs are already in your library.",
          );
        }
      } else if (await exportBackup(packs)) {
        notify(
          Platform.OS === "web" ? "Backup downloaded" : "Backup saved",
          "Keep this file to restore your packs after reinstalling Peel.",
        );
      }
    } catch (cause) {
      notify(
        restore ? "Couldn't restore backup" : "Couldn't save backup",
        cause instanceof Error
          ? cause.message
          : "Try again with a different file or folder.",
      );
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  const start = () => {
    if (!ready || lock.current) return;
    setFailedImport(null);
    setName("My sticker pack");
    setDraft([]);
    setVideo(null);
    setCreating(true);
  };
  async function pick(appendTo?: Pack, gallery = false) {
    if (lock.current) return;
    lock.current = true;
    setDeleting(false);
    try {
      const result = gallery
        ? await pickGallery()
        : await DocumentPicker.getDocumentAsync({
            type: [
              "image/png",
              "image/jpeg",
              "image/gif",
              "image/webp",
              "image/heic",
              "image/heif",
              "image/avif",
            ],
            multiple: true,
            copyToCacheDirectory: true,
          });
      if (result.canceled) return;
      await importAssets(result.assets, appendTo);
    } catch (e) {
      notify(
        "Could not open your files",
        e instanceof Error ? e.message : "Please try again.",
      );
    } finally {
      setBusy("");
      lock.current = false;
    }
  }
  async function importAssets(
    assets: DocumentPicker.DocumentPickerAsset[],
    appendTo?: Pack,
  ) {
    const converted: Sticker[] = [];
    const failures: string[] = [];
    const failed: DocumentPicker.DocumentPickerAsset[] = [];
    setFailedImport(null);
    for (const [index, asset] of assets.entries()) {
      const progress = (stage: string) =>
        setBusy(
          assets.length > 1
            ? `${index + 1}/${assets.length} · ${stage}`
            : stage,
        );
      progress("Reading file…");
      try {
        converted.push(await convert(asset, undefined, progress));
      } catch (e) {
        failed.push(asset);
        failures.push(`${asset.name}: ${conversionError(e)}`);
      }
    }
    if (appendTo) {
      const { updated, created } = appendImported(appendTo, converted);
      if (converted.length) updatePack(updated);
      if (created.length) {
        addPacks(created);
        if (!failures.length)
          notify(
            "Stickers saved",
            `Extra stickers are in ${created.length === 1 ? "a new pack" : `${created.length} new packs`}.`,
          );
      }
    } else setDraft((current) => [...current, ...converted]);
    if (failed.length) {
      setFailedImport({ assets: failed, packId: appendTo?.id });
      notify(
        converted.length ? "Some files need another try" : "Import failed",
        failures.join("\n\n"),
        true,
      );
    }
  }
  async function retryImport() {
    if (!failedImport || lock.current) return;
    const retry = failedImport;
    const target = retry.packId
      ? packs.find((p) => p.id === retry.packId)
      : undefined;
    if (retry.packId && !target) {
      setFailedImport(null);
      setNotice(null);
      return;
    }
    lock.current = true;
    setNotice(null);
    try {
      await importAssets(retry.assets, target);
    } finally {
      setBusy("");
      lock.current = false;
    }
  }
  async function pickGallery(): Promise<DocumentPicker.DocumentPickerResult> {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: 0,
      quality: 1,
      allowsEditing: false,
    });
    if (result.canceled) return { canceled: true, assets: null };
    return {
      canceled: false,
      assets: result.assets.map((a) => ({
        uri: a.uri,
        name: a.fileName || "Photo.jpg",
        mimeType: a.mimeType,
        size: a.fileSize,
        file: a.file,
        lastModified: a.file?.lastModified ?? Date.now(),
      })),
    };
  }
  async function pickVideo() {
    if (lock.current) return;
    lock.current = true;
    setDeleting(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"],
        copyToCacheDirectory: true,
      });
      if (!result.canceled) {
        if ((result.assets[0].size || 0) > 100 * 1024 * 1024)
          throw Error("Choose a video smaller than 100 MB.");
        setVideo(result.assets[0]);
      }
    } catch (e) {
      notify(
        "Could not open this video",
        e instanceof Error ? e.message : "Please try again.",
      );
    } finally {
      lock.current = false;
    }
  }
  async function importVideo(start: number, duration: number) {
    if (!video || lock.current) return;
    lock.current = true;
    setBusy("Reading video…");
    try {
      const sticker = await convert(video, { start, duration }, setBusy);
      if (selectedPack && !creating) {
        const { updated, created } = appendImported(selectedPack, [sticker]);
        updatePack(updated);
        if (created.length) {
          addPacks(created);
          setSelected(created[0].id);
        }
      } else setDraft((current) => [...current, sticker]);
      setVideo(null);
    } catch (e) {
      notify("Could not make this sticker", conversionError(e));
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  function save(open = true) {
    if (!draft.length || !ready) return;
    const created = makePacks(draft, name);
    addPacks(created);
    setDraft([]);
    setVideo(null);
    setFailedImport(null);
    setCreating(false);
    setSelected(open ? created[0].id : null);
  }
  function closePack() {
    if (notice || error) {
      setNotice(null);
      clearError();
      return;
    }
    if (busy || lock.current) return;
    if (creating && draft.length) save(false);
    else {
      setCreating(false);
      setSelected(null);
    }
    setVideo(null);
    setFailedImport(null);
    setDeleting(false);
  }
  async function exportPack(pack: Pack) {
    if (lock.current) return;
    lock.current = true;
    setBusy("Opening WhatsApp…");
    try {
      await addToWhatsApp(pack);
    } catch (e) {
      notify(
        "Import to WhatsApp",
        Platform.OS === "android"
          ? conversionError(e)
          : e instanceof Error
            ? e.message
            : "Could not open WhatsApp.",
      );
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  const noticeContent = (
    <View style={s.notice}>
      <View style={s.headingRow}>
        <Text style={s.sectionTitle}>{notice?.title || "Storage notice"}</Text>
        <IconButton
          icon={X}
          label="Dismiss message"
          onPress={() => {
            setNotice(null);
            clearError();
          }}
        />
      </View>
      <ScrollView style={{ maxHeight: 240 }}>
        <Label style={{ lineHeight: 24 }}>{notice?.message || error}</Label>
      </ScrollView>
      {!!notice?.retry && !!failedImport && (
        <Button
          title="Retry failed files"
          onPress={retryImport}
          disabled={!!busy}
        />
      )}
      {!notice && !!error && (!ready || dirty) && (
        <Button
          title={saving ? "Saving…" : "Retry"}
          disabled={saving}
          onPress={() => {
            if (!ready) void retryLoad();
            else void retrySave();
          }}
        />
      )}
      <Button
        title="Got it"
        onPress={() => {
          setNotice(null);
          clearError();
        }}
      />
    </View>
  );
  const nav = [
    { id: "library" as const, title: "My packs", icon: Layers },
    { id: "settings" as const, title: "Settings", icon: Settings2 },
  ];
  return (
    <View style={[s.app, { paddingTop: insets.top }]}>
      {wide && (
        <View style={s.sidebar}>
          <Brand />
          <View style={{ gap: 8, marginTop: 48 }}>
            {nav.map(({ id, title, icon: Icon }) => (
              <Pressable
                key={id}
                accessibilityRole="button"
                onPress={() => setPage(id)}
                style={[s.navItem, page === id && s.navActive]}
              >
                <Icon size={19} color={page === id ? C.accent : C.muted} />
                <Label
                  style={{
                    fontFamily: page === id ? face.bold : face.medium,
                    color: page === id ? C.accent : C.muted,
                  }}
                >
                  {title}
                </Label>
                {id === "library" && (
                  <View style={s.count}>
                    <Label style={{ fontSize: 11, color: C.accent }}>
                      {packs.length}
                    </Label>
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <View style={[s.topbar, { paddingHorizontal: mobile ? 24 : 40 }]}>
          {!wide ? (
            <Brand />
          ) : (
            <Label style={{ fontSize: 13 }}>Sticker studio</Label>
          )}
          <IconButton
            icon={theme.dark ? Sun : Moon}
            label={`Switch to ${theme.dark ? "light" : "dark"} theme`}
            onPress={() => theme.setTheme(theme.dark ? "light" : "dark")}
          />
        </View>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            padding: mobile ? 24 : 40,
            paddingBottom: 40 + insets.bottom,
            gap: 32,
          }}
        >
          {dirty && !saving && (
            <Button
              secondary
              title="Unsaved changes · Retry save"
              onPress={() => void retrySave()}
            />
          )}
          {page === "library" ? (
            <>
              <View style={{ gap: 20 }}>
                <View style={s.headingRow}>
                  <View style={s.row}>
                    <Text style={s.sectionTitle}>My packs</Text>
                    <View style={s.neutralCount}>
                      <Label style={{ fontSize: 11 }}>{packs.length}</Label>
                    </View>
                  </View>
                  <Button
                    title="New pack"
                    icon={Plus}
                    onPress={start}
                    disabled={!ready}
                  />
                </View>
                <View
                  style={[
                    s.filterRow,
                    mobile && {
                      flexDirection: "column",
                      alignItems: "stretch",
                    },
                  ]}
                >
                  <View style={s.filters}>
                    {["All packs", "Static", "Animated"].map((item) => (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected: filter === item }}
                        onPress={() => setFilter(item)}
                        key={item}
                        style={[s.filter, filter === item && s.filterSelected]}
                      >
                        <Label
                          style={{
                            fontSize: 12,
                            fontFamily:
                              filter === item ? face.bold : face.medium,
                            color: filter === item ? C.inverse : C.muted,
                          }}
                        >
                          {item}
                        </Label>
                      </Pressable>
                    ))}
                  </View>
                  <View style={[s.search, mobile && { width: "100%" }]}>
                    <Search size={16} color={C.muted} />
                    <TextInput
                      accessibilityLabel="Search sticker packs"
                      placeholder="Find a pack…"
                      placeholderTextColor={C.muted}
                      value={query}
                      onChangeText={setQuery}
                      style={s.searchInput}
                    />
                  </View>
                </View>
                {!ready ? (
                  <View style={{ gap: 12 }}>
                    <ActivityIndicator color={C.accent} />
                    <Button
                      secondary
                      title="Reload library"
                      onPress={() => void retryLoad()}
                    />
                  </View>
                ) : (
                  <View style={s.grid}>
                    {visible.map((pack) => (
                      <View
                        key={pack.id}
                        style={[
                          s.packCard,
                          {
                            width: mobile
                              ? "100%"
                              : width > 1400
                                ? "31.8%"
                                : "48.5%",
                          },
                        ]}
                      >
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Open ${pack.name}`}
                          accessibilityHint="Hold for pack options"
                          accessibilityActions={[
                            { name: "longpress", label: "Pack options" },
                          ]}
                          onAccessibilityAction={(event) => {
                            if (event.nativeEvent.actionName === "longpress")
                              openMenu(pack.id);
                          }}
                          onLongPress={() => openMenu(pack.id)}
                          delayLongPress={450}
                          disabled={!!busy}
                          onPress={() => {
                            setSelected(pack.id);
                            setDeleting(false);
                          }}
                          style={({ pressed }) => ({
                            opacity: pressed ? 0.8 : 1,
                          })}
                        >
                          <View
                            style={[s.packArt, { backgroundColor: pack.color }]}
                          >
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
                                {pack.stickers.length === 1
                                  ? "sticker"
                                  : "stickers"}
                                {pack.stickers.length < 3 ? " · Draft" : ""}
                              </Label>
                            </View>
                            <View style={s.packArrow}>
                              <ArrowRight size={16} color={C.ink} />
                            </View>
                          </View>
                        </Pressable>
                        <View
                          style={{ paddingHorizontal: 16, paddingBottom: 16 }}
                        >
                          <Button
                            title={
                              pack.stickers.length < 3
                                ? `Add ${3 - pack.stickers.length} more stickers`
                                : "Import to WhatsApp"
                            }
                            icon={MessageCircle}
                            disabled={!!busy}
                            onPress={() =>
                              pack.stickers.length < 3
                                ? setSelected(pack.id)
                                : exportPack(pack)
                            }
                          />
                          {!!validatePack(pack) && (
                            <Label style={{ fontSize: 11, marginTop: 8 }}>
                              {validatePack(pack)}
                            </Label>
                          )}
                        </View>
                      </View>
                    ))}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Create a new sticker pack"
                      onPress={start}
                      style={[
                        s.newCard,
                        {
                          width: mobile
                            ? "100%"
                            : width > 1400
                              ? "31.8%"
                              : "48.5%",
                        },
                      ]}
                    >
                      <View style={s.newPlus}>
                        <Plus size={26} strokeWidth={1.3} color={C.olive} />
                      </View>
                      <Label style={{ fontFamily: face.bold, color: C.ink }}>
                        New pack
                      </Label>
                    </Pressable>
                  </View>
                )}
                {visible.length === 0 && packs.length > 0 && (
                  <Label style={{ textAlign: "center", padding: 16 }}>
                    No matching packs.
                  </Label>
                )}
              </View>
            </>
          ) : (
            <View style={{ gap: 24, maxWidth: 640, width: "100%" }}>
              <Text style={s.sectionTitle}>Settings</Text>
              <View style={s.settingsCard}>
                <Text style={s.settingTitle}>Appearance</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {(["system", "light", "dark"] as const).map((choice) => (
                    <Pressable
                      key={choice}
                      accessibilityRole="button"
                      accessibilityLabel={`${choice[0].toUpperCase() + choice.slice(1)} theme`}
                      accessibilityState={{
                        selected: theme.choice === choice,
                        disabled: !theme.ready,
                      }}
                      disabled={!theme.ready}
                      onPress={() => theme.setTheme(choice)}
                      style={[
                        s.themeOption,
                        theme.choice === choice && {
                          backgroundColor: C.ink,
                          borderColor: C.ink,
                        },
                      ]}
                    >
                      <Label
                        style={{
                          color: theme.choice === choice ? C.inverse : C.ink,
                          fontFamily: face.medium,
                        }}
                      >
                        {choice[0].toUpperCase() + choice.slice(1)}
                      </Label>
                    </Pressable>
                  ))}
                </View>
                {!!theme.error && (
                  <Label style={{ color: C.accent }}>{theme.error}</Label>
                )}
              </View>
              <View style={s.settingsCard}>
                <View style={s.headingRow}>
                  <Text style={s.settingTitle}>Your library</Text>
                  <FolderHeart size={21} color={C.olive} />
                </View>
                <Label style={{ fontFamily: face.mono, color: C.ink }}>
                  {packs.length} packs · {total} stickers
                </Label>
                <Label>
                  {!ready
                    ? "Library unavailable"
                    : saving
                      ? "Saving…"
                      : dirty
                        ? "Changes aren’t saved yet"
                        : "Saved on this device"}
                </Label>
                {(!ready || dirty) && (
                  <Button
                    title={
                      saving
                        ? "Saving…"
                        : !ready
                          ? "Reload library"
                          : "Retry save"
                    }
                    disabled={saving}
                    onPress={() => {
                      void (!ready ? retryLoad() : retrySave());
                    }}
                  />
                )}
                <Button
                  secondary
                  title="Manage packs"
                  icon={Layers}
                  onPress={() => setPage("library")}
                />
                {Platform.OS !== "ios" && (
                  <>
                    <Button
                      secondary
                      title={busy === "Saving backup…" ? busy : "Export backup"}
                      disabled={!ready || !!busy}
                      onPress={() => void backupLibrary(false)}
                    />
                    <Button
                      secondary
                      title={
                        busy === "Restoring backup…" ? busy : "Restore backup"
                      }
                      disabled={!ready || !!busy}
                      onPress={() => void backupLibrary(true)}
                    />
                  </>
                )}
                <Label style={{ fontSize: 12, lineHeight: 18 }}>
                  Export a backup before uninstalling. Restoring keeps your
                  existing packs.
                </Label>
              </View>
              <View style={s.settingsCard}>
                <Text style={s.settingTitle}>Conversion</Text>
                <Label style={{ color: C.ink }}>
                  {Platform.OS === "android"
                    ? "On-device · No uploads"
                    : "Files uploaded for conversion"}
                </Label>
                <Label style={{ fontSize: 12, lineHeight: 18 }}>
                  Quality adjusts automatically to fit WhatsApp.
                </Label>
              </View>
              <Label style={{ fontFamily: face.mono, fontSize: 11 }}>
                Peel {Constants.expoConfig?.version || ""}
              </Label>
              <Label style={{ fontSize: 11, lineHeight: 18 }}>
                Independent of WhatsApp and Meta. Starter artwork: Twemoji, CC
                BY 4.0.
              </Label>
            </View>
          )}
        </ScrollView>
        {!wide && (
          <View
            style={[
              s.bottomNav,
              { paddingBottom: Math.max(insets.bottom, 12) },
            ]}
          >
            {nav.map(({ id, title, icon: Icon }) => (
              <Pressable
                key={id}
                onPress={() => setPage(id)}
                accessibilityRole="button"
                accessibilityLabel={title}
                accessibilityState={{ selected: page === id }}
                style={s.bottomNavItem}
              >
                <Icon size={20} color={page === id ? C.accent : C.muted} />
                <Label
                  style={{
                    fontSize: 10,
                    color: page === id ? C.accent : C.muted,
                  }}
                >
                  {id === "library" ? "My packs" : title}
                </Label>
              </Pressable>
            ))}
          </View>
        )}
      </View>
      <Modal
        visible={!!menuPack}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuId(null)}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <View
            style={[
              s.modalBackdrop,
              {
                justifyContent: "flex-end",
                paddingBottom: Math.max(insets.bottom, 16),
              },
            ]}
          >
            <Pressable
              style={StyleSheet.absoluteFill}
              accessibilityRole="button"
              accessibilityLabel="Dismiss pack options"
              onPress={() => setMenuId(null)}
            />
            {menuPack && (
              <View style={[s.notice, { maxWidth: 540 }]}>
                <View style={s.headingRow}>
                  <Text numberOfLines={2} style={[s.sectionTitle, { flex: 1 }]}>
                    {menuMode === "rename"
                      ? "Rename pack"
                      : menuMode === "delete"
                        ? "Delete pack?"
                        : menuPack.name}
                  </Text>
                  <IconButton
                    icon={X}
                    label="Close pack options"
                    onPress={() => setMenuId(null)}
                  />
                </View>
                {menuMode === "rename" ? (
                  <NameEditor
                    key={menuPack.id}
                    value={menuPack.name}
                    kind="pack"
                    initiallyEditing
                    onSave={(name) => {
                      updatePack({ ...menuPack, name });
                      setMenuId(null);
                    }}
                    onCancel={() => setMenuMode("actions")}
                  />
                ) : menuMode === "delete" ? (
                  <>
                    <Label>
                      Remove “{menuPack.name}” from your library? This can’t be
                      undone.
                    </Label>
                    <Button
                      title="Delete pack"
                      icon={Trash2}
                      onPress={() => {
                        removePack(menuPack.id);
                        setMenuId(null);
                      }}
                    />
                    <Button
                      title="Keep pack"
                      secondary
                      onPress={() => setMenuId(null)}
                    />
                  </>
                ) : (
                  <>
                    <Button
                      title="Open pack"
                      icon={Layers}
                      secondary
                      onPress={() => {
                        setMenuId(null);
                        setSelected(menuPack.id);
                        setDeleting(false);
                      }}
                    />
                    <Button
                      title="Rename"
                      icon={Pencil}
                      secondary
                      onPress={() => setMenuMode("rename")}
                    />
                    <Button
                      title="Delete"
                      icon={Trash2}
                      secondary
                      onPress={() => setMenuMode("delete")}
                    />
                  </>
                )}
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal
        visible={creating || !!selectedPack}
        animationType="slide"
        transparent
        onRequestClose={closePack}
      >
        <View style={s.modalBackdrop}>
          <View
            style={[
              s.sheet,
              {
                maxHeight: mobile ? "94%" : "90%",
                paddingBottom: Math.max(insets.bottom, 24),
              },
            ]}
          >
            <View style={s.sheetHeader}>
              <View style={{ flex: 1 }}>
                {creating ? (
                  <Text style={[s.sectionTitle, { fontSize: 24 }]}>
                    New pack
                  </Text>
                ) : (
                  selectedPack && (
                    <NameEditor
                      key={selectedPack.id}
                      value={selectedPack.name}
                      kind="pack"
                      disabled={!!busy}
                      onSave={(name) => updatePack({ ...selectedPack, name })}
                    />
                  )
                )}
              </View>
              <IconButton icon={X} label="Close pack" onPress={closePack} />
            </View>
            <ScrollView
              automaticallyAdjustKeyboardInsets
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: 24, gap: 20 }}
            >
              {creating ? (
                <>
                  <View style={{ gap: 8 }}>
                    <Label
                      style={{
                        fontFamily: face.bold,
                        color: C.ink,
                        fontSize: 12,
                      }}
                    >
                      PACK NAME
                    </Label>
                    <TextInput
                      accessibilityLabel="Pack name"
                      maxLength={70}
                      value={name}
                      onChangeText={setName}
                      style={s.input}
                      placeholder="The group chat essentials"
                      placeholderTextColor={C.muted}
                    />
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    disabled={!!busy}
                    onPress={() => pick()}
                    style={s.dropzone}
                  >
                    <View style={s.newPlus}>
                      <ImagePlus size={26} color={C.olive} />
                    </View>
                    <Label style={{ fontFamily: face.bold, color: C.ink }}>
                      Photos & GIFs
                    </Label>
                    <Label style={{ fontSize: 12 }}>Choose files</Label>
                  </Pressable>
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Button
                        secondary
                        title="Gallery"
                        icon={ImagePlus}
                        disabled={!!busy || !!video}
                        onPress={() => pick(undefined, true)}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button
                        secondary
                        title="Video"
                        icon={Zap}
                        disabled={!!busy}
                        onPress={pickVideo}
                      />
                    </View>
                  </View>
                  {video && (
                    <VideoClip
                      key={video.uri}
                      asset={video}
                      busy={!!busy}
                      onImport={importVideo}
                      onCancel={() => setVideo(null)}
                    />
                  )}
                  {Platform.OS !== "android" && (
                    <Label style={{ fontSize: 11 }}>
                      Files are uploaded for conversion.
                    </Label>
                  )}
                  {draft.length > 0 && (
                    <>
                      <Label style={{ fontFamily: face.bold }}>
                        {draft.length}{" "}
                        {draft.length === 1 ? "sticker" : "stickers"}
                      </Label>
                      <View style={s.stickerGrid}>
                        {draft.map((sticker) => (
                          <View
                            key={sticker.id}
                            style={[
                              s.stickerCell,
                              { width: mobile ? "47%" : "30%" },
                            ]}
                          >
                            <Art sticker={sticker} size={86} />
                            <NameEditor
                              value={sticker.name}
                              kind="sticker"
                              disabled={!!busy}
                              onSave={(name) =>
                                setDraft((current) =>
                                  current.map((item) =>
                                    item.id === sticker.id
                                      ? { ...item, name }
                                      : item,
                                  ),
                                )
                              }
                            />
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Remove ${sticker.name}`}
                              disabled={!!busy}
                              onPress={() =>
                                setDraft(
                                  draft.filter((s) => s.id !== sticker.id),
                                )
                              }
                              style={s.removeSticker}
                            >
                              <X size={13} color={C.ink} />
                            </Pressable>
                          </View>
                        ))}
                      </View>
                    </>
                  )}
                </>
              ) : (
                selectedPack && (
                  <>
                    <View style={s.headingRow}>
                      <Label style={{ fontFamily: face.bold, color: C.ink }}>
                        {selectedPack.stickers.length} / 30 stickers
                      </Label>
                    </View>
                    <View style={s.stickerGrid}>
                      {selectedPack.stickers.map((sticker) => (
                        <View
                          key={sticker.id}
                          style={[
                            s.stickerCell,
                            { width: mobile ? "47%" : "30%" },
                          ]}
                        >
                          <Art sticker={sticker} size={86} />
                          <NameEditor
                            value={sticker.name}
                            kind="sticker"
                            disabled={!!busy}
                            onSave={(name) =>
                              updatePack({
                                ...selectedPack,
                                stickers: selectedPack.stickers.map((item) =>
                                  item.id === sticker.id
                                    ? { ...item, name }
                                    : item,
                                ),
                              })
                            }
                          />
                          {selectedPack.stickers.length > 1 && (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Remove ${sticker.name}`}
                              disabled={!!busy}
                              onPress={() =>
                                updatePack({
                                  ...selectedPack,
                                  stickers: selectedPack.stickers.filter(
                                    (s) => s.id !== sticker.id,
                                  ),
                                })
                              }
                              style={s.removeSticker}
                            >
                              <X size={13} color={C.ink} />
                            </Pressable>
                          )}
                        </View>
                      ))}
                    </View>
                    <Button
                      secondary
                      title="Add stickers"
                      icon={Plus}
                      disabled={!!busy || !!video}
                      onPress={() => pick(selectedPack)}
                    />
                    <Button
                      secondary
                      title="Add video"
                      icon={Zap}
                      disabled={!!busy || !!video}
                      onPress={pickVideo}
                    />
                    {video && (
                      <VideoClip
                        key={video.uri}
                        asset={video}
                        busy={!!busy}
                        onImport={importVideo}
                        onCancel={() => setVideo(null)}
                      />
                    )}
                    {validatePack(selectedPack) && (
                      <Label style={{ fontSize: 12, color: C.accent }}>
                        {validatePack(selectedPack)}
                      </Label>
                    )}
                    {deleting ? (
                      <View style={{ gap: 12 }}>
                        <Label>
                          Delete pack from your library? This cannot be undone.
                        </Label>
                        <Button
                          secondary
                          title="Keep pack"
                          disabled={!!busy}
                          onPress={() => setDeleting(false)}
                        />
                        <Button
                          title="Delete pack"
                          disabled={!!busy || !!video}
                          icon={Trash2}
                          onPress={() => {
                            removePack(selectedPack.id);
                            setSelected(null);
                            setDeleting(false);
                          }}
                        />
                      </View>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        disabled={!!busy}
                        onPress={() => setDeleting(true)}
                        style={{
                          minHeight: 44,
                          justifyContent: "center",
                          alignItems: "center",
                        }}
                      >
                        <Label style={{ fontSize: 12, color: C.accent }}>
                          Delete pack
                        </Label>
                      </Pressable>
                    )}
                  </>
                )
              )}
            </ScrollView>
            <View style={s.sheetFooter}>
              {dirty && !saving && (
                <Button
                  secondary
                  title="Unsaved changes · Retry save"
                  onPress={() => void retrySave()}
                />
              )}
              {busy ? (
                <View
                  style={[s.row, { justifyContent: "center", padding: 12 }]}
                >
                  <ActivityIndicator color={C.accent} />
                  <Label>{busy}</Label>
                </View>
              ) : creating ? (
                <Button
                  title={
                    draft.length
                      ? `Save ${draft.length} ${draft.length === 1 ? "sticker" : "stickers"}`
                      : "Save sticker pack"
                  }
                  onPress={() => save()}
                  icon={Check}
                  disabled={!draft.length || !name.trim() || !!video}
                />
              ) : (
                selectedPack && (
                  <Button
                    title={
                      selectedPack.stickers.length < 3
                        ? `Add ${3 - selectedPack.stickers.length} more stickers`
                        : "Import to WhatsApp"
                    }
                    icon={MessageCircle}
                    onPress={() =>
                      selectedPack.stickers.length < 3
                        ? pick(selectedPack)
                        : exportPack(selectedPack)
                    }
                    disabled={
                      !!video ||
                      (selectedPack.stickers.length >= 3 &&
                        !!validatePack(selectedPack))
                    }
                  />
                )
              )}
            </View>
          </View>
          {(!!notice || !!error) && (
            <View style={[StyleSheet.absoluteFill, s.modalBackdrop]}>
              {noticeContent}
            </View>
          )}
        </View>
      </Modal>
      <Modal
        visible={(!!notice || !!error) && !creating && !selectedPack}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setNotice(null);
          clearError();
        }}
      >
        <View style={s.modalBackdrop}>{noticeContent}</View>
      </Modal>
    </View>
  );
}

const styleCache = new WeakMap<Colors, ReturnType<typeof createStyles>>();
function styles(colors: Colors) {
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
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 20,
      justifyContent: "space-between",
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
