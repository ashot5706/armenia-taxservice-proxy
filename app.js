/**
 * Simple Node.js app that forwards requests to Tax Service ECRM endpoints.
 *
 * Usage:
 *  - put client cert/key/ca paths in .env (see README below)
 *  - npm install
 *  - npm start
 *
 */

require('dotenv').config();
const fs = require('fs');
const https = require('https');
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { HttpBadRequestError, HttpError, HttpUnauthorizedError } = require('./errors/HttpErrors');

const TAX_REGIMES = {
  VAT_TAXABLE: 1,
  NON_VAT_TAXABLE: 2,
  TURNOVER_TAX: 3,
  MICRO_BUSINESS: 7
}

// Config from env
const TAXSERVICE_BASE_URL = process.env.TAXSERVICE_BASE_URL || 'https://ecrm.taxservice.am/taxsystem-rs-vcr';
const CLIENT_CERT_PATH = process.env.CLIENT_CERT_PATH; // PEM cert (client)
const CLIENT_KEY_PATH = process.env.CLIENT_KEY_PATH;   // PEM key (client)
const CLIENT_KEY_PASSPHRASE = process.env.CLIENT_KEY_PASSPHRASE || ''; // optional passphrase for PEM key
const CLIENT_P12_PATH = process.env.CLIENT_P12_PATH;   // alternative: PKCS#12 file
const CLIENT_P12_PASSPHRASE = process.env.CLIENT_P12_PASSPHRASE || '';
const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS || '20000', 10);
const CRN = process.env.CRN;
const TIN = process.env.TIN;
const AUTH_TOKEN = process.env.AUTH_TOKEN; // Optional auth token to restrict access to this proxy
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN; // Optional Telegram bot token for notifications
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID; // Optional Telegram channel ID for notifications

if (!CRN) {
  throw new Error('CRN environment variable is required');
}

async function storeReceipt(receipt, returnReceiptId = null) {
  const id = receipt.receiptId;
  fs.writeFileSync(`./receipts/receipt_${id}_${Date.now()}.json`, JSON.stringify(receipt, null, 2));

  const message = returnReceiptId ? `New return receipt stored for receiptId: ${returnReceiptId}` : `New receipt stored:`;
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHANNEL_ID) {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHANNEL_ID,
      text: `${message}\n\`\`\`json\n${JSON.stringify(receipt, null, 2)}\n\`\`\``,
      parse_mode: 'Markdown'
    });
  }
}

// Build HTTPS agent (mutual TLS)
function buildAgent() {
  // If PKCS12 specified, load as pfx
  if (CLIENT_P12_PATH) {
    return new https.Agent({
      pfx: fs.readFileSync(CLIENT_P12_PATH),
      passphrase: CLIENT_P12_PASSPHRASE,
      // ca: fs.readFileSync(CA_CERT_PATH), // Tax Service CA root
      keepAlive: true,
      rejectUnauthorized: true
    });
  }

  // Otherwise use PEM cert and key
  if (!CLIENT_CERT_PATH || !CLIENT_KEY_PATH) {
    throw new Error('Client cert/key not provided. Set CLIENT_CERT_PATH and CLIENT_KEY_PATH or use CLIENT_P12_PATH.');
  }

  const cert = fs.readFileSync(CLIENT_CERT_PATH);
  const key = fs.readFileSync(CLIENT_KEY_PATH);

  return new https.Agent({
    cert,
    key,
    /**
     * There are issues with some CA chains.
     * But as server's certificate is properly signed by GlobalSign root,
     * it works fine without this.
     */
    // ca: fs.readFileSync(CA_CERT_PATH), 
    keepAlive: true,
    rejectUnauthorized: true,
    ...(CLIENT_KEY_PASSPHRASE ? { passphrase: CLIENT_KEY_PASSPHRASE } : {})
  });
}

let httpsAgent;
try {
  httpsAgent = buildAgent();
} catch (err) {
  console.error('Failed to build HTTPS agent:', err.message);
  process.exit(1);
}

// Axios instance to call Tax Service
const taxAxios = axios.create({
  baseURL: TAXSERVICE_BASE_URL,
  httpsAgent,
  timeout: REQUEST_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json'
  }
});

let seqGlobal = 1;
taxAxios.interceptors.request.use(config => {
  if (!config.data) {
    config.data = {};
  }
  config.data.crn = CRN;
  config.data.seq = seqGlobal++;

  if (seqGlobal > 9999) {
    seqGlobal = 1;
    httpsAgent.destroy(); // reset connection to avoid seq reuse on same connection
    httpsAgent = buildAgent();
    taxAxios.defaults.httpsAgent = httpsAgent;
  }

  return config;
}, error => {
  return Promise.reject(error);
});


