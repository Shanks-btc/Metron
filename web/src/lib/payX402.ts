// Real x402 payment on Base mainnet, replacing the earlier BOT Chain
// direct-wallet-to-contract escrow flow entirely. BOT Chain had no
// facilitator, so the buyer's wallet called a custom escrow contract
// directly (approve() then openDeal()) and a separate listener process
// released funds later. x402 on Base settles through Coinbase's hosted
// facilitator instead: the buyer's wallet signs one EIP-3009 payment
// authorization (a typed-data signature, not an on-chain transaction), and
// a single gated fetch to GET /pay/:id both pays and delivers the data in
// one HTTP round trip - no escrow contract, no separate fulfillment step.
//
// The v2 x402 SDK's client-side signer (ClientEvmSigner) is a minimal
// duck-typed interface - just { address, signTypedData(...) } - so the
// existing injected-wallet viem WalletClient (same custom(eth) pattern the
// old BOT Chain build already used) satisfies it directly; no MetaMask-
// specific rewrite needed for the signing step itself.

import { createWalletClient, custom, type Address } from "viem";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import type { ClientEvmSigner } from "@x402/evm";

// Overridable to Base Sepolia (NEXT_PUBLIC_X402_NETWORK=eip155:84532,
// NEXT_PUBLIC_X402_USDC_ADDRESS=0x036C...) for live pre-mainnet payment
// testing, mirroring src/server.ts's X402_NETWORK/X402_USDC_ADDRESS -
// without this, the client registers ExactEvmScheme for mainnet only and
// rejects a Sepolia-configured server's payment requirements outright
// ("No network/scheme registered..."), confirmed by a real failed browser
// test run. Next.js requires the NEXT_PUBLIC_ prefix to inline an env var
// into the client bundle at build time. Defaults to mainnet, so no env
// change means no behavior change.
export const BASE_NETWORK = (process.env.NEXT_PUBLIC_X402_NETWORK ?? "eip155:8453") as `${string}:${string}`;
// Derived from BASE_NETWORK's CAIP-2 id rather than a third env var to keep
// in sync automatically - a CAIP-2 EVM network id is always "eip155:<chainId>".
export const BASE_CHAIN_ID = Number(BASE_NETWORK.split(":")[1]);
export const BASE_CHAIN_ID_HEX = `0x${BASE_CHAIN_ID.toString(16)}`;
export const BASE_EXPLORER_URL = "https://basescan.org";
// Real, canonical USDC for whichever network above is active (Base mainnet
// by default; Base Sepolia test USDC when overridden) - matches the same
// constant the backend gates payment against (src/server.ts).
export const BASE_USDC_ADDRESS = (process.env.NEXT_PUBLIC_X402_USDC_ADDRESS ?? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") as Address;

export interface PayX402Params {
  /** Absolute URL of the quote's payable resource, e.g. `${API_ORIGIN}/pay/${quoteId}`. */
  payUrl: string;
}

export interface PayX402Result {
  buyer: string;
  /** Real payer address from the facilitator's settle response, or the connected wallet if unavailable. */
  payerAddress: string;
  /** Real settlement transaction hash from the facilitator's settle response, when present. */
  transactionHash: string | null;
  /** The paid resource's own JSON body - see GET /pay/:id's success shape in src/server.ts. */
  responseBody: {
    message: string;
    tool: string;
    agreedPrice: number;
    data: unknown;
    negotiationId: string;
    round: number;
    payerAddress: string | null;
  };
}

// Real-world bug fix carried over from the BOT Chain build (web/src/lib's
// prior walletPay.ts): MetaMask does not reliably set `code: 4902` (the
// spec-compliant EIP-3085 signal) when wallet_switchEthereumChain is called
// for a chain the wallet has never seen before - what actually comes back
// is a generic error whose *message* says something like `Unrecognized
// chain ID "0x2105". Try adding the chain using wallet_addEthereumChain
// first.`, without a matching top-level .code. This checks the code where
// it IS present, and otherwise falls back to matching the telltale
// "unrecognized chain" wording in the message.
export function isUnrecognizedChainError(err: any): boolean {
  if (err?.code === 4902 || err?.cause?.code === 4902) return true;
  const message: string = String(err?.message ?? err?.cause?.message ?? "");
  return /unrecognized chain/i.test(message);
}

// Same diagnosed-root-cause reasoning as the old ensureBotChainTestnet:
// viem clients built on custom(eth) (an injected wallet's provider) have no
// chain enforcement of their own - every read/write silently targets
// whatever network the wallet currently has active. Must run before
// signing any payment authorization.
export async function ensureBaseMainnet(eth: any, onProgress?: (message: string) => void | Promise<void>): Promise<void> {
  const currentChainIdHex: string = await eth.request({ method: "eth_chainId" });
  if (parseInt(currentChainIdHex, 16) === BASE_CHAIN_ID) {
    return;
  }

  await onProgress?.("> Wallet is on the wrong network - requesting switch to Base...");

  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_CHAIN_ID_HEX }] });
  } catch (switchError: any) {
    if (isUnrecognizedChainError(switchError)) {
      await onProgress?.("> Base not found in wallet - adding it now...");
      try {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: BASE_CHAIN_ID_HEX,
              chainName: "Base",
              nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
              rpcUrls: ["https://mainnet.base.org"],
              blockExplorerUrls: [BASE_EXPLORER_URL],
            },
          ],
        });
      } catch (addError: any) {
        if (addError?.code === 4001) {
          throw new Error("Adding Base was declined in wallet - it is required to pay.");
        }
        throw new Error(addError?.shortMessage ?? addError?.message ?? "Could not add Base to your wallet.");
      }

      // wallet_addEthereumChain normally also switches to the newly-added
      // chain on success, but that's not guaranteed for every wallet
      // implementation - explicitly retry the switch rather than assume it.
      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_CHAIN_ID_HEX }] });
      } catch (retrySwitchError: any) {
        if (retrySwitchError?.code === 4001) {
          throw new Error("Network switch declined in wallet - Base is required to pay.");
        }
        throw new Error(
          retrySwitchError?.shortMessage ?? retrySwitchError?.message ?? "Could not switch your wallet to Base after adding it."
        );
      }
    } else if (switchError?.code === 4001) {
      throw new Error("Network switch declined in wallet - Base is required to pay.");
    } else {
      throw new Error(switchError?.shortMessage ?? switchError?.message ?? "Could not switch your wallet to Base.");
    }
  }

  const confirmedChainIdHex: string = await eth.request({ method: "eth_chainId" });
  if (parseInt(confirmedChainIdHex, 16) !== BASE_CHAIN_ID) {
    throw new Error("Wallet is still not on Base - please switch networks manually and try again.");
  }

  await onProgress?.("> Switched to Base.");
}

