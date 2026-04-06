'use strict';
const fs   = require('fs');
const path = require('path');
const { pbkdf2Sync, randomBytes, createCipheriv, createDecipheriv } = require('crypto');

const PASSWORD   = 'bGR#nuq83!g9G#Y3s#xe';
const ITERATIONS = 100_000;
const KEY_LEN    = 32;
const DIGEST     = 'sha256';
const FILE       = path.join(__dirname, 'writing', 'game-design-documentation.html');

function decrypt(enc) {
    const key = pbkdf2Sync(PASSWORD, Buffer.from(enc.salt,'base64'), ITERATIONS, KEY_LEN, DIGEST);
    const dec = createDecipheriv('aes-256-gcm', key, Buffer.from(enc.iv,'base64'));
    dec.setAuthTag(Buffer.from(enc.tag,'base64'));
    return Buffer.concat([dec.update(Buffer.from(enc.ct,'base64')), dec.final()]).toString('utf8');
}

function encrypt(plain) {
    const salt = randomBytes(16), iv = randomBytes(12);
    const key  = pbkdf2Sync(PASSWORD, salt, ITERATIONS, KEY_LEN, DIGEST);
    const c    = createCipheriv('aes-256-gcm', key, iv);
    const ct   = Buffer.concat([c.update(plain,'utf8'), c.final()]);
    return { salt: salt.toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64'), tag: c.getAuthTag().toString('base64') };
}

function extractEncData(html) {
    const OPEN = '<script id="enc-data" type="application/json">';
    const s = html.indexOf(OPEN);
    if (s === -1) return null;
    const cs = s + OPEN.length;
    const e  = html.indexOf('</script>', cs);
    return { data: JSON.parse(html.slice(cs, e)), cs, end: e };
}

function extractDiv(html, className) {
    const mi = html.indexOf(`class="${className}"`);
    if (mi === -1) return null;
    const ds = html.lastIndexOf('<div', mi);
    const innerStart = html.indexOf('>', ds) + 1;
    let depth = 1, i = innerStart;
    while (i < html.length) {
        if (html[i] === '<') {
            if (html.startsWith('<div', i) && /[\s>]/.test(html[i+4]||'')) { depth++; i+=4; continue; }
            if (html.startsWith('</div>', i)) { depth--; if (depth===0) return { start: ds, end: i+6 }; i+=6; continue; }
        }
        i++;
    }
    return null;
}

let html = fs.readFileSync(FILE, 'utf8');
const enc = extractEncData(html);
let inner = decrypt(enc.data);

// Remove info-bar
const bar = extractDiv(inner, 'info-bar');
if (bar) {
    inner = (inner.slice(0, bar.start) + inner.slice(bar.end)).replace(/\n\s*\n\s*\n/, '\n\n');
    console.log('  Removed info-bar');
} else {
    console.log('  No info-bar found');
}

const newEnc  = encrypt(inner);
const newJson = JSON.stringify(newEnc);
html = html.slice(0, enc.cs) + newJson + html.slice(enc.end);
fs.writeFileSync(FILE, html, 'utf8');
console.log('  Done — re-encrypted.');
