// x402-middleware.js — Core x402 payment middleware for Express
// Verifies USDC on-chain payments (Base or SKALE) before granting API access.
// No Supabase, no budget manager — pure verification logic.

'use strict';

const TX_HASH_REGEX = /^0x[a-fA-F0-9]{64}$/;
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const RPC_TIMEOUT = 10_000; // 10 seconds

const CHAINS = {
  base: {
    rpcUrl: 'https://mainnet.base.org',
    usdcContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    chainId: 8453,
    label: 'Base',
    explorer: 'https://basescan.org',
    gas: '~$0.001',
  },
  skale: {
    rpcUrl: 'https://mainnet.skalenodes.com/v1/elated-tan-skat',
    usdcContract: '0x5F795bb52dAc3085f578f4877D450e2929D2F13d',
    chainId: 2046399126,
    label: 'SKALE Europa',
    explorer: 'https://elated-tan-skat.explorer.mainnet.skalenodes.com',
    gas: 'FREE (sFUEL)',
  },
};

// --- Anti-replay cache (in-memory, bounded) ---
// In production, replace with a persistent store (Redis, DB) to survive restarts.
class BoundedSet {
  constructor(maxSize = 10_000) {
    this._maxSize = maxSize;
    this._set = new Set();
  }

  has(key) {
    return this._set.has(key);
  }

  add(key) {
    if (this._set.size >= this._maxSize) {
      // Evict the oldest entry (insertion-order)
      const oldest = this._set.values().next().value;
      this._set.delete(oldest);
    }
    this._set.add(key);
  }

  delete(key) {
    this._set.delete(key);
  }

  get size() {
    return this._set.size;
  }
}

const usedTxHashes = new BoundedSet(10_000);

// --- RPC helper ---
function fetchWithTimeout(url, options) {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('RPC timeout after 10s')), RPC_TIMEOUT)
    ),
  ]);
}

/**
 * Verify a USDC payment on-chain.
 *
 * @param {string} txHash       - 0x-prefixed 32-byte transaction hash
 * @param {number} minAmountRaw - Minimum accepted amount in USDC raw units (6 decimals)
 * @param {string} chainKey     - One of the keys in CHAINS ('base' | 'skale')
 * @returns {Promise<{ valid: boolean, from: string } | false>}
 */
async function verifyPayment(txHash, minAmountRaw, chainKey) {
  const DEFAULT_CHAIN_KEY = process.env.DEFAULT_CHAIN || 'skale';
  const chain = CHAINS[chainKey] || CHAINS[DEFAULT_CHAIN_KEY];
  const recipientAddress = (process.env.WALLET_ADDRESS || '').toLowerCase();

  const normalizedTxHash = txHash.toLowerCase().trim();

  // 1. Fetch transaction receipt from the chain RPC
  const rpcResponse = await fetchWithTimeout(chain.rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_getTransactionReceipt',
      params: [normalizedTxHash],
      id: 1,
    }),
  });

  const { result: receipt } = await rpcResponse.json();

  // 2. Transaction must exist and succeed (status 0x1)
  if (!receipt || receipt.status !== '0x1') {
    return false;
  }

  // 3. Scan ERC-20 Transfer logs
  for (const log of receipt.logs) {
    // Must be a Transfer event
    if (log.topics[0] !== TRANSFER_TOPIC) continue;
    if (log.topics.length < 3) continue;

    // Must originate from the correct USDC contract on this chain
    if (log.address.toLowerCase() !== chain.usdcContract.toLowerCase()) continue;

    // Decode indexed topics: topics[1] = from, topics[2] = to (padded to 32 bytes)
    const fromAddress = '0x' + log.topics[1].slice(26).toLowerCase();
    const toAddress = '0x' + log.topics[2].slice(26).toLowerCase();

    // Transfer must target our wallet
    if (toAddress !== recipientAddress) continue;

    // Amount must meet the minimum (log.data is the non-indexed value field)
    const amount = BigInt(log.data);
    if (amount >= BigInt(minAmountRaw)) {
      return { valid: true, from: fromAddress };
    }
  }

  return false;
}

