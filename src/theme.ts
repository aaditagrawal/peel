import { useSyncExternalStore } from "react";
import { useColorScheme } from "react-native";
import { readTheme, writeTheme } from "./theme-storage";

export type ThemeChoice = "system" | "light" | "dark";
export const lightColors = {
  bg: "#F8F7F2",
  ink: "#292D25",
  muted: "#72746A",
  line: "#E5E5DB",
  accent: "#576BFF",
  olive: "#636F42",
  soft: "#ECEEE3",
  surface: "#FFFEFA",
  input: "#FFFFFF",
  inverse: "#FFFFFF",
  onAccent: "#FFFFFF",
  accentSoft: "#E9ECFF",
  border: "#B8BCA4",
};
export type Colors = typeof lightColors;
const darkColors: Colors = {
  bg: "#191C18",
  ink: "#F4F3EB",
  muted: "#B0B3A8",
  line: "#393E34",
  accent: "#576BFF",
  olive: "#BBCB94",
  soft: "#2C3227",
  surface: "#23271F",
  input: "#20241D",
  inverse: "#191C18",
  onAccent: "#FFFFFF",
  accentSoft: "#282E53",
  border: "#69725B",
};
let state: { choice: ThemeChoice; ready: boolean; error: string | null } = {
  choice: "system",
  ready: false,
  error: null,
};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
let started = false;
let writes = Promise.resolve();
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!started) {
    started = true;
    void readTheme()
      .then((choice) => {
        state = {
          choice: choice === "light" || choice === "dark" ? choice : "system",
          ready: true,
          error: null,
        };
        emit();
      })
      .catch(() => {
        state = {
          ...state,
          ready: true,
          error: "Couldn’t load appearance. Choose a theme to save it again.",
        };
        emit();
      });
  }
  return () => {
    listeners.delete(listener);
  };
}
export function setTheme(choice: ThemeChoice) {
  if (!state.ready) return;
  state = { choice, ready: true, error: null };
  emit();
  writes = writes
    .then(() => writeTheme(choice))
    .catch(() => {
      state = {
        ...state,
        error: "Couldn’t save appearance. Tap your theme to retry.",
      };
      emit();
    });
}
export function useTheme() {
  const preferences = useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
  const system = useColorScheme();
  const dark =
    preferences.choice === "dark" ||
    (preferences.choice === "system" && system === "dark");
  return {
    ...preferences,
    dark,
    colors: dark ? darkColors : lightColors,
    setTheme,
  };
}
