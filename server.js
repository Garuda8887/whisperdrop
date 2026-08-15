import express from 'express';
import cors from 'cors';
import crypto from 'crypto';

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json({ limit: '100kb' }));

// In-memory store
const pastes = new Map();
const MAX_PASTES = 10000;
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

// Sweep pastes nobody ever picked up so the map can't grow forever
setInterval(() => {
  const now = Date.now();
  for (const [id, paste] of pastes) {
    if (now - paste.createdAt > TTL_MS) pastes.delete(id);
  }
}, 60 * 60 * 1000).unref();

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

  if (pastes.size >= MAX_PASTES) {
    return res.status(503).json({ error: 'Server at capacity, try again later' });
  }

  const id = generateId();
  pastes.set(id, { encryptedData, iv, createdAt: Date.now() });

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
  
  // BURN AFTER READING
  pastes.delete(id);
  console.log(`[INFO] Burned paste: ${id}`);

  res.json(paste);
});

// Start the server
app.listen(port, () => {
  console.log(`WhisperDrop Backend running on http://localhost:${port}`);
});
