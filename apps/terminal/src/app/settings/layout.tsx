import type { ReactNode } from "react";
import { SettingsFrame } from "../../settings/settings-frame";

export default function SettingsLayout(props: { children: ReactNode }) {
  return <SettingsFrame>{props.children}</SettingsFrame>;
}
