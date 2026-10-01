import type { CustodyType, WalletCategory, WalletRole } from "@sct/validation";

export const CATEGORY_LABELS: Record<WalletCategory, string> = {
  TREASURY: "Treasury",
  TRADING: "Trading",
  OPERATIONS: "Operations",
  DEVELOPMENT: "Development",
  TOKEN_ISSUANCE: "Token issuance",
  RESEARCH: "Research",
  COLD_STORAGE: "Cold storage",
  WATCH_ONLY: "Watch-only",
};

export const CUSTODY_LABELS: Record<CustodyType, string> = {
  BROWSER_WALLET: "Browser wallet",
  LOCAL_ENCRYPTED: "Local encrypted",
  WATCH_ONLY: "Watch-only",
};

export const ROLE_LABELS: Record<WalletRole, string> = {
  CREATOR: "Creator",
  FUNDER: "Funder",
  CONTROLLER: "Controller",
  VIEWER: "Viewer",
};
