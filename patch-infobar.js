'use strict';
/**
 * patch-infobar.js
 *
 * 1. Decrypts each encrypted writing page, replaces (or inserts) the
 *    Genre / Type info-bar, re-encrypts, and writes the file back.
 * 2. Updates every card-tag span in all writing page sidebars and index.html
 *    so each card's tag matches its page's Type.
 *
 * Run: node patch-infobar.js
 */

const fs   = require('fs');
const path = require('path');
const { pbkdf2Sync, randomBytes, createCipheriv, createDecipheriv } = require('crypto');

const PASSWORD    = 'bGR#nuq83!g9G#Y3s#xe';
const ITERATIONS  = 100_000;
const KEY_LEN     = 32;
const DIGEST      = 'sha256';
const WRITING_DIR = path.join(__dirname, 'writing');

// ── Page metadata: filename → { genre, type } ────────────────────────────────
const PAGE_DATA = {
    'an-oncoming-storm.html':            { genre: 'Fantasy',                  type: 'Short Story' },
    'can-you-roleplay-history.html':     { genre: 'Game Commentary',          type: 'Editorial'   },
    'college-essay-on-kotor.html':       { genre: 'Game Review',              type: 'Essay'       },
    'easy-characters-the-dnd-way.html':  { genre: 'Writing Commentary',       type: 'Essay'       },
    'horror-encoded.html':               { genre: 'Horror',                   type: 'Short Story' },
    'iron-gunsmoke-and-moonslight.html': { genre: 'Fantasy &amp; Hardboiled', type: 'Draft'       },
    'portside-rhapsody.html':            { genre: 'Fantasy &amp; Hardboiled', type: 'Excerpt'     },
    'space-assault.html':                { genre: 'Space Opera',              type: 'Excerpt'     },
    'the-man-from-the-mojave.html':      { genre: 'Western',                  type: 'Draft'       },
    'the-undercity.html':                { genre: 'Fantasy &amp; Hardboiled', type: 'Draft'       },
    'the-vale.html':                     { genre: 'Dark Fantasy',             type: 'Short Story' },
    'troubled-night.html':              { genre: 'Dark Fantasy',              type: 'Draft'       },
    'welcome-to-the-jungle.html':        { genre: 'Cyberpunk',                type: 'Draft'       },
    'whiskey-revovler.html':             { genre: 'Fantasy &amp; Hardboiled', type: 'Excerpt'     },
    'witches-in-the-brush.html':         { genre: 'Dark Fantasy',             type: 'Draft'       },
    'writing-the-arcane-theorem.html':   { genre: 'Writing Commentary',       type: 'Essay'       },
};

// ── Crypto ────────────────────────────────────────────────────────────────────
function decrypt(encData) {
    const salt = Buffer.from(encData.salt, 'base64');
    const iv   = Buffer.from(encData.iv,   'base64');
    const ct   = Buffer.from(encData.ct,   'base64');
    const tag  = Buffer.from(encData.tag,  'base64');
    const key  = pbkdf2Sync(PASSWORD, salt, ITERATIONS, KEY_LEN, DIGEST);
    const dec  = createDecipheriv('aes-256-gcm', key, iv);
    dec.setAuthTag(tag);
    return Buffer.concat([dec.update(ct), dec.final()]).toString('utf8');
}

function encrypt(plaintext) {
    const salt   = randomBytes(16);
    const iv     = randomBytes(12);
    const key    = pbkdf2Sync(PASSWORD, salt, ITERATIONS, KEY_LEN, DIGEST);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ct     = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
        salt: salt.toString('base64'),
        iv:   iv.toString('base64'),
        ct:   ct.toString('base64'),
        tag:  cipher.getAuthTag().toString('base64'),
    };
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

/** Locate the enc-data <script> block and return parse info. */
function extractEncData(html) {
    const OPEN = '<script id="enc-data" type="application/json">';
    const start = html.indexOf(OPEN);
    if (start === -1) return null;
    const cs  = start + OPEN.length;
    const end = html.indexOf('</script>', cs);
    if (end === -1) return null;
    return { data: JSON.parse(html.slice(cs, end)), cs, end };
}

/** Extract a <div class="CLASS"> block by depth-counting nested divs. */
function extractDiv(html, className) {
    const marker = `class="${className}"`;
    const mi = html.indexOf(marker);
    if (mi === -1) return null;
    const divStart   = html.lastIndexOf('<div', mi);
    if (divStart === -1) return null;
    const tagClose   = html.indexOf('>', divStart);
    const innerStart = tagClose + 1;
    let depth = 1, i = innerStart;
    while (i < html.length) {
        if (html[i] === '<') {
            if (html.startsWith('<div', i) && /[\s>]/.test(html[i + 4] || '')) { depth++; i += 4; continue; }
            if (html.startsWith('</div>', i)) {
                depth--;
                if (depth === 0) return { start: divStart, end: i + 6 };
                i += 6; continue;
            }
        }
        i++;
    }
    return null;
}