export async function payWithWallet(
  params: PayX402Params,
  onProgress?: (message: string) => void | Promise<void>
): Promise<PayX402Result> {
  const eth = (window as any).ethereum;
  if (!eth) {
    throw new Error("Install MetaMask (or a compatible wallet) to pay.");
  }

  const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
  const buyer = accounts[0];
  if (!buyer) {
    throw new Error("No wallet account available.");
  }

  await ensureBaseMainnet(eth, onProgress);

  const walletClient = createWalletClient({ account: buyer as Address, transport: custom(eth) });

  // Minimal duck-typed adapter: ClientEvmSigner only requires `address` and
  // `signTypedData`, both satisfied directly by the injected wallet's own
  // viem WalletClient - no raw private key ever touches this code.
  const signer: ClientEvmSigner = {
    address: buyer as `0x${string}`,
    signTypedData: (message: Parameters<ClientEvmSigner["signTypedData"]>[0]) =>
      walletClient.signTypedData({ account: buyer as Address, ...(message as any) }),
  };

  const client = new x402Client().register(BASE_NETWORK, new ExactEvmScheme(signer));
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  await onProgress?.(`> Signing payment authorization (${BASE_NETWORK}, USDC)...`);

  let res: Response;
  try {
    res = await fetchWithPayment(params.payUrl);
  } catch (err: any) {
    throw new Error(err?.message ?? "Payment failed.");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as any);
    throw new Error(body?.error ?? `Payment failed with HTTP ${res.status}.`);
  }

  // Decoded via the SDK's own client, not hand-rolled base64/JSON parsing -
  // PAYMENT-RESPONSE's exact encoding is an SDK implementation detail this
  // code shouldn't need to know.
  const httpClient = new x402HTTPClient(client);
  let transactionHash: string | null = null;
  let payerAddress = buyer;
  try {
    const settleResponse = httpClient.getPaymentSettleResponse((name) => res.headers.get(name));
    transactionHash = settleResponse.transaction ?? null;
    payerAddress = settleResponse.payer ?? buyer;
  } catch {
    // PAYMENT-RESPONSE missing/unparseable - payment still succeeded (res.ok
    // above already confirmed that), just without a tx hash to show.
  }

  const responseBody = await res.json();

  await onProgress?.(transactionHash ? `> Settled on Base. tx: ${transactionHash}` : "> Settled on Base.");

  return { buyer, payerAddress, transactionHash, responseBody };
}
