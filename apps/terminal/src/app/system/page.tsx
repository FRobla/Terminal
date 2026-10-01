import { SystemView } from "../../system/system-view";

export const metadata = { title: "System — Solana Corporate Terminal" };

export default function SystemPage() {
  return (
    <>
      <h1 className="sr-only">System</h1>
      <SystemView />
    </>
  );
}
