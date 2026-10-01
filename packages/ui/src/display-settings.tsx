"use client";

import { createContext, useContext, type ReactNode } from "react";
import { formatTimestamp, type TimeZoneMode } from "./timestamp";

/** Presentation settings that shared components honor (SPEC-025 preferences). */
export interface DisplaySettings {
  timeZone: TimeZoneMode;
  addressDisplay: "short" | "full";
  /** Name of the block explorer that address and signature links open. */
  explorerName: string;
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  timeZone: "local",
  addressDisplay: "short",
  explorerName: "Solana Explorer",
};

const DisplaySettingsContext = createContext<DisplaySettings>(DEFAULT_DISPLAY_SETTINGS);

export function DisplaySettingsProvider(props: { value: DisplaySettings; children: ReactNode }) {
  return (
    <DisplaySettingsContext.Provider value={props.value}>{props.children}</DisplaySettingsContext.Provider>
  );
}

export function useDisplaySettings(): DisplaySettings {
  return useContext(DisplaySettingsContext);
}

/** Absolute time in the user's selected zone; the exact ISO value stays available on hover and to machines. */
export function Timestamp(props: { value: string; className?: string }) {
  const { timeZone } = useDisplaySettings();
  return (
    <time dateTime={props.value} title={props.value} className={props.className}>
      {formatTimestamp(props.value, timeZone)}
    </time>
  );
}
