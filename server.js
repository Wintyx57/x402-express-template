// server.js — x402 Express Template
// Demonstrates how to gate any Express route behind a USDC micropayment.

'use strict';

require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { x402Paywall, CHAINS } = require('./x402-middleware');

const app = express();
app.use(express.json());

// --- Startup validation ---
const WALLET = process.env.WALLET_ADDRESS;
if (!WALLET || !/^0x[a-fA-F0-9]{40}$/.test(WALLET)) {
  console.error('[x402] ERROR: WALLET_ADDRESS is missing or invalid in .env');
  console.error('[x402]   Expected format: 0x followed by 40 hex characters');
  process.exit(1);
}

const DEFAULT_CHAIN = process.env.DEFAULT_CHAIN || 'skale';
console.log(`[x402] Wallet  : ${WALLET}`);
console.log(`[x402] Chain   : ${DEFAULT_CHAIN}`);

// ---------------------------------------------------------------------------
// Paid endpoints — add x402Paywall(price, label) before your handler
// ---------------------------------------------------------------------------

// Example 1: Hello World (0.01 USDC)
app.get('/hello', x402Paywall(0.01, 'Hello World'), (req, res) => {
  res.json({
    message: 'Hello, AI Agent! You paid 0.01 USDC for this response.',
    payer: req.payer,
    chain: req.paymentChain,
  });
});

// Example 2: Generate UUID (0.02 USDC)
app.get('/uuid', x402Paywall(0.02, 'Generate UUID'), (req, res) => {
  res.json({
    uuid: crypto.randomUUID(),
    payer: req.payer,
  });
});

// Example 3: Current timestamp (0.01 USDC)
app.get('/timestamp', x402Paywall(0.01, 'Get timestamp'), (req, res) => {
  res.json({
    iso: new Date().toISOString(),
    unix: Date.now(),
    payer: req.payer,
  });
});

// ---------------------------------------------------------------------------
// Free endpoints
// ---------------------------------------------------------------------------

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', wallet: WALLET, chain: DEFAULT_CHAIN });
});

// API index — lists all paid endpoints with their prices
app.get('/', (_req, res) => {
  res.json({
    name: 'x402 Express Template',
    description: 'Pay-per-call API with USDC micropayments via x402 protocol',
    wallet: WALLET,
    defaultChain: DEFAULT_CHAIN,
    endpoints: [
      { path: '/hello',     method: 'GET', price: '0.01 USDC', description: 'Hello World' },
      { path: '/uuid',      method: 'GET', price: '0.02 USDC', description: 'Generate UUID' },
      { path: '/timestamp', method: 'GET', price: '0.01 USDC', description: 'Current timestamp' },
    ],
    networks: Object.entries(CHAINS).map(([key, c]) => ({
      network: key,
      label: c.label,
      chainId: c.chainId,
      usdc_contract: c.usdcContract,
      gas: c.gas,
    })),
    docs: 'https://github.com/Wintyx57/x402-express-template',
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT, 10) || 3000;
app.listen(PORT, () => {
  console.log(`[x402] Server running on port ${PORT}`);
  console.log(`[x402] GET http://localhost:${PORT}/ — API index`);
});
