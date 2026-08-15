const API_URL = 'http://localhost:3000/api/pastes';

// --- Utility Functions for Crypto ---

// Convert ArrayBuffer to Base64
function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Convert Base64 to ArrayBuffer
function base64ToBuffer(base64) {
  const binary_string = atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

// Generate AES-GCM Key
async function generateKey() {
  return await crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256
    },
    true,
    ["encrypt", "decrypt"]
  );
}

// Export Key to Base64
async function exportKey(key) {
  const exported = await crypto.subtle.exportKey("raw", key);
  return bufferToBase64(exported);
}

// Import Key from Base64
async function importKey(base64Key) {
  const keyBuffer = base64ToBuffer(base64Key);
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
    {
      name: "AES-GCM",
      iv: iv
    },
    key,
    encodedText
  );

  return {
    iv: bufferToBase64(iv),
    encryptedData: bufferToBase64(ciphertext)
  };
}

// Decrypt Text
async function decryptText(encryptedData, ivBase64, key) {
  const iv = base64ToBuffer(ivBase64);
  const data = base64ToBuffer(encryptedData);

  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: new Uint8Array(iv)
    },
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
      <button id="encrypt-btn">Encrypt & Create Link</button>
      <div id="result-area" class="hidden"></div>
    </div>
  `;

  const encryptBtn = document.getElementById('encrypt-btn');
  const secretText = document.getElementById('secret-text');
  const resultArea = document.getElementById('result-area');

  encryptBtn.addEventListener('click', async () => {
    const text = secretText.value.trim();
    if (!text) return;

    encryptBtn.disabled = true;
    encryptBtn.textContent = 'Encrypting...';

    try {
      // 1. Generate Key & Encrypt
      const key = await generateKey();
      const base64Key = await exportKey(key);
      const { iv, encryptedData } = await encryptText(text, key);

      // 2. Send Ciphertext to Server
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iv, encryptedData })
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
          <p class="warning">Warning: This paste will self-destruct after being viewed once.</p>
        </div>
      `;

      document.getElementById('copy-link').addEventListener('click', () => {
        navigator.clipboard.writeText(link);
        alert('Link copied to clipboard!');
      });
      
      secretText.value = '';

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
      throw new Error('Paste not found or has already been burned.');
    }
    
    if (!response.ok) throw new Error('Failed to fetch paste.');
    
    const { encryptedData, iv } = await response.json();

    // 2. Import Key & Decrypt
    const key = await importKey(base64Key);
    const plaintext = await decryptText(encryptedData, iv, key);

    loader.classList.add('hidden');
    viewResult.innerHTML = `
      <p class="warning" style="margin-bottom: 1rem;">This paste has now been burned and deleted from the server.</p>
      <div class="content-box"></div>
      <button style="margin-top: 1rem;" onclick="window.location.href='/'">Create New Paste</button>
    `;
    viewResult.querySelector('.content-box').textContent = plaintext;

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
