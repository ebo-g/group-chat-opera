import assert from 'node:assert/strict';
import test from 'node:test';

class FakeElement {
    constructor(tagName) {
        this.tagName = tagName; this.children = []; this.attributes = new Map(); this.listeners = new Map();
        this.style = { setProperty() {} }; this.disabled = false; this.checked = false; this.value = ''; this.textContent = ''; this.innerHTML = '';
    }
    append(...nodes) { this.children.push(...nodes); }
    appendChild(node) { this.children.push(node); return node; }
    replaceChildren(...nodes) { this.children = [...nodes]; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    addEventListener(type, cb) { this.listeners.set(type, [...(this.listeners.get(type) || []), cb]); }
    dispatch(type) { for (const cb of this.listeners.get(type) || []) cb({ target: this }); }
}
const root = new FakeElement('div');
globalThis.document = { createElement: (t) => new FakeElement(t), getElementById: (id) => (id === 'opera-root' ? root : null) };
const { showCastScreen } = await import('../src/stage/castScreen.js');
const all = (n) => [n, ...n.children.flatMap(all)];
const audio = () => ({ primeAudio() {}, sing: () => Promise.resolve() });

function libretto() {
    return {
        title: 'The Tragedy of Maddie',
        cast: [
            { id: 'c1', name: 'Maddie', role: 'Diva', voice: 'soprano', color: '#e0457b' },
            { id: 'c2', name: 'Tom', role: 'Fool', voice: 'tenor', color: '#2a9d8f' },
        ],
        scenes: [{ title: "Maddie's Fury", mood: 'comic', lines: [
            { cast: 'c1', lyric: 'Maddie demands the lasagne, Tomorrow!', direction: '(Maddie glares at Tom)', emotion: 'angry' },
            { cast: 'c2', lyric: 'Tomato? Tom is not a tomato, Maddie.', direction: 'Tom shrugs', emotion: 'meek' },
        ] }],
    };
}
const field = (nodes, label) => nodes.find((n) => n.attributes.get('aria-label') === label);

test('each card has a name field, a sex select and a character preview', async () => {
    const l = libretto();
    const p = showCastScreen(l, audio());
    const nodes = all(root);
    assert.equal(field(nodes, 'Name for Maddie').value, 'Maddie');
    assert.equal(field(nodes, 'Sex for Maddie').value, 'female');
    assert.equal(field(nodes, 'Sex for Tom').value, 'male');
    assert.equal(nodes.filter((n) => n.className === 'cast-card__avatar' && /sex-(female|male)/.test(n.innerHTML)).length, 2);
    nodes.find((n) => n.className === 'cast-screen__button').dispatch('click');
    await p;
});

test('renaming a character updates the cast and every mention in the libretto', async () => {
    const l = libretto();
    const p = showCastScreen(l, audio());
    const nodes = all(root);
    const input = field(nodes, 'Name for Maddie');
    input.value = '  Madeline (the Great)  ';
    input.dispatch('input');
    assert.equal(l.cast[0].name, 'Madeline (the Great)');
    assert.ok(nodes.some((n) => n.className === 'cast-card__name' && n.textContent === 'Madeline (the Great)'));
    const tom = field(nodes, 'Name for Tom');
    tom.value = 'Thomas';
    tom.dispatch('input');
    nodes.find((n) => n.className === 'cast-screen__button').dispatch('click');
    assert.equal(await p, l);
    const [a, b] = l.scenes[0].lines;
    assert.equal(l.title, 'The Tragedy of Madeline (the Great)');
    assert.equal(l.scenes[0].title, "Madeline (the Great)'s Fury");
    assert.equal(a.lyric, 'Madeline (the Great) demands the lasagne, Tomorrow!', 'whole words only: "Tomorrow" is untouched');
    assert.equal(a.direction, '(Madeline (the Great) glares at Thomas)');
    assert.equal(b.lyric, 'Tomato? Thomas is not a tomato, Madeline (the Great).', '"Tomato" is untouched');
});

test('clearing a name falls back to the original instead of leaving a nameless singer', async () => {
    const l = libretto();
    const p = showCastScreen(l, audio());
    const nodes = all(root);
    const input = field(nodes, 'Name for Tom');
    input.value = '   ';
    input.dispatch('input');
    assert.equal(l.cast[1].name, 'Tom');
    nodes.find((n) => n.className === 'cast-screen__button').dispatch('click');
    await p;
});

test('changing sex re-dresses the singer, moves the voice to the matching register and previews it', async () => {
    const l = libretto();
    const previews = [];
    const p = showCastScreen(l, { primeAudio() {}, sing: (line, member) => { previews.push({ voice: member.voice, sex: member.sex }); return Promise.resolve(); } });
    const nodes = all(root);
    const sex = field(nodes, 'Sex for Tom');
    sex.value = 'female';
    sex.dispatch('change');
    assert.deepEqual([l.cast[1].sex, l.cast[1].voice], ['female', 'soprano']);
    const checked = nodes.filter((n) => n.type === 'radio' && n.checked).map((n) => n.value);
    assert.deepEqual(checked, ['soprano', 'soprano'], 'the radio buttons follow');
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(previews.at(-1), { voice: 'soprano', sex: 'female' });
    sex.value = 'male';
    sex.dispatch('change');
    assert.deepEqual([l.cast[1].sex, l.cast[1].voice], ['male', 'tenor']);
    nodes.find((n) => n.className === 'cast-screen__button').dispatch('click');
    await p;
});
