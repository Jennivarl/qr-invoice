// Pay with USDC on another chain, settle as shielded ZEC.
// NEAR Intents (1Click API) gives a one-time deposit address on that chain and
// delivers ZEC to the order's shielded address. The public chain only shows
// a payment to that deposit address — not which business was paid.
const API = 'https://1click.chaindefuser.com/v0';
export const CHAINS = {
  base: { name: 'Base', asset: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', evmId: 8453 },
  eth: { name: 'Ethereum', asset: 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near', token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', evmId: 1 },
  arb: { name: 'Arbitrum', asset: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near', token: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', evmId: 42161 },
  sol: { name: 'Solana', asset: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near', token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
};

export function validRefund(chain, address) {
  return chain === 'sol' ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) : /^0x[0-9a-fA-F]{40}$/.test(address);
}

// Wallet payment request: EIP-681 on EVM chains, Solana Pay on Solana.
export function paymentUri(chain, deposit, amount, amountFormatted) {
  const c = CHAINS[chain];
  return c.evmId
    ? `ethereum:${c.token}@${c.evmId}/transfer?address=${deposit}&uint256=${amount}`
    : `solana:${deposit}?amount=${amountFormatted}&spl-token=${c.token}`;
}
const ZEC = 'nep141:zec.omft.near';

async function call(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.ONECLICK_JWT ? { Authorization: `Bearer ${process.env.ONECLICK_JWT}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = /too low/i.test(data.message || '') ? 'USDC payments need an invoice of at least 0.001 ZEC.' : data.message || `1Click ${res.status}`;
    throw Object.assign(new Error(msg), { status: 400 });
  }
  return data;
}

// Quote that delivers exactly `zat` zatoshis to `zecAddress`.
export async function usdcQuote({ chain, zat, zecAddress, refundTo }) {
  const { quote } = await call('/quote', {
    dry: false,
    swapType: 'EXACT_OUTPUT',
    slippageTolerance: 100,
    originAsset: CHAINS[chain].asset,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: ZEC,
    amount: String(zat),
    refundTo,
    refundType: 'ORIGIN_CHAIN',
    recipient: zecAddress,
    recipientType: 'DESTINATION_CHAIN',
    deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
  return {
    deposit: quote.depositAddress,
    amount: quote.amountIn,
    amountFormatted: quote.amountInFormatted,
    eta: quote.timeEstimate,
  };
}

export async function swapStatus(depositAddress) {
  const s = await call(`/status?depositAddress=${encodeURIComponent(depositAddress)}`);
  return s.status;
}
