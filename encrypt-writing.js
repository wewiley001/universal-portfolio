'use strict';
/**
 * encrypt-writing.js
 *
 * Adds AES-256-GCM password protection to every writing detail page.
 * Run once: node encrypt-writing.js
 * To re-run on already-processed files, delete them and restore from git,
 * or run decrypt-writing.js first (not provided — keep a backup).
 *
 * After running, visitors must enter the password to read any writing page.
 * The password is remembered for the browser session (sessionStorage).
 *
 * ─── CHANGE PASSWORD HERE ─────────────────────────────────────────────────
 */
const PASSWORD   = 'portfolio';   // ← set your password before running
/** ───────────────────────────────────────────────────────────────────────── */

const fs         = require('fs');
const path       = require('path');
const { pbkdf2Sync, randomBytes, createCipheriv } = require('crypto');

const ITERATIONS = 100_000;
const KEY_LEN    = 32;   // AES-256
const DIGEST     = 'sha256';
const WRITING_DIR = path.join(__dirname, 'writing');
const SKIP        = new Set(['index.html']);   // gallery index — no gate needed

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Locate the first <div class="main-content"> element and return its bounds.
 * Uses a depth counter so nested <div> tags are handled correctly.
 */
function extractMainContent(html) {
    const attrStr   = 'class="main-content"';
    const attrIdx   = html.indexOf(attrStr);
    if (attrIdx === -1) return null;

    // Walk back to find the opening <div
    const divStart  = html.lastIndexOf('<div', attrIdx);
    if (divStart === -1) return null;
    const tagClose  = html.indexOf('>', divStart);   // end of opening tag
    const innerStart = tagClose + 1;

    let depth = 1;
    let i     = innerStart;
    let innerEnd = -1, outerEnd = -1;

    while (i < html.length) {
        if (html[i] === '<') {
            // opening <div (must be followed by space or >)
            if (html.startsWith('<div', i) && i + 4 < html.length && /[\s>]/.test(html[i + 4])) {
                depth++;
                i += 4;
                continue;
            }
            // closing </div>
            if (html.startsWith('</div>', i)) {
                depth--;
                if (depth === 0) {
                    innerEnd = i;
                    outerEnd = i + 6;   // past </div>
                    break;
                }
                i += 6;
                continue;
            }
        }
        i++;
    }

    if (innerEnd === -1) return null;
    return { divStart, innerStart, innerEnd, outerEnd,
             inner: html.slice(innerStart, innerEnd) };
}

/** Encrypt plaintext with AES-256-GCM using a PBKDF2-derived key. */
function encryptContent(plaintext) {
    const salt   = randomBytes(16);
    const iv     = randomBytes(12);
    const key    = pbkdf2Sync(PASSWORD, salt, ITERATIONS, KEY_LEN, DIGEST);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    let ct = cipher.update(plaintext, 'utf8');
    ct     = Buffer.concat([ct, cipher.final()]);
    const tag = cipher.getAuthTag();   // 16-byte GCM auth tag
    return {
        salt: salt.toString('base64'),
        iv:   iv.toString('base64'),
        ct:   ct.toString('base64'),
        tag:  tag.toString('base64')
    };
}

// ── CSS injected into each page's <style> block ────────────────────────────
const OVERLAY_CSS = `
        /* ── password gate ──────────────────────────────────────── */
        #pw-gate { position: fixed; inset: 0; background: #000; z-index: 10000; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 0; }
        #pw-gate.hidden { display: none; }
        .pw-box { display: flex; flex-direction: column; align-items: center; gap: 1.5rem; width: 320px; }
        .pw-lock-icon { fill: #f81562; width: 40px; height: 40px; }
        .pw-title { font-size: .68rem; letter-spacing: .3em; text-transform: uppercase; color: rgba(255,255,255,.35); text-align: center; line-height: 1.6; }
        .pw-form { display: flex; flex-direction: column; gap: .75rem; width: 100%; }
        .pw-input { background: #080808; border: 1px solid rgba(255,255,255,.1); color: #fff; font-family: inherit; font-size: .9rem; padding: .65rem .9rem; outline: none; width: 100%; letter-spacing: .08em; transition: border-color .2s; }
        .pw-input:focus { border-color: rgba(248,21,98,.6); }
        .pw-input.pw-shake { animation: pw-shake .35s ease; border-color: #f81562; }
        .pw-btn { background: rgba(248,21,98,.1); border: 1px solid rgba(248,21,98,.4); color: #f81562; font-family: inherit; font-size: .65rem; letter-spacing: .25em; text-transform: uppercase; padding: .65rem 1.2rem; cursor: pointer; transition: background .2s, border-color .2s, color .2s; }
        .pw-btn:hover { background: rgba(248,21,98,.2); border-color: #f81562; color: #fff; }
        .pw-error { font-size: .6rem; letter-spacing: .18em; text-transform: uppercase; color: #f81562; opacity: 0; transition: opacity .2s; text-align: center; min-height: 1em; }
        .pw-error.visible { opacity: 1; }
        @keyframes pw-shake { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-7px)} 40%,80%{transform:translateX(7px)} }
`;

// ── Overlay HTML ───────────────────────────────────────────────────────────
const OVERLAY_HTML = `
<div id="pw-gate" role="dialog" aria-modal="true" aria-label="Content protected">
    <div class="pw-box">
        <svg class="pw-lock-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
        </svg>
        <p class="pw-title">This content is password protected</p>
        <form class="pw-form" id="pw-form" autocomplete="off">
            <input class="pw-input" type="password" id="pw-input"
                   placeholder="Enter password"
                   aria-label="Password"
                   autocomplete="current-password">
            <button class="pw-btn" type="submit">Unlock</button>
            <p class="pw-error" id="pw-error" aria-live="polite">Incorrect password</p>
        </form>
    </div>
</div>`;

