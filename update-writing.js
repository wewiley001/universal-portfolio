'use strict';
/**
 * update-writing.js
 *
 * Decrypts each writing detail page, compares its text content against the
 * corresponding desktop text file, rebuilds the description paragraph and
 * prose section if they differ, re-encrypts, and writes the file back.
 *
 * Run: node update-writing.js
 */

const fs   = require('fs');
const path = require('path');
const { pbkdf2Sync, randomBytes, createCipheriv, createDecipheriv } = require('crypto');

const PASSWORD    = 'bGR#nuq83!g9G#Y3s#xe';
const ITERATIONS  = 100_000;
const KEY_LEN     = 32;
const DIGEST      = 'sha256';
const WRITING_DIR = path.join(__dirname, 'writing');
const DESKTOP     = 'C:\\Users\\da_in\\Desktop';

// ── File map: HTML filename → Desktop text filename ─────────────────────────
const FILE_MAP = {
    'an-oncoming-storm.html':            'Oncomming Storm.txt',
    'horror-encoded.html':               'Horror Encoded.txt',
    'iron-gunsmoke-and-moonslight.html': 'iron-gunsmoke-moonslight.txt',
    'portside-rhapsody.html':            'Portside Rhapsody.txt',
    'space-assault.html':                'Space Assaut.txt',
    'the-man-from-the-mojave.html':      'The Man From the Mojave.txt',
    'the-undercity.html':                'undercity.txt',
    'the-vale.html':                     'the vale.txt',
    'troubled-night.html':               'Troubled Night.txt',
    'welcome-to-the-jungle.html':        'Welcome to the Jungle.txt',
    'whiskey-revovler.html':             'Whiskey Revolver.txt',
    'witches-in-the-brush.html':         'Witches inthe Brush.txt',
};

// ── Crypto ──────────────────────────────────────────────────────────────────

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

// ── HTML helpers ─────────────────────────────────────────────────────────────

