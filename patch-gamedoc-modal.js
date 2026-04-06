// Decrypt game-design-documentation.html, swap doc-btn anchors → modal-trigger buttons, re-encrypt
'use strict';
const fs   = require('fs');
const path = require('path');
const { subtle } = globalThis.crypto;

const FILE = path.join(__dirname, 'writing', 'game-design-documentation.html');
const PASS = 'bGR#nuq83!g9G#Y3s#xe';
const ITERS = 100000;

// Embed URLs in entry order: Abyss, General Klaus, Jade Empire, Relentless
// Dropbox DOCX/PDF routed through Google Docs Viewer (dl=1 for direct link)
// Google Doc uses /preview endpoint
const EMBED_URLS = [
    "https://docs.google.com/viewer?url=https%3A%2F%2Fwww.dropbox.com%2Fs%2Fng7p392tf26ybz2%2FAbyss.docx%3Fdl%3D1&embedded=true",
    "https://docs.google.com/viewer?url=https%3A%2F%2Fwww.dropbox.com%2Fscl%2Ffi%2Fooa8r7amxnee951ondxd4%2FGeneral-Klaus.docx%3Fdl%3D1&embedded=true",
    "https://docs.google.com/viewer?url=https%3A%2F%2Fwww.dropbox.com%2Fscl%2Ffi%2Fqa67m5jtj4hzg6upbds8m%2FJade-Empire-Ascension-Rule-Book.pdf%3Frlkey%3Ds0s8pts46482uilbbi6ilytdt%26dl%3D1&embedded=true",
    "https://docs.google.com/document/d/0B5nj2HD6PQZ6MzFXMkM2OEZSV2s/preview"
];

function b64ToBytes(b64) { return Buffer.from(b64, 'base64'); }
function bytesToB64(buf) { return Buffer.from(buf).toString('base64'); }

async function deriveKey(password, salt) {
    const te = new TextEncoder();
    const keyMat = await subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: ITERS, hash: 'SHA-256' },
        keyMat,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

async function decrypt(data, password) {
    const salt = b64ToBytes(data.salt);
    const iv   = b64ToBytes(data.iv);
    const ct   = b64ToBytes(data.ct);
    const tag  = b64ToBytes(data.tag);
    const combined = Buffer.concat([ct, tag]);
    const key = await deriveKey(password, salt);
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv }, key, combined);
    return new TextDecoder().decode(plain);
}

async function encrypt(html, password) {
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const iv   = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const key  = await deriveKey(password, salt);
    const te   = new TextEncoder();
    const enc  = await subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(html));
    const combined = new Uint8Array(enc);
    const ct  = combined.slice(0, combined.length - 16);
    const tag = combined.slice(combined.length - 16);
    return {
        salt: bytesToB64(salt),
        iv:   bytesToB64(iv),
        ct:   bytesToB64(ct),
        tag:  bytesToB64(tag),
    };
}

(async () => {
    const html = fs.readFileSync(FILE, 'utf8');

    const encMatch = html.match(/<script id="enc-data" type="application\/json">([\s\S]*?)<\/script>/);
    if (!encMatch) { console.error('enc-data not found'); process.exit(1); }
    const data = JSON.parse(encMatch[1]);

    let inner = await decrypt(data, PASS);
    console.log('Decrypted OK');

    // Replace each <a class="doc-btn" ...>See Document</a> with a button in order
    let idx = 0;
    inner = inner.replace(/<a class="doc-btn"[^>]*>[\s\S]*?<\/a>/g, () => {
        const url = EMBED_URLS[idx] || '';
        console.log(`  Entry ${idx + 1}: ${url.slice(0, 60)}...`);
        idx++;
        return `<button class="doc-btn" onclick="openDocModal('${url}')">See Document</button>`;
    });

    if (idx !== 4) console.warn(`Warning: replaced ${idx} buttons (expected 4)`);

    const newData = await encrypt(inner, PASS);
    console.log('Re-encrypted OK');

    const newScript = `<script id="enc-data" type="application/json">${JSON.stringify(newData)}</script>`;
    const newHtml = html.replace(/<script id="enc-data" type="application\/json">[\s\S]*?<\/script>/, newScript);
    fs.writeFileSync(FILE, newHtml, 'utf8');
    console.log('Done.');
})();
