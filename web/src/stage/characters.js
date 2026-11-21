// Inline-SVG singers. Silhouette varies subtly with vocal register.

const PROFILES = {
    soprano:  { shoulders: 20, hem: 38, head: 16, hair: 'long',  bodyTop: 74 },
    alto:     { shoulders: 23, hem: 34, head: 17, hair: 'long',  bodyTop: 74 },
    tenor:    { shoulders: 26, hem: 30, head: 18, hair: 'short', bodyTop: 72 },
    baritone: { shoulders: 30, hem: 32, head: 19, hair: 'short', bodyTop: 70 },
    bass:     { shoulders: 35, hem: 37, head: 21, hair: 'bald',  bodyTop: 68 },
};

function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function safeColor(color) {
    return /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(color || '') ? color : '#8888cc';
}

export function buildCharacterSVG(member) {
    const p = PROFILES[member.voice] || PROFILES.tenor;
    const color = safeColor(member.color);
    const cx = 60;
    const headY = p.bodyTop - p.head + 4;

    const body = `M ${cx - p.shoulders} ${p.bodyTop + 8}
    Q ${cx} ${p.bodyTop - 12} ${cx + p.shoulders} ${p.bodyTop + 8}
    L ${cx + p.hem} 178 L ${cx - p.hem} 178 Z`;

    let hairBack = '';
    let hairTop = '';
    if (p.hair === 'long') {
        hairBack = `<rect x="${cx - p.head - 2}" y="${headY - 2}" width="${(p.head + 2) * 2}" height="${p.head * 2.2}" rx="${p.head}" fill="#2a1a12"/>`;
    }
    if (p.hair !== 'bald') {
        hairTop = `<path d="M ${cx - p.head} ${headY} A ${p.head} ${p.head} 0 0 1 ${cx + p.head} ${headY} Q ${cx} ${headY - p.head * 0.6} ${cx - p.head} ${headY} Z" fill="#2a1a12"/>`;
    }

    return `<svg class="char-svg" viewBox="0 0 120 180" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(member.name)}">
    ${hairBack}
    <path d="${body}" fill="${color}" stroke="#d4af37" stroke-width="2"/>
    <path d="M ${cx - 10} ${p.bodyTop + 2} L ${cx} ${p.bodyTop + 22} L ${cx + 10} ${p.bodyTop + 2}" fill="none" stroke="#f5e9c8" stroke-width="3"/>
    <circle cx="${cx}" cy="${headY}" r="${p.head}" fill="#f1c9a5" stroke="#8a6a4a" stroke-width="1.5"/>
    ${hairTop}
    <circle cx="${cx - p.head * 0.38}" cy="${headY - 2}" r="2" fill="#222"/>
    <circle cx="${cx + p.head * 0.38}" cy="${headY - 2}" r="2" fill="#222"/>
    <ellipse class="mouth" cx="${cx}" cy="${headY + p.head * 0.45}" rx="${p.head * 0.28}" ry="1.6" fill="#7a1020"/>
  </svg>`;
}

export function renderCastRow(rowEl, cast) {
    rowEl.innerHTML = '';
    const lookup = Object.create(null);
    (cast || []).forEach((member) => {
        const singerData = member || {};
        const singer = document.createElement('div');
        singer.className = 'singer voice-' + esc(singerData.voice);
        singer.dataset.castId = String(singerData.id == null ? '' : singerData.id);
        singer.setAttribute('role', 'listitem');
        singer.style.setProperty('--accent', safeColor(singerData.color));
        singer.innerHTML = `
      <div class="char">${buildCharacterSVG(singerData)}</div>
      <div class="nameplate">
        <strong>${esc(singerData.name)}</strong>
        <span>${esc(singerData.role)}</span>
      </div>`;
        rowEl.appendChild(singer);
        lookup[singerData.id] = singer;
    });
    return lookup;
}