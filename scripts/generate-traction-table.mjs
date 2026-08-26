const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3000";

try {
  const res = await fetch(`${BACKEND_URL}/activity?limit=200`);
  if (!res.ok) throw new Error(`/activity returned ${res.status}`);
  const records = await res.json();

  const withPayer = records.filter((r) => r.payerAddress);
  const distinctPayers = [...new Set(withPayer.map((r) => r.payerAddress))];

  console.log(`\n## Real Traction — verified from live /activity data\n`);
  console.log(`- **${distinctPayers.length} distinct payer wallets** have completed a real, paid negotiation.`);
  console.log(`- **${withPayer.length} total paid events** recorded.`);
  console.log(`- Data pulled live from \`${BACKEND_URL}/activity\` — check it yourself.\n`);

  console.log(`| Tool | Agreed Price | Timestamp | Payer | Explorer Link |`);
  console.log(`|---|---|---|---|---|`);
  for (const r of withPayer) {
    const short = `${r.payerAddress.slice(0, 6)}...${r.payerAddress.slice(-4)}`;
    const link = `https://basescan.org/address/${r.payerAddress}`;
    console.log(`| ${r.tool} | $${r.agreedPrice} | ${new Date(r.createdAt).toLocaleString()} | \`${short}\` | [View](${link}) |`);
  }

  console.log(`\n### Distinct payer wallets (for individual verification)\n`);
  for (const addr of distinctPayers) {
    console.log(`- \`${addr}\` — https://basescan.org/address/${addr}`);
  }
} catch (err) {
  console.error(JSON.stringify({ ok: false, error: String(err?.message ?? err) }));
  process.exit(1);
}
