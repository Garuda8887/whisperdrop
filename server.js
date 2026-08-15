import express from 'express';
import cors from 'cors';
import crypto from 'crypto';

const app = express();
const port = 3000;

app.use(cors());
// Client advertises a 10MB file limit; base64(file) + JSON wrapping + AES-GCM
// + base64(ciphertext) inflates that ~1.78x, so the body limit needs headroom.
app.use(express.json({ limit: '20mb' }));

// In-memory store
const pastes = new Map();
const MAX_PASTES = 10000;
// Hard cap on total stored bytes, not just paste count, since a single
// paste can now be up to ~20MB — count alone can't bound memory anymore.
const MAX_TOTAL_BYTES = 500 * 1024 * 1024; // 500MB
let totalBytes = 0;

function removePaste(id) {
  const paste = pastes.get(id);
  if (!paste) return;
  totalBytes -= paste.size;
  pastes.delete(id);
}

// Sweep pastes nobody ever picked up so the map can't grow forever
setInterval(() => {
  const now = Date.now();
  for (const [id, paste] of pastes) {
    if (now > paste.expiresAt) removePaste(id);
  }
}, 5 * 60 * 1000).unref();

// Generate a random ID
function generateId() {
  return crypto.randomBytes(16).toString('hex');
}

// Create a new encrypted paste
app.post('/api/pastes', (req, res) => {
  const { encryptedData, iv } = req.body;

  if (typeof encryptedData !== 'string' || typeof iv !== 'string' || !encryptedData || !iv) {
    return res.status(400).json({ error: 'Missing encrypted data or IV' });
  }

  const size = encryptedData.length + iv.length;

  if (pastes.size >= MAX_PASTES || totalBytes + size > MAX_TOTAL_BYTES) {
    return res.status(503).json({ error: 'Server at capacity, try again later' });
  }

  const id = generateId();
  // Default to 24 hours if no TTL provided, cap at 7 days max
  const maxTtl = 7 * 24 * 60 * 60 * 1000;
  const oneDay = 24 * 60 * 60 * 1000;
  const requestedTtl = Number(req.body.ttl);
  const validTtl = Number.isFinite(requestedTtl) && requestedTtl > 0 ? requestedTtl : oneDay;
  const ttl = Math.min(validTtl, maxTtl);
  const expiresAt = Date.now() + ttl;

  pastes.set(id, { encryptedData, iv, expiresAt, size });
  totalBytes += size;

  console.log(`[INFO] Created new paste: ${id}`);
  res.status(201).json({ id });
});

// Retrieve and burn a paste
app.get('/api/pastes/:id', (req, res) => {
  const { id } = req.params;
  
  if (!pastes.has(id)) {
    return res.status(404).json({ error: 'Paste not found or already burned' });
  }

  const paste = pastes.get(id);
  
  if (Date.now() > paste.expiresAt) {
    removePaste(id);
    return res.status(404).json({ error: 'Paste expired' });
  }

  // BURN AFTER READING
  removePaste(id);
  console.log(`[INFO] Burned paste: ${id}`);

  res.json({ encryptedData: paste.encryptedData, iv: paste.iv });
});

// Start the server
app.listen(port, () => {
  console.log(`WhisperDrop Backend running on http://localhost:${port}`);
});
