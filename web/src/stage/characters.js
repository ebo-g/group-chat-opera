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

function hashString(value) {
    let hash = 2166136261;
    for (const character of String(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return hash >>> 0;
}

export function buildCharacterSVG(member) {
    const data = member || {};
    const p = PROFILES[data.voice] || PROFILES.tenor;
    const identity = data.id ?? data.name ?? 'singer';
    const variation = hashString(identity);
    const skin = safeColor(data.appearance?.skinColor) !== '#8888cc'
        ? safeColor(data.appearance.skinColor)
        : ['#f4cfac', '#dca982', '#b97854', '#8e5d47', '#f0d7b6'][variation % 5];
    const hairColor = safeColor(data.appearance?.hairColor) !== '#8888cc'
        ? safeColor(data.appearance.hairColor)
        : ['#241711', '#3b2118', '#6e3f24', '#b58a4c', '#292331'][Math.floor(variation / 5) % 5];
    const color = safeColor(data.color);
    const cx = 60;
    const headY = p.bodyTop - p.head + 4;
    const gradientId = `costume-${variation}`;

    const body = `M ${cx - p.shoulders} ${p.bodyTop + 8}
    Q ${cx} ${p.bodyTop - 12} ${cx + p.shoulders} ${p.bodyTop + 8}
    L ${cx + p.hem} 178 L ${cx - p.hem} 178 Z`;

    let hairBack = '';
    let hairTop = '';
    const hairstyle = p.hair === 'bald' && variation % 3 === 0 ? 'bald' : variation % 4;
    if (hairstyle === 0) {
        hairBack = `<path d="M ${cx - p.head} ${headY - 2} Q ${cx - p.head - 4} ${headY + p.head} ${cx - p.head + 2} ${headY + p.head * 2} L ${cx + p.head - 2} ${headY + p.head * 2} Q ${cx + p.head + 4} ${headY + p.head} ${cx + p.head} ${headY - 2} Z" fill="${hairColor}"/>`;
        hairTop = `<path d="M ${cx - p.head} ${headY} A ${p.head} ${p.head} 0 0 1 ${cx + p.head} ${headY} Q ${cx} ${headY - p.head * 0.85} ${cx - p.head} ${headY} Z" fill="${hairColor}"/>`;
    } else if (hairstyle === 1) {
        hairBack = `<g fill="${hairColor}"><circle cx="${cx - p.head * 0.8}" cy="${headY - p.head * 0.65}" r="${p.head * 0.48}"/><circle cx="${cx}" cy="${headY - p.head * 0.95}" r="${p.head * 0.52}"/><circle cx="${cx + p.head * 0.78}" cy="${headY - p.head * 0.55}" r="${p.head * 0.46}"/></g>`;
        hairTop = `<path d="M ${cx - p.head} ${headY} Q ${cx - p.head * 1.1} ${headY - p.head} ${cx} ${headY - p.head * 0.9} Q ${cx + p.head * 1.15} ${headY - p.head * 0.7} ${cx + p.head} ${headY} Q ${cx} ${headY - p.head * 0.15} ${cx - p.head} ${headY} Z" fill="${hairColor}"/>`;
    } else if (hairstyle === 2) {
        hairBack = `<path d="M ${cx - p.head} ${headY - 1} Q ${cx - p.head - 4} ${headY + p.head} ${cx - p.head + 1} ${headY + p.head * 1.5} L ${cx + p.head + 2} ${headY + p.head * 1.5} Q ${cx + p.head + 4} ${headY + p.head * 0.4} ${cx + p.head} ${headY - 1} Z" fill="${hairColor}"/>`;
        hairTop = `<path d="M ${cx - p.head} ${headY + 1} Q ${cx - p.head * 0.9} ${headY - p.head * 1.25} ${cx + p.head * 0.9} ${headY - p.head * 0.9} Q ${cx + p.head * 0.25} ${headY - p.head * 0.05} ${cx - p.head * 0.1} ${headY + 1} Z" fill="${hairColor}"/>`;
    } else if (hairstyle === 3) {
        hairBack = `<circle cx="${cx + p.head * 0.45}" cy="${headY - p.head * 0.95}" r="${p.head * 0.42}" fill="${hairColor}"/>`;
        hairTop = `<path d="M ${cx - p.head} ${headY + 1} A ${p.head} ${p.head} 0 0 1 ${cx + p.head} ${headY + 1} Q ${cx + p.head * 0.3} ${headY - p.head * 0.65} ${cx - p.head} ${headY + 1} Z" fill="${hairColor}"/>`;
    }

    const costumeDetail = variation % 3 === 0
        ? `<path d="M ${cx - 13} ${p.bodyTop + 30} L ${cx + 16} ${p.bodyTop + 76}" stroke="#f2d27b" stroke-width="4" opacity="0.85"/><circle cx="${cx + 7}" cy="${p.bodyTop + 53}" r="2.5" fill="#fff0c8"/>`
        : variation % 3 === 1
            ? `<path d="M ${cx - 11} ${p.bodyTop + 2} L ${cx} ${p.bodyTop + 22} L ${cx + 11} ${p.bodyTop + 2}" fill="${color}" stroke="#fff0c8" stroke-width="2.5"/><circle cx="${cx}" cy="${p.bodyTop + 39}" r="2.2" fill="#f2d27b"/><circle cx="${cx}" cy="${p.bodyTop + 53}" r="2.2" fill="#f2d27b"/>`
            : `<path d="M ${cx - p.hem + 4} 174 Q ${cx} 169 ${cx + p.hem - 4} 174" fill="none" stroke="#f2d27b" stroke-width="3" opacity="0.9"/><path d="M ${cx - p.shoulders + 4} ${p.bodyTop + 9} Q ${cx} ${p.bodyTop + 20} ${cx + p.shoulders - 4} ${p.bodyTop + 9}" fill="none" stroke="#fff0c8" stroke-width="2"/>`;

    return `<svg class="char-svg" viewBox="0 0 120 180" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(data.name)}">
    <defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#20152a"/></linearGradient></defs>
    ${hairBack}
    <path d="${body}" fill="url(#${gradientId})" stroke="#d4af37" stroke-width="2"/>
    <path d="M ${cx - 10} ${p.bodyTop + 2} L ${cx} ${p.bodyTop + 22} L ${cx + 10} ${p.bodyTop + 2}" fill="none" stroke="#f5e9c8" stroke-width="3"/>
    ${costumeDetail}
    <circle cx="${cx}" cy="${headY}" r="${p.head}" fill="${skin}" stroke="#8a6a4a" stroke-width="1.5"/>
    <ellipse cx="${cx - p.head * 0.58}" cy="${headY + p.head * 0.45}" rx="2.4" ry="1.3" fill="#d78678" opacity="0.45"/>
    <ellipse cx="${cx + p.head * 0.58}" cy="${headY + p.head * 0.45}" rx="2.4" ry="1.3" fill="#d78678" opacity="0.45"/>
    ${hairTop}
    <path d="M ${cx - p.head * 0.64} ${headY - 5} Q ${cx - p.head * 0.4} ${headY - 7} ${cx - p.head * 0.2} ${headY - 5}" fill="none" stroke="${hairColor}" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M ${cx + p.head * 0.2} ${headY - 5} Q ${cx + p.head * 0.4} ${headY - 7} ${cx + p.head * 0.64} ${headY - 5}" fill="none" stroke="${hairColor}" stroke-width="1.6" stroke-linecap="round"/>
    <ellipse cx="${cx - p.head * 0.38}" cy="${headY - 1}" rx="3" ry="3.5" fill="#fff5e8"/><ellipse cx="${cx + p.head * 0.38}" cy="${headY - 1}" rx="3" ry="3.5" fill="#fff5e8"/>
    <circle cx="${cx - p.head * 0.34}" cy="${headY - 1}" r="1.7" fill="#28202a"/><circle cx="${cx + p.head * 0.34}" cy="${headY - 1}" r="1.7" fill="#28202a"/>
    <ellipse class="mouth" cx="${cx}" cy="${headY + p.head * 0.45}" rx="${p.head * 0.3}" ry="2" fill="#73172b" stroke="#4b1020" stroke-width="0.8"/>
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