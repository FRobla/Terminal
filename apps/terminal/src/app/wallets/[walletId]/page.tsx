import { WalletDetailView } from "../../../wallets/wallet-detail-view";

export const metadata = { title: "Wallet — Solana Corporate Terminal" };

export default async function Page(props: { params: Promise<{ walletId: string }> }) {
  const { walletId } = await props.params;
  return <WalletDetailView walletId={walletId} />;
}
