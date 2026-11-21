// End-of-battle scorecard: ranks the MCs, crowns a champion, quotes the line of the night,
// and lets people save the full lyrics. Pure DOM, no network.

const wordsOf = (text) => String(text || '').trim().split(/\s+/).filter(Boolean).length;

/** Deterministic "crowd noise" for a line: energy punctuation, questions, shouting, length. */
export function lineScore(line) {
  const text = String(line?.lyric || '');
  const bangs = (text.match(/!/g) || []).length;
  const qs = (text.match(/\?/g) || []).length;
  const caps = (text.match(/\b[A-Z]{3,}\b/g) || []).length;
  return 10 + bangs * 3 + qs * 2 + caps * 4 + Math.min(wordsOf(text), 18) / 3;
}

/** {standings:[{member, bars, words, score}], best:{member, line, score}} from a libretto. */
export function scoreBattle(libretto) {
  const cast = Array.isArray(libretto?.cast) ? libretto.cast : [];
  const rows = new Map(cast.map((member) => [String(member.id), { member, bars: 0, words: 0, score: 0 }]));
  let best = null;
  for (const scene of libretto?.scenes || []) {
    for (const line of scene.lines || []) {
      const row = rows.get(String(line.cast));
      if (!row) continue;
      const score = lineScore(line);
      row.bars += 2; // a lyric is a rhyming couplet = 2 bars
      row.words += wordsOf(line.lyric);
      row.score += score;
      if (!best || score > best.score) best = { member: row.member, line, score };
    }
  }
  const standings = [...rows.values()].filter((row) => row.bars > 0).sort((a, b) => b.score - a.score);
  return { standings, best };
}

export function lyricsText(libretto) {
  const name = (id) => (libretto.cast || []).find((c) => String(c.id) === String(id))?.name || id;
  const out = [libretto.title || 'Group Chat Rap Battle', ''];
  for (const scene of libretto.scenes || []) {
    out.push(`== ${scene.title} ==`);
    for (const line of scene.lines || []) out.push(`${name(line.cast)}: ${line.lyric}`);
    out.push('');
  }
  return out.join('\n');
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function showScorecard(root, libretto, { onReplay } = {}) {
  const { standings, best } = scoreBattle(libretto);
  if (!standings.length) return null;
  const card = el('section', 'scorecard');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Final scorecard');
  const panel = el('div', 'scorecard__panel');
  panel.appendChild(el('p', 'scorecard__eyebrow', 'FINAL SCORECARD'));
  panel.appendChild(el('h2', 'scorecard__title', `${standings[0].member.name} takes the crown`));
  panel.appendChild(el('p', 'scorecard__sub', libretto.title || ''));

  const top = standings[0].score;
  const list = el('ol', 'scorecard__list');
  standings.forEach((row, i) => {
    const item = el('li', 'scorecard__row');
    item.style.setProperty('--accent', /^#[0-9a-f]{3,8}$/i.test(row.member.color || '') ? row.member.color : '#ff2d95');
    item.appendChild(el('span', 'scorecard__rank', i === 0 ? '👑' : String(i + 1)));
    item.appendChild(el('span', 'scorecard__name', row.member.name));
    const bar = el('span', 'scorecard__bar');
    const fill = el('i');
    fill.style.width = `${Math.max(8, Math.round((row.score / top) * 100))}%`;
    bar.appendChild(fill);
    item.appendChild(bar);
    item.appendChild(el('span', 'scorecard__stat', `${row.bars} bars · ${row.words} words`));
    list.appendChild(item);
  });
  panel.appendChild(list);

  if (best) {
    const quote = el('blockquote', 'scorecard__quote');
    quote.appendChild(el('span', 'scorecard__quote-label', 'LINE OF THE NIGHT'));
    quote.appendChild(el('p', '', `“${best.line.lyric}”`));
    quote.appendChild(el('cite', '', `— ${best.member.name}`));
    panel.appendChild(quote);
  }

  const actions = el('div', 'scorecard__actions');
  const save = el('button', 'scorecard__button', 'Save the lyrics');
  save.type = 'button';
  save.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([lyricsText(libretto)], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'group-chat-rap-battle.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const again = el('button', 'scorecard__button scorecard__button--ghost', 'Run it back');
  again.type = 'button';
  again.addEventListener('click', () => (onReplay ? onReplay() : window.location.reload()));
  actions.append(save, again);
  panel.appendChild(actions);

  card.appendChild(panel);
  root.appendChild(card);
  return card;
}
