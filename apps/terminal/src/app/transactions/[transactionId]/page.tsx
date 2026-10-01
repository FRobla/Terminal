import { TransactionDetailView } from "../../../transactions/transaction-detail-view";

export const metadata = { title: "Transaction — Solana Corporate Terminal" };

export default async function Page(props: { params: Promise<{ transactionId: string }> }) {
  const { transactionId } = await props.params;
  return <TransactionDetailView transactionId={transactionId} />;
}
