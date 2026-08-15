const API_URL = 'http://localhost:3000/api/pastes';

// --- Utility Functions for Crypto ---

// Convert ArrayBuffer to Base64: sync loop for small buffers (IV, keys),
// FileReader for large ones (files) to avoid call-stack limits.
async function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 65536) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  const blob = new Blob([buffer]);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Convert Base64 to ArrayBuffer using native fetch
async function base64ToBuffer(base64) {
  const res = await fetch(`data:application/octet-stream;base64,${base64}`);
  return await res.arrayBuffer();
}

// Generate AES-GCM Key
async function generateKey() {
  return await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

// Export Key to Base64
async function exportKey(key) {
  const exported = await crypto.subtle.exportKey("raw", key);
  return await bufferToBase64(exported);
}

// Import Key from Base64
async function importKey(base64Key) {
  const keyBuffer = await base64ToBuffer(base64Key);
  return await crypto.subtle.importKey(
    "raw",
    keyBuffer,
    "AES-GCM",
    true,
    ["encrypt", "decrypt"]
  );
}

// Encrypt Text
async function encryptText(text, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedText = new TextEncoder().encode(text);
  
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    encodedText
  );

  return {
    iv: await bufferToBase64(iv),
    encryptedData: await bufferToBase64(ciphertext)
  };
}

// Decrypt Text
async function decryptText(encryptedData, ivBase64, key) {
  const iv = await base64ToBuffer(ivBase64);
  const data = await base64ToBuffer(encryptedData);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv) },
    key,
    data
  );

  return new TextDecoder().decode(decrypted);
}

// --- App Logic ---

const mainContent = document.getElementById('main-content');

// UI for Creating a Paste
function renderCreateView() {
  mainContent.innerHTML = `
    <div class="create-container">
      <textarea id="secret-text" placeholder="Type your secret message here..."></textarea>
      
      <div class="options-row">
        <div class="file-upload">
          <label for="file-input" class="file-label">📎 Attach a file (Max 10MB)</label>
          <input type="file" id="file-input" class="hidden-input" />
          <span id="file-name"></span>
        </div>
        
        <select id="ttl-select" class="dropdown">
          <option value="3600000">Burn after 1 Hour</option>
          <option value="86400000" selected>Burn after 1 Day</option>
          <option value="604800000">Burn after 7 Days</option>
        </select>
      </div>

      <button id="encrypt-btn">Encrypt & Create Link</button>
      <div id="result-area" class="hidden"></div>
    </div>
  `;

  const encryptBtn = document.getElementById('encrypt-btn');
  const secretText = document.getElementById('secret-text');
  const resultArea = document.getElementById('result-area');
  const fileInput = document.getElementById('file-input');
  const fileNameDisplay = document.getElementById('file-name');
  const ttlSelect = document.getElementById('ttl-select');

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      const file = e.target.files[0];
      if (file.size > 10 * 1024 * 1024) {
        alert("File is too large! Maximum size is 10MB.");
        fileInput.value = '';
        fileNameDisplay.textContent = '';
        return;
      }
      fileNameDisplay.textContent = file.name;
    }
  });

  encryptBtn.addEventListener('click', async () => {
    const text = secretText.value.trim();
    if (!text && fileInput.files.length === 0) {
      alert("Please enter a message or attach a file.");
      return;
    }

    encryptBtn.disabled = true;
    encryptBtn.textContent = 'Encrypting...';

    try {
      let fileData = null;
      if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        const arrayBuffer = await file.arrayBuffer();
        fileData = {
          name: file.name,
          type: file.type,
          data: await bufferToBase64(arrayBuffer)
        };
      }

      const payloadObj = { text, file: fileData };
      const payloadStr = JSON.stringify(payloadObj);

      // 1. Generate Key & Encrypt
      const key = await generateKey();
      const base64Key = await exportKey(key);
      const { iv, encryptedData } = await encryptText(payloadStr, key);
      const ttl = parseInt(ttlSelect.value);

      // 2. Send Ciphertext to Server
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iv, encryptedData, ttl })
      });

      if (!response.ok) throw new Error('Failed to save to server');
      const { id } = await response.json();

      // 3. Generate Link
      const link = `${window.location.origin}/?id=${id}#${base64Key}`;
      
      resultArea.classList.remove('hidden');
      resultArea.innerHTML = `
        <div class="result-container">
          <p class="success">Paste created successfully!</p>
          <div class="link-box" id="copy-link" title="Click to copy">${link}</div>
          <p class="warning">Warning: This paste will self-destruct after being viewed once, or after the selected TTL.</p>
        </div>
      `;

      document.getElementById('copy-link').addEventListener('click', () => {
        navigator.clipboard.writeText(link);
        alert('Link copied to clipboard!');
      });
      
      secretText.value = '';
      fileInput.value = '';
      fileNameDisplay.textContent = '';

    } catch (err) {
      console.error(err);
      alert('Error creating paste.');
    } finally {
      encryptBtn.disabled = false;
      encryptBtn.textContent = 'Encrypt & Create Link';
    }
  });
}