const app = express();
app.use(bodyParser.json({ limit: '1mb' }));

if (AUTH_TOKEN) {
  app.use((req, _res, next) => {
    let token = req.header('Authorization') ||  '';
    token = token.replace('Bearer ', '').trim();
    if (token !== AUTH_TOKEN) {
      throw new HttpUnauthorizedError('Invalid or missing Authorization token');
    }
    next();
  });
}

// Routes
app.get('/', (_, res) => {
  res.json({
    message: 'Armenia Tax Service proxy - supports checkConnection, activate, configureDepartments, getGoodList, print, printCopy, getReturnedReceiptInfo, printReturnReceipt',
    taxServiceBase: TAXSERVICE_BASE_URL
  });
});

app.post('/checkConnection', async (req, res) => {
  const language = req.header('language');

  const data = await taxAxios.post('/api/v1.0/checkConnection', {}, {
    headers: language ? { 'language': language } : {}
  }).then(response => response.data);

  res.json(data);
});

app.post('/activate', async (req, res) => {
  const language = req.header('language');
  
  const data = await taxAxios.post('/api/v1.0/activate', {}, {
    headers: language ? { 'language': language } : {}
  }).then(response => response.data);

  res.json(data);
});

app.post('/configureDepartments', async (req, res) => {
  const language = req.header('language');
  const body = req.body;

  const data = await taxAxios.post('/api/v1.0/configureDepartments', body, {
    headers: language ? { 'language': language } : {}
  }).then(response => response.data);

  res.json(data);
});

app.post('/getGoodList', async (req, res) => {
  const language = req.header('language');
  const body = {
    tin: TIN,
    taxRegime: TAX_REGIMES.TURNOVER_TAX,
    ...req.body,
  };

  const data = await taxAxios.post('/api/v1.0/getGoodList', body, {
    headers: language ? { 'language': language } : {}
  }).then(response => response.data);

  res.json(data);
});

app.post('/print', async (req, res) => {
  const language = req.header('language');
  const body = req.body;

  const data = await taxAxios.post('/api/v1.0/print', body, {
    headers: language ? { 'language': language } : {}
  }).then(response => response.data);

  storeReceipt(data.result).catch(err => {
    console.error('Failed to store receipt:', err);
    console.log('Receipt data:', JSON.stringify(data, null, 2));
  });

  res.json(data);
});

app.post('/printCopy', async (req, res) => {
  const language = req.header('language');
  const body = req.body;

  if (!body.receiptId) {
    throw new HttpBadRequestError('Missing required field: receiptId'); 
  }

  const data = await taxAxios.post('/api/v1.0/printCopy', body, {
    headers: language ? { 'language': language } : {}
  }).then(response => response.data);

  res.json(data);
});

app.post('/getReturnedReceiptInfo', async (req, res) => {
  const language = req.header('language');
  const body = req.body;

  if (!body.receiptId) {
    throw new HttpBadRequestError('Missing required field: receiptId'); 
  }

  const data = await taxAxios.post('/api/v1.0/getReturnedReceiptInfo', body, {
    headers: language ? { 'language': language } : {}
  }).then(response => response.data);

  res.json(data);
});

app.post('/printReturnReceipt', async (req, res) => {
  const language = req.header('language');
  const body = req.body;

  if (!body.receiptId) {
    throw new HttpBadRequestError('Missing required field: receiptId'); 
  }

  const data = await taxAxios.post('/api/v1.0/printReturnReceipt', body, {
    headers: language ? { 'language': language } : {}
  }).then(response => response.data);

  storeReceipt(data.result, body.receiptId).catch(err => {
    console.error('Failed to store return receipt:', err);
    console.log('Return receipt data:', JSON.stringify(data, null, 2));
  });

  res.json(data);
});

// Health-check
app.get('/healthz', (req, res) => {
  res.json({ ok: true, env: process.env.NODE_ENV || 'development' });
});

app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({
      code: err.statusCode,
      message: err.name,
      errorMessage: err.message,
      result: null
    });
    return;
  }
  console.error('Unexpected error:', err);
  res.status(500).json({
    code: 500,
    message: 'INTERNAL_SERVER_ERROR',
    errorMessage: 'An unexpected error occurred',
    result: null
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Tax Service proxy listening on http://localhost:${PORT}`);
  console.log(`Forwarding to Tax Service base URL: ${TAXSERVICE_BASE_URL}`);
});
