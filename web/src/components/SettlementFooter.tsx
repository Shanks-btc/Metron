function truncateAddress(address: string): string {
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

// Base mainnet only - no testnet/mainnet toggle needed, unlike the old BOT
// Chain build. `network` (server.ts's real CAIP-2 id, "eip155:8453") is
// still accepted as a prop so this component only renders once /pricing has
// actually resolved, but the label itself is fixed rather than derived from
// it.
const CHAIN_LABEL = "Base";
const EXPLORER_URL = "https://basescan.org";

export default function SettlementFooter({
  sellerAddress,
  network,
}: {
  sellerAddress: string | null;
  network: string | null;
}) {
  if (!sellerAddress || !network) {
    return null;
  }

  const explorerUrl = `${EXPLORER_URL}/address/${sellerAddress}`;

  return (
    <footer className="w-full border-t border-subtle px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col items-center gap-2 text-center">
        <p className="min-w-0 break-words text-xs text-ink-label">
          Settled on {CHAIN_LABEL} · Seller{" "}
          <span title={sellerAddress} className="font-medium text-ink-body">
            {truncateAddress(sellerAddress)}
          </span>
        </p>
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 break-words text-xs font-medium text-accent-light underline underline-offset-2 transition-colors hover:text-ink-heading"
        >
          Verify seller activity on Basescan →
        </a>
      </div>
    </footer>
  );
}