// ── Gate script ─────────────────────────────────────────────────────────────
// Note: must NOT contain </script> literally — ending tag is split below.
const GATE_SCRIPT = `<script>
(function () {
    'use strict';
    var ITERS = 100000;
    var encEl = document.getElementById('enc-data');
    var gate  = document.getElementById('pw-gate');
    var form  = document.getElementById('pw-form');
    var input = document.getElementById('pw-input');
    var errEl = document.getElementById('pw-error');
    var mc    = document.getElementById('main-content');

    if (!encEl || !gate || !mc) return;
    if (!window.crypto || !window.crypto.subtle) {
        gate.classList.add('hidden');   // SubtleCrypto not available (non-HTTPS dev?)
        return;
    }

    var data = JSON.parse(encEl.textContent);

    function b64ToBytes(b64) {
        var bin   = atob(b64);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
    }

    async function tryDecrypt(pw) {
        var te     = new TextEncoder();
        var keyMat = await crypto.subtle.importKey(
            'raw', te.encode(pw), 'PBKDF2', false, ['deriveKey']
        );
        var key = await crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt: b64ToBytes(data.salt), iterations: ITERS, hash: 'SHA-256' },
            keyMat,
            { name: 'AES-GCM', length: 256 },
            false,
            ['decrypt']
        );
        // Web Crypto AES-GCM expects ciphertext + 16-byte auth tag concatenated
        var ct       = b64ToBytes(data.ct);
        var tag      = b64ToBytes(data.tag);
        var combined = new Uint8Array(ct.length + tag.length);
        combined.set(ct);
        combined.set(tag, ct.length);
        var plain = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: b64ToBytes(data.iv) },
            key, combined
        );
        return new TextDecoder().decode(plain);
    }

    async function unlock(pw) {
        try {
            var html = await tryDecrypt(pw);
            mc.innerHTML = html;
            gate.classList.add('hidden');
            try { sessionStorage.setItem('writing_pw', pw); } catch (e) {}
        } catch (e) {
            input.classList.add('pw-shake');
            errEl.classList.add('visible');
            input.select();
            setTimeout(function () { input.classList.remove('pw-shake'); }, 400);
        }
    }

    // Auto-unlock if this session is already authenticated
    var saved = '';
    try { saved = sessionStorage.getItem('writing_pw') || ''; } catch (e) {}
    if (saved) { unlock(saved); return; }

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        var pw = input.value.trim();
        if (!pw) return;
        errEl.classList.remove('visible');
        unlock(pw);
    });
}());
<\/script>`;

// ── Main ───────────────────────────────────────────────────────────────────
const files = fs.readdirSync(WRITING_DIR)
    .filter(f => f.endsWith('.html') && !SKIP.has(f))
    .sort();

let processed = 0, skipped = 0, errors = 0;

for (const file of files) {
    const filepath = path.join(WRITING_DIR, file);
    let html = fs.readFileSync(filepath, 'utf8');

    // Skip already-processed files
    if (html.includes('id="pw-gate"')) {
        console.log(`  SKIP  (already processed) : ${file}`);
        skipped++;
        continue;
    }

    const mc = extractMainContent(html);
    if (!mc) {
        console.log(`  SKIP  (no main-content)   : ${file}`);
        skipped++;
        continue;
    }

    // ① Encrypt the inner HTML of .main-content
    const encData = encryptContent(mc.inner.trim());
    const encJson = JSON.stringify(encData);

    // ④ Replace main-content FIRST — positions (mc.*) are valid on the original html.
    //    Doing this before any head edits prevents index drift caused by inserting CSS/meta.
    const encTag  = `<script id="enc-data" type="application/json">${encJson}<\/script>`;
    const openDiv = html.slice(mc.divStart, mc.innerStart)
                        .replace('class="main-content"', 'class="main-content" id="main-content"');
    const newBlock = openDiv + '\n    ' + encTag + '\n</div>';
    html = html.slice(0, mc.divStart) + newBlock + html.slice(mc.outerEnd);

    // ② robots meta tag  (after viewport meta) — head-only, safe after body replacement
    html = html.replace(
        /(<meta name="viewport"[^>]+>)/,
        '$1\n    <meta name="robots" content="noindex, nofollow, noarchive, noimageindex">'
    );

    // ③ Overlay CSS  (before </style>)
    html = html.replace('    </style>', OVERLAY_CSS + '    </style>');

    // ⑤ Overlay HTML + gate script — insert before <div id="lightbox"> (preferred)
    //    or fall back to just before </body>
    const lbIdx = html.indexOf('<div id="lightbox"');
    if (lbIdx !== -1) {
        html = html.slice(0, lbIdx) + OVERLAY_HTML + '\n\n' + GATE_SCRIPT + '\n\n' + html.slice(lbIdx);
    } else {
        html = html.replace('</body>', OVERLAY_HTML + '\n\n' + GATE_SCRIPT + '\n\n</body>');
    }

    try {
        fs.writeFileSync(filepath, html, 'utf8');
        console.log(`  OK    : ${file}`);
        processed++;
    } catch (err) {
        console.error(`  ERROR : ${file} — ${err.message}`);
        errors++;
    }
}

console.log('');
console.log(`Done. ${processed} encrypted, ${skipped} skipped, ${errors} errors.`);
console.log(`Password : "${PASSWORD}"`);
console.log('');
console.log('NOTE: SubtleCrypto (used for decryption) requires a secure context.');
console.log('Pages must be served over HTTPS or localhost — not file:// protocol.');