/**
 * Express middleware factory — gates a route behind an x402 USDC payment.
 *
 * Usage:
 *   app.get('/my-endpoint', x402Paywall(0.05, 'My API description'), handler)
 *
 * @param {number} priceUsdc  - Price in USDC (e.g. 0.01)
 * @param {string} description - Human-readable label for the action
 * @returns {import('express').RequestHandler}
 */
function x402Paywall(priceUsdc, description) {
  const minAmountRaw = Math.round(priceUsdc * 1e6);
  const DEFAULT_CHAIN_KEY = process.env.DEFAULT_CHAIN || 'skale';

  return async (req, res, next) => {
    const txHash = req.headers['x-payment-txhash'];
    const chainKey = req.headers['x-payment-chain'] || DEFAULT_CHAIN_KEY;

    // Validate the requested chain
    if (!CHAINS[chainKey]) {
      return res.status(400).json({
        error: 'Invalid chain',
        message: `Unsupported chain: "${chainKey}". Accepted values: ${Object.keys(CHAINS).join(', ')}`,
      });
    }

    // No payment header — return 402 with full payment instructions
    if (!txHash) {
      return res.status(402).json({
        error: 'Payment Required',
        message: `This endpoint costs ${priceUsdc} USDC. Send the USDC transfer on-chain, then retry with the transaction hash in the X-Payment-TxHash header.`,
        payment_details: {
          amount: priceUsdc,
          currency: 'USDC',
          network: chainKey,
          recipient: process.env.WALLET_ADDRESS,
          action: description,
          networks: Object.entries(CHAINS).map(([key, c]) => ({
            network: key,
            chainId: c.chainId,
            label: c.label,
            usdc_contract: c.usdcContract,
            explorer: c.explorer,
            gas: c.gas,
          })),
        },
        headers_required: {
          'X-Payment-TxHash': '0x<your-transaction-hash>',
          'X-Payment-Chain': chainKey,
        },
      });
    }

    // Validate tx hash format
    if (!TX_HASH_REGEX.test(txHash)) {
      return res.status(400).json({
        error: 'Invalid transaction hash',
        message: 'X-Payment-TxHash must be a 0x-prefixed 64-character hex string.',
      });
    }

    // Anti-replay check
    const replayKey = `${chainKey}:${txHash.toLowerCase()}`;
    if (usedTxHashes.has(replayKey)) {
      return res.status(402).json({
        error: 'Transaction already used',
        message: 'This transaction hash has already been consumed. Please send a new payment.',
      });
    }

    // Reserve the key immediately to prevent concurrent replay attacks
    usedTxHashes.add(replayKey);

    // On-chain verification
    try {
      const result = await verifyPayment(txHash, minAmountRaw, chainKey);

      if (!result || !result.valid) {
        // Release the key so the user can retry with a valid tx
        usedTxHashes.delete(replayKey);
        return res.status(402).json({
          error: 'Payment verification failed',
          message: `Could not verify ${priceUsdc} USDC payment on ${CHAINS[chainKey].label}. Check that the transaction is confirmed and targets the correct wallet.`,
          expected: {
            recipient: process.env.WALLET_ADDRESS,
            min_amount_usdc: priceUsdc,
            chain: CHAINS[chainKey].label,
            usdc_contract: CHAINS[chainKey].usdcContract,
          },
        });
      }

      // Payment verified — attach payer address and continue
      req.payer = result.from;
      req.paymentChain = chainKey;
      req.paymentAmount = priceUsdc;
      return next();
    } catch (err) {
      // RPC error — release the key so the client can retry
      usedTxHashes.delete(replayKey);
      return res.status(502).json({
        error: 'Payment verification error',
        message: `RPC error while verifying payment: ${err.message}`,
      });
    }
  };
}

module.exports = { x402Paywall, verifyPayment, CHAINS, BoundedSet };
