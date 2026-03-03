# x402 Express Template

Monetize any Express API with zero-gas USDC payments in under 5 minutes.

![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![Express](https://img.shields.io/badge/Express-5.x-black)
![USDC](https://img.shields.io/badge/USDC-Base%20%7C%20SKALE-blue)
![License](https://img.shields.io/badge/License-MIT-yellow)

Add `x402Paywall(0.05, 'description')` to any route. That is the entire integration.

---

## What this is

A minimal Node.js template that gates Express routes behind real on-chain USDC payments using the [x402 protocol](https://x402.org). No intermediary, no API key management, no subscription logic — just a payment header check before each request.

Designed for AI agents (Claude MCP, LangChain, Auto-GPT) that need to call paid APIs autonomously.

---

## Quick Start

**1. Clone and install**

```bash
git clone https://github.com/Wintyx57/x402-express-template.git
cd x402-express-template
npm install
```

**2. Configure your wallet**

```bash
cp .env.example .env
# Edit .env and set WALLET_ADDRESS to your Ethereum wallet
```

**3. Start the server**

```bash
npm start
# x402 API running on port 3000
```

Open `http://localhost:3000` to see all available endpoints and their prices.

---

## How it works

The x402 payment flow has three steps:

```
Agent                           Server
  |                               |
  |-- GET /uuid ----------------> |
  |                               | (no payment header)
  |<-- 402 Payment Required -----|
  |    amount: 0.02 USDC          |
  |    recipient: 0xABC...        |
  |    usdc_contract: 0x833...    |
  |                               |
  | (agent sends USDC on-chain)   |
  |                               |
  |-- GET /uuid ----------------> |
  |    X-Payment-TxHash: 0x1a2b.. |
  |    X-Payment-Chain: skale     |
  |                               | (verifies receipt on-chain)
  |<-- 200 { uuid: "..." } -------|
```

No account creation. No API keys. The transaction hash is the proof of payment.

---

## Networks

| Network      | Gas cost     | Chain ID   | USDC contract                                |
|--------------|-------------|------------|----------------------------------------------|
| SKALE Europa | FREE (sFUEL) | 2046399126 | `0x5F795bb52dAc3085f578f4877D450e2929D2F13d` |
| Base         | ~$0.001      | 8453       | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

SKALE is recommended for AI agents because gas is zero — agents do not need native tokens to operate.

---

## Add your own endpoint

Open `server.js` and add a route with the middleware:

```javascript
const { x402Paywall } = require('./x402-middleware');

// One line to add payment gating
app.get('/weather', x402Paywall(0.05, 'Get weather forecast'), async (req, res) => {
  // req.payer contains the sender's wallet address
  const data = await fetchWeather(req.query.city);
  res.json({ data, payer: req.payer });
});
```

The middleware handles:
- Returning a 402 response with full payment instructions when no header is present
- Validating the transaction hash format
- Verifying the transfer on-chain (correct contract, correct recipient, sufficient amount)
- Anti-replay protection (each tx hash can only be used once)

---

## How agents pay

An AI agent calls the endpoint, receives the 402, sends USDC, then retries with the transaction hash:

```bash
# Step 1: discover payment requirements
curl http://localhost:3000/uuid
# → 402 { payment_details: { amount: 0.02, recipient: "0x...", usdc_contract: "0x..." } }

# Step 2: send USDC on-chain (agent does this autonomously)
# txHash = 0x1a2b3c...

# Step 3: call the endpoint with proof of payment
curl http://localhost:3000/uuid \
  -H "X-Payment-TxHash: 0x1a2b3c..." \
  -H "X-Payment-Chain: skale"
# → 200 { uuid: "550e8400-e29b-41d4-a716-446655440000" }
```

---

## Deploy

**Railway**

```bash
railway login
railway init
railway up
# Set WALLET_ADDRESS and DEFAULT_CHAIN in Railway environment variables
```

**Render**

1. Create a new Web Service, connect this repo.
2. Build command: `npm install`
3. Start command: `npm start`
4. Add `WALLET_ADDRESS` and `DEFAULT_CHAIN` in the Environment tab.

**Replit**

1. Import the repo.
2. Add `WALLET_ADDRESS` to Replit Secrets.
3. Run.

---

## Production notes

The anti-replay store (`usedTxHashes`) is in-memory and resets on restart. For production deployments, replace the `BoundedSet` with a Redis set or a database table to persist used transaction hashes across restarts. The `verifyPayment` function is a pure async function — you can wrap it around any storage backend.

---

## Links

- x402 Bazaar (marketplace): [x402bazaar.org](https://x402bazaar.org)
- x402 protocol specification: [x402.org](https://x402.org)
- SKALE Europa (zero-gas chain): [skale.space](https://skale.space)
- List your API on the marketplace: `POST https://x402-api.onrender.com/api/services`