/** Build canonical info-bar HTML for a genre/type pair. */
function buildInfoBar(genre, type) {
    return (
        `<div class="info-bar">\n` +
        `                    <div class="info-row">\n` +
        `                        <span class="info-label">Genre</span>\n` +
        `                        <span class="info-value">${genre}</span>\n` +
        `                    </div>\n` +
        `                    <div class="info-row">\n` +
        `                        <span class="info-label">Type</span>\n` +
        `                        <span class="info-value">${type}</span>\n` +
        `                    </div>\n` +
        `                </div>`
    );
}

/**
 * In the decrypted inner HTML, replace the existing info-bar with the new one.
 * If no info-bar is found, insert it right after the closing </h1> of page-title.
 */
function patchInfoBar(inner, genre, type) {
    const newBar = buildInfoBar(genre, type);

    // Try to replace existing info-bar
    const bar = extractDiv(inner, 'info-bar');
    if (bar) {
        return inner.slice(0, bar.start) + newBar + inner.slice(bar.end);
    }

    // Fallback: insert after the page-title closing tag
    const h1End = inner.indexOf('</h1>');
    if (h1End !== -1) {
        const after = h1End + 5; // past </h1>
        return inner.slice(0, after) + '\n\n' + newBar + '\n' + inner.slice(after);
    }

    console.log('    WARNING: could not find info-bar or </h1> — skipping patch');
    return inner;
}

/**
 * In an HTML file, update the card-tag span for cards linking to a given href.
 * Only updates within a short window after the href to avoid cross-card matches.
 */
function updateCardTag(html, href, newType) {
    const TAG_OPEN  = '<span class="card-tag">';
    const TAG_CLOSE = '</span>';
    const MAX_DIST  = 700;
    let result = html;
    let pos = 0;

    while (true) {
        const hrefIdx = result.indexOf(`href="${href}"`, pos);
        if (hrefIdx === -1) break;

        const tagIdx = result.indexOf(TAG_OPEN, hrefIdx);
        if (tagIdx === -1 || tagIdx - hrefIdx > MAX_DIST) { pos = hrefIdx + 1; continue; }

        const contentStart = tagIdx + TAG_OPEN.length;
        const contentEnd   = result.indexOf(TAG_CLOSE, contentStart);
        if (contentEnd === -1) { pos = hrefIdx + 1; continue; }

        result = result.slice(0, contentStart) + newType + result.slice(contentEnd);
        pos = contentStart + newType.length;
    }
    return result;
}

// ── Task 1: Update info-bars ──────────────────────────────────────────────────
console.log('\n── Task 1: Updating encrypted info-bars ──────────────────────');

for (const [filename, { genre, type }] of Object.entries(PAGE_DATA)) {
    const filepath = path.join(WRITING_DIR, filename);

    if (!fs.existsSync(filepath)) {
        console.log(`  SKIP (file not found): ${filename}`);
        continue;
    }

    let html = fs.readFileSync(filepath, 'utf8');

    const enc = extractEncData(html);
    if (!enc) {
        console.log(`  SKIP (no enc-data): ${filename}`);
        continue;
    }

    let inner;
    try {
        inner = decrypt(enc.data);
    } catch (e) {
        console.log(`  ERROR (decrypt failed): ${filename} — ${e.message}`);
        continue;
    }

    const patched = patchInfoBar(inner, genre, type);

    if (patched === inner) {
        console.log(`  WARN (no change to inner): ${filename}`);
        continue;
    }

    const newEnc  = encrypt(patched);
    const newJson = JSON.stringify(newEnc);
    html = html.slice(0, enc.cs) + newJson + html.slice(enc.end);

    fs.writeFileSync(filepath, html, 'utf8');
    console.log(`  OK: ${filename}  (Genre: ${genre} / Type: ${type})`);
}

// ── Task 2: Update card tags in all writing pages + index ─────────────────────
console.log('\n── Task 2: Updating card tags in sidebars / index ────────────');

const allFiles = fs.readdirSync(WRITING_DIR)
    .filter(f => f.endsWith('.html'))
    .sort()
    .map(f => path.join(WRITING_DIR, f));

for (const filepath of allFiles) {
    let html = fs.readFileSync(filepath, 'utf8');
    const original = html;

    for (const [href, { type }] of Object.entries(PAGE_DATA)) {
        html = updateCardTag(html, href, type);
    }

    if (html !== original) {
        fs.writeFileSync(filepath, html, 'utf8');
        console.log(`  Updated: ${path.basename(filepath)}`);
    } else {
        console.log(`  No change: ${path.basename(filepath)}`);
    }
}

console.log('\nDone.');