/** Strip HTML tags and decode common entities; collapse whitespace. */
function stripHtml(html) {
    return html
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g,  '&')
        .replace(/&lt;/g,   '<')
        .replace(/&gt;/g,   '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g,  "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Escape characters that are unsafe in HTML text content. */
function escHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Extract the first div with class="<className>" from html.
 * Returns { inner, start, end } or null.
 */
function extractDiv(html, className) {
    const marker  = `class="${className}"`;
    const idx     = html.indexOf(marker);
    if (idx === -1) return null;

    const divStart   = html.lastIndexOf('<div', idx);
    if (divStart === -1) return null;
    const tagClose   = html.indexOf('>', divStart);
    const innerStart = tagClose + 1;

    let depth = 1, i = innerStart;
    while (i < html.length) {
        if (html[i] === '<') {
            if (html.startsWith('<div', i) && /[\s>]/.test(html[i + 4] || '')) { depth++; i += 4; continue; }
            if (html.startsWith('</div>', i)) {
                depth--;
                if (depth === 0) return { inner: html.slice(innerStart, i), start: divStart, end: i + 6 };
                i += 6;
                continue;
            }
        }
        i++;
    }
    return null;
}

/** Extract enc-data JSON from the HTML string. */
function extractEncData(html) {
    const OPEN  = '<script id="enc-data" type="application/json">';
    const start = html.indexOf(OPEN);
    if (start === -1) return null;
    const cs  = start + OPEN.length;
    const end = html.indexOf('<\/script>', cs);
    if (end === -1) return null;
    return { data: JSON.parse(html.slice(cs, end)), cs, end };
}

/** Replace the enc-data content in HTML. */
function replaceEncData(html, cs, end, newJson) {
    return html.slice(0, cs) + newJson + html.slice(end);
}

// ── Text-file parser ─────────────────────────────────────────────────────────

function parseTextFile(raw) {
    // Normalize Windows CRLF to LF
    raw = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    const D_MARKER = '/Place this above info-bar in a paragraph element';
    const P_MARKER = '/Begin Prose Here';

    const di = raw.indexOf(D_MARKER);
    const pi = raw.indexOf(P_MARKER);
    if (di === -1 || pi === -1) return null;

    const description = raw.slice(di + D_MARKER.length, pi).trim();
    const prose       = raw.slice(pi + P_MARKER.length).trim();
    return { description, prose };
}

// ── Prose → HTML converter ────────────────────────────────────────────────────

const TIME_RE = /\b(Night|Morning|Afternoon|Evening|Dawn|Dusk|Midnight|Daytime|Midday)\b/i;

function isSceneHeader(lines) {
    if (!lines.length) return false;

    // Screenplay: single line starting INT. / EXT. / I/E.
    if (lines.length === 1 && /^(INT\.|EXT\.|I\/E\.)/.test(lines[0])) return true;

    // Screenplay transitions: FADE IN/OUT, SMASH CUT, CUT TO, DISSOLVE TO
    if (lines.length === 1 && /^(FADE (IN|OUT)|SMASH CUT|CUT TO|DISSOLVE TO)[:\.]?\s*$/i.test(lines[0])) return true;

    // Multi-line scene header: 2–4 short lines, no sentence-ending punctuation,
    // last line is a time-of-day term OR all lines are very short
    if (lines.length < 2 || lines.length > 4) return false;
    if (!lines.every(l => l.length <= 70))     return false;
    if ( lines.some(l => /[.!?;]$/.test(l)))   return false;

    const hasTime     = TIME_RE.test(lines[lines.length - 1]);
    const allVeryShort = lines.every(l => l.length <= 40);
    return hasTime || allVeryShort;
}

/**
 * Convert plain prose text (from a text file) to an HTML string
 * consisting of .scene-header divs and <p> tags, wrapped in <div class="prose">.
 */
function proseToHtml(proseText) {
    // Split into blocks on one-or-more blank lines
    const blocks = proseText.split(/\n[ \t]*\n+/).map(b => b.trim()).filter(Boolean);

    const parts = [];
    for (const block of blocks) {
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
        if (!lines.length) continue;

        if (isSceneHeader(lines)) {
            // Each line gets its own scene-header div (CSS handles tight stacking)
            for (const line of lines) {
                parts.push(`<div class="scene-header">${escHtml(line)}</div>`);
            }
        } else {
            // Regular paragraph — join any internal line-breaks with a space
            parts.push(`<p>${escHtml(lines.join(' '))}</p>`);
        }
    }

    return `<div class="prose">\n    ${parts.join('\n    ')}\n</div>`;
}

// ── Main content rebuilder ────────────────────────────────────────────────────

/**
 * Given the decrypted inner HTML and the new description + prose texts,
 * return rebuilt inner HTML preserving page-title and info-bar.
 */
function rebuildInnerHtml(decrypted, description, prose) {
    // Extract page-title
    const titleMatch = decrypted.match(/<h1[^>]*class="page-title"[^>]*>[\s\S]*?<\/h1>/);
    if (!titleMatch) { console.log('  WARNING: page-title not found; using empty'); }
    const titleHtml = titleMatch ? titleMatch[0] : '';

    // Extract info-bar
    const infoBarEx = extractDiv(decrypted, 'info-bar');
    if (!infoBarEx) { console.log('  WARNING: info-bar not found'); return null; }
    const infoBarHtml = decrypted.slice(infoBarEx.start, infoBarEx.end);

    // Build new description paragraph and prose section
    const descHtml  = `<p>${escHtml(description)}</p>`;
    const proseHtml = proseToHtml(prose);

    return `\n${titleHtml}\n\n${descHtml}\n\n${infoBarHtml}\n\n${proseHtml}\n`;
}

// ── Normalise for comparison ──────────────────────────────────────────────────

const norm = s => s.replace(/\s+/g, ' ').trim();

// ── Main ─────────────────────────────────────────────────────────────────────

let updated = 0, matched = 0, errors = 0;

for (const [htmlFile, txtFile] of Object.entries(FILE_MAP)) {
    const htmlPath = path.join(WRITING_DIR, htmlFile);
    const txtPath  = path.join(DESKTOP,     txtFile);

    process.stdout.write(`\n${htmlFile}\n`);

    if (!fs.existsSync(htmlPath)) { console.log('  SKIP: html not found'); errors++; continue; }
    if (!fs.existsSync(txtPath))  { console.log('  SKIP: txt not found');  errors++; continue; }

    const htmlRaw = fs.readFileSync(htmlPath, 'utf8');
    const txtRaw  = fs.readFileSync(txtPath,  'utf8');

    // ── Parse text file ──
    const parsed = parseTextFile(txtRaw);
    if (!parsed) { console.log('  ERROR: markers not found in text file'); errors++; continue; }
    const { description, prose } = parsed;

    // ── Extract enc-data ──
    const enc = extractEncData(htmlRaw);
    if (!enc) { console.log('  ERROR: enc-data not found'); errors++; continue; }

    // ── Decrypt ──
    let decrypted;
    try { decrypted = decrypt(enc.data); }
    catch (e) { console.log(`  ERROR: decrypt failed — ${e.message}`); errors++; continue; }

    // ── Extract current description (last <p> before info-bar) ──
    const infoBarIdx   = decrypted.indexOf('class="info-bar"');
    const beforeInfoBar = infoBarIdx !== -1 ? decrypted.slice(0, infoBarIdx) : decrypted;
    const allPs        = [...beforeInfoBar.matchAll(/<p(?:\s[^>]*)?>[\s\S]*?<\/p>/g)];
    const lastPHtml    = allPs.length ? allPs[allPs.length - 1][0] : '';
    const currentDesc  = norm(stripHtml(lastPHtml));

    // ── Extract current prose ──
    const proseEx     = extractDiv(decrypted, 'prose');
    const currentProse = proseEx ? norm(stripHtml(proseEx.inner)) : '';

    const targetDesc  = norm(description);
    const targetProse = norm(prose);

    const descOk  = currentDesc  === targetDesc;
    const proseOk = currentProse === targetProse;

    // We always rebuild to guarantee verbatim accuracy (HTML entities vs plain text
    // can cause false-positive matches even when content semantically differs).
    if (descOk && proseOk) {
        console.log('  Normalized text matches — rebuilding anyway for verbatim accuracy');
    } else {
        if (!descOk)  console.log('  MISMATCH: description differs');
        if (!proseOk) console.log('  MISMATCH: prose differs');
    }

    // ── Rebuild inner HTML ──
    const newInner = rebuildInnerHtml(decrypted, description, prose);
    if (!newInner) { console.log('  ERROR: rebuild failed'); errors++; continue; }

    // ── Re-encrypt ──
    const newEncData = encrypt(newInner.trim());
    const newEncJson = JSON.stringify(newEncData);

    // ── Write back ──
    const newHtml = replaceEncData(htmlRaw, enc.cs, enc.end, newEncJson);
    try {
        fs.writeFileSync(htmlPath, newHtml, 'utf8');
        console.log('  UPDATED');
        updated++;
    } catch (e) {
        console.log(`  ERROR: write failed — ${e.message}`);
        errors++;
    }
}

console.log(`\n════════════════════════════════`);
console.log(`Updated : ${updated}`);
console.log(`Matched : ${matched}`);
console.log(`Errors  : ${errors}`);
console.log(`════════════════════════════════\n`);
