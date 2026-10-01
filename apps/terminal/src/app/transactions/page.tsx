import { TransactionsPanel } from "../../transactions/transactions-panel";

export const metadata = { title: "Transactions — Solana Corporate Terminal" };

export default function Page() {
  return (
    <div className="space-y-3">
      <h1 className="text-[13px] font-semibold">Transactions</h1>
      <TransactionsPanel walletId={null} title="Organization transfers" />
    </div>
  );
}
