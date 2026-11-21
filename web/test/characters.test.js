import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCharacterSVG } from '../src/stage/characters.js';

test('cast illustrations include expressive faces and safely escaped labels', () => {
  const svg = buildCharacterSVG({
    id: 'bea',
    name: '<Bea & Co>',
    voice: 'soprano',
    color: '#b35fe8',
  });

  assert.match(svg, /aria-label="&lt;Bea &amp; Co&gt;"/);
  assert.match(svg, /linearGradient/);
  assert.match(svg, /class="mouth"/);
  assert.match(svg, /<ellipse cx=/);
  assert.match(svg, /<circle cx=/);
});

test('cast identities produce repeatable but distinct illustrated designs', () => {
  const cast = [
    { id: 'bea', name: 'Bea', voice: 'soprano', color: '#b35fe8' },
    { id: 'callum', name: 'Callum', voice: 'baritone', color: '#287f9e' },
    { id: 'josh', name: 'Josh', voice: 'tenor', color: '#a97d42' },
  ];
  const firstRender = cast.map(buildCharacterSVG);
  const secondRender = cast.map(buildCharacterSVG);

  assert.equal(new Set(firstRender).size, cast.length);
  assert.deepEqual(firstRender, secondRender);
});

test('unsafe costume colors fall back instead of entering SVG markup', () => {
  const svg = buildCharacterSVG({ name: 'Guest', color: 'red" onload="alert(1)' });

  assert.match(svg, /stop-color="#8888cc"/);
  assert.doesNotMatch(svg, /stop-color="red/);
});