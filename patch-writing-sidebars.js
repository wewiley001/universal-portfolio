// Add game-design-documentation card to all writing page sidebars and fix tags
'use strict';
const fs   = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'writing');

const OLD_SNIP = `        <a href="easy-characters-the-dnd-way.html" class="card">
            <div class="card-thumb"><img src="img/hero/easy-characters-the-dnd-way-hero.jpg" alt="Easy Characters the D&amp;D Way" loading="lazy"></div>
            <div class="card-body"><span class="card-title">Easy Characters the D&amp;D Way</span><span class="card-tag">Essay</span></div>
        </a>
    </aside>`;

const NEW_SNIP = `        <a href="easy-characters-the-dnd-way.html" class="card">
            <div class="card-thumb"><img src="img/hero/easy-characters-the-dnd-way-hero.jpg" alt="Easy Characters the D&amp;D Way" loading="lazy"></div>
            <div class="card-body"><span class="card-title">Easy Characters the D&amp;D Way</span><span class="card-tag">Essay</span></div>
        </a>
        <a href="game-design-documentation.html" class="card">
            <div class="card-thumb"><img src="img/hero/game-design-documentation-hero.jpg" alt="Game Design Documentation" loading="lazy"></div>
            <div class="card-body"><span class="card-title">Game Design Documentation</span><span class="card-tag">Documentation</span></div>
        </a>
    </aside>`;

const SIDEBAR_FILES = [
    'an-oncoming-storm.html','blog-archive.html','can-you-roleplay-history.html',
    'college-essay-on-kotor.html','easy-characters-the-dnd-way.html','horror-encoded.html',
    'iron-gunsmoke-and-moonslight.html','portside-rhapsody.html','space-assault.html',
    'the-man-from-the-mojave.html','the-undercity.html','the-vale.html',
    'troubled-night.html','welcome-to-the-jungle.html','whiskey-revovler.html',
    'witches-in-the-brush.html','writing-the-arcane-theorem.html'
];

let ok = 0, miss = 0;
for (const f of SIDEBAR_FILES) {
    const fp = path.join(DIR, f);
    let content = fs.readFileSync(fp, 'utf8');
    // Normalise line endings for matching, then restore
    const hasCRLF = content.includes('\r\n');
    const norm = hasCRLF ? content.replace(/\r\n/g, '\n') : content;
    const normOld = OLD_SNIP.replace(/\r\n/g, '\n');
    const normNew = NEW_SNIP.replace(/\r\n/g, '\n');
    if (norm.includes(normOld)) {
        const updated = norm.replace(normOld, normNew);
        fs.writeFileSync(fp, hasCRLF ? updated.replace(/\n/g, '\r\n') : updated, 'utf8');
        console.log(`OK:   ${f}`);
        ok++;
    } else {
        console.log(`MISS: ${f}`);
        miss++;
    }
}
console.log(`\n${ok} updated, ${miss} missed.`);
