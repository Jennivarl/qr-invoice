# QR Invoice

**Your wallet is your bank statement. Stop publishing it.**

Private invoice links for crypto freelancers, anon devs and contributors. DAOs,
protocols and clients pay in shielded ZEC — or USDC from Base, Ethereum,
Arbitrum or Solana. You always receive **shielded ZEC**, the invoice confirms
itself, and block explorers, wallet trackers and your next client can't see who pays you or how
much you make.

**Live demo:** https://164-92-130-154.sslip.io

Built for Zecathon 2026 — Shielded Payments track.

## Why
Get paid from a DAO treasury and it's on Etherscan forever: who paid you, how
much, how often, and every wallet you move it to. Wallet trackers label you, your
anon handle gets linked to your income, clients see your rates, and anyone
hunting for a target sees your balance. Zcash hides sender, receiver, amount and
memo at the protocol level — QR Invoice is the everyday part on top: an invoice
link a contributor can send today.

## Features
- **Private invoice links** — each invoice gets its own shielded address and a ZIP 321 payment request (QR + "Open in wallet"). Works with Zodl and any shielded wallet.
- **Pay with USDC, settle shielded** — DAOs, clients or agents pay USDC on Base, Ethereum, Arbitrum or Solana to a one-time NEAR Intents deposit address; it's swapped and delivered as ZEC straight to the invoice's shielded address. Onchain it looks like a payment to a throwaway address, not to you.
- **Confirms itself** — the server watches the chain with a viewing key and marks the invoice paid once it's mined. Real mainnet payments, all shielded pools (Sapling, Orchard, Ironwood).
- **Server can't spend** — initialised from a Unified Full Viewing Key. Your seed never touches it.
- **Unlinkable clients** — a fresh diversified address per invoice, so one client can't be tied to another.
- **"What the public sees"** — the same invoice from your view, the Zcash public view (nothing), and a transparent chain's view (everything).
- **Recurring invoices** — retainers/subscriptions; each cycle issues a fresh private invoice. Nothing is pulled from the client's wallet.
- **Accountant export** — one-click CSV. Private from the world, not from the taxman.
- **One-line embed** — `<script src=".../button.js" data-label="Contract review call" data-amount="0.001"></script>` adds a pop-up private checkout to any site.

## How it works
```
 ZEC wallet ──(shielded tx)──────▶ Zcash ◀──compact blocks── lightwalletd
 USDC (any chain) ─▶ NEAR Intents ─ZEC─▶ ▲
                                                              │
   checkout page ◀── Paid ✓ ── Node server ◀── trial-decrypt with UFVK
                                    │            (zcash-devtool / librustzcash)
                                    └─ new diversified address per order
```
1. **Invoice created** — the server asks the view-only wallet for a new diversified shielded address and builds a ZIP 321 URI with amount and memo.
2. **Client pays** from any shielded wallet — or in USDC on Base, Ethereum, Arbitrum or Solana, which NEAR Intents (1Click API) swaps and delivers as ZEC to that same shielded address.
3. **Detection** — every ~15s the server syncs compact blocks from a public lightwalletd (`zec.rocks`) and trial-decrypts them with the viewing key. Notes received on an order's address in any shielded pool (Sapling, Orchard, Ironwood) mark it paid (partial payments are tracked).
4. Invoice page, dashboard, recurring invoices and the embed update live.

## Run it
Requires Docker.

```sh
docker build -t qr-invoice .
docker run -p 3000:3000 -v $PWD/data:/data \
  -e MERCHANT_UFVK="uview1..." \
  qr-invoice
```
Open http://localhost:3000.

| Env | Default | |
|---|---|---|
| `MERCHANT_UFVK` | — | Merchant's Unified Full Viewing Key (required on first boot) |
| `WALLET_BIRTHDAY` | current height | Block height to scan from |
| `LWD_SERVER` | `zecrocks` | lightwalletd server (`zecrocks`, `ywallet` or `host:port`) |
| `SYNC_EVERY_MS` | `15000` | How often to check the chain |
| `PUBLIC_URL` | request host | Base URL for payment links |
| `ONECLICK_JWT` | — | Optional NEAR Intents 1Click API key |

### Getting a viewing key
Any wallet that exports a UFVK works. With zcash-devtool:
```sh
zcash-devtool wallet -w ./merchant init --name shop -i ./identity.txt -n main
zcash-devtool wallet -w ./merchant list-accounts   # prints the UFVK
```
Keep `./merchant` and `identity.txt` offline — that's your spending wallet.

## Stack
Node.js (Express, node:sqlite) · NEAR Intents 1Click · zcash-devtool (librustzcash, zcash_client_sqlite) · lightwalletd · Sapling, Orchard & Ironwood shielded pools.

## License
MIT
