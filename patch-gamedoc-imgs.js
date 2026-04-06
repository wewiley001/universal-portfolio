// Decrypt game-design-documentation.html, replace doc-right img srcs with local paths, re-encrypt
'use strict';
const fs   = require('fs');
const path = require('path');
const { subtle } = globalThis.crypto;

const FILE = path.join(__dirname, 'writing', 'game-design-documentation.html');
const PASS = 'bGR#nuq83!g9G#Y3s#xe';
const ITERS = 100000;

// Local image paths in entry order: Abyss, General Klaus, Jade Empire, Relentless
const LOCAL_IMGS = [
    'img/game-design-documentation/abyss.png',
    'img/game-design-documentation/general-klaus.png',
    'img/game-design-documentation/jade-empire.png',
    'img/game-design-documentation/relentless.png',
];

function b64ToBytes(b64) {
    return Buffer.from(b64, 'base64');
}
function bytesToB64(buf) {
    return Buffer.from(buf).toString('base64');
}

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
    // Last 16 bytes are the auth tag
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

    // Extract enc-data JSON
    const encMatch = html.match(/<script id="enc-data" type="application\/json">([\s\S]*?)<\/script>/);
    if (!encMatch) { console.error('enc-data not found'); process.exit(1); }
    const data = JSON.parse(encMatch[1]);

    // Decrypt
    let inner = await decrypt(data, PASS);
    console.log('Decrypted OK');

    // Replace img srcs in doc-right divs in order
    let idx = 0;
    inner = inner.replace(/(<div class="doc-right">[\s\S]*?<img\s[^>]*?)src="[^"]*"/g, (match, prefix) => {
        const src = LOCAL_IMGS[idx++] || '';
        console.log(`  Entry ${idx}: -> ${src}`);
        return `${prefix}src="${src}"`;
    });

    if (idx !== 4) {
        console.warn(`Warning: replaced ${idx} img srcs (expected 4)`);
    }

    // Re-encrypt
    const newData = await encrypt(inner, PASS);
    console.log('Re-encrypted OK');

    // Replace enc-data in file
    const newScript = `<script id="enc-data" type="application/json">${JSON.stringify(newData)}</script>`;
    const newHtml = html.replace(/<script id="enc-data" type="application\/json">[\s\S]*?<\/script>/, newScript);
    fs.writeFileSync(FILE, newHtml, 'utf8');
    console.log('Done.');
})();