// UI for Viewing a Paste
async function renderViewMode(id, base64Key) {
  mainContent.innerHTML = `
    <div class="view-container">
      <div class="loader" id="loader"></div>
      <div id="view-result">Decrypting...</div>
    </div>
  `;

  const viewResult = document.getElementById('view-result');
  const loader = document.getElementById('loader');

  try {
    // 1. Fetch Ciphertext from Server
    const response = await fetch(`${API_URL}/${id}`);
    
    if (response.status === 404) {
      throw new Error('Paste not found, expired, or has already been burned.');
    }
    
    if (!response.ok) throw new Error('Failed to fetch paste.');
    
    const { encryptedData, iv } = await response.json();

    // 2. Import Key & Decrypt
    const key = await importKey(base64Key);
    const plaintext = await decryptText(encryptedData, iv, key);

    let payload;
    try {
      const parsed = JSON.parse(plaintext);
      const isPayloadObject = parsed && typeof parsed === 'object' && !Array.isArray(parsed);
      payload = isPayloadObject ? parsed : { text: plaintext };
    } catch (e) {
      payload = { text: plaintext }; // Fallback for V1
    }

    loader.classList.add('hidden');
    viewResult.innerHTML = `
      <p class="warning" style="margin-bottom: 1rem;">This paste has now been burned and deleted from the server.</p>
      <div class="content-box"></div>
      <div id="file-download-area" style="margin-top: 1rem;"></div>
      <button style="margin-top: 1rem;" onclick="window.location.href='/'">Create New Paste</button>
    `;
    
    if (payload.text) {
      viewResult.querySelector('.content-box').textContent = payload.text;
    } else {
      viewResult.querySelector('.content-box').style.display = 'none';
    }

    if (payload.file) {
      const fileBuffer = await base64ToBuffer(payload.file.data);
      const blob = new Blob([fileBuffer], { type: payload.file.type });
      const url = URL.createObjectURL(blob);
      
      const downloadArea = document.getElementById('file-download-area');
      const downloadLink = document.createElement('a');
      downloadLink.href = url;
      downloadLink.download = payload.file.name;
      downloadLink.className = 'download-btn';
      downloadLink.textContent = `⬇️ Download Attachment (${payload.file.name})`;
      downloadArea.appendChild(downloadLink);
    }

  } catch (err) {
    console.error(err);
    loader.classList.add('hidden');
    viewResult.innerHTML = `
      <p class="error" style="color: var(--error-color); font-weight: bold;">${err.message}</p>
      <button style="margin-top: 1rem;" onclick="window.location.href='/'">Go Back</button>
    `;
  }
}

// --- Router ---
const urlParams = new URLSearchParams(window.location.search);
const id = urlParams.get('id');
const hashKey = window.location.hash.substring(1); // Remove the '#'

if (id && hashKey) {
  renderViewMode(id, hashKey);
} else {
  renderCreateView();
}
