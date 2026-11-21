import assert from 'node:assert/strict';
import test from 'node:test';

class FakeElement {
    constructor(tagName) {
        this.tagName = tagName;
        this.children = [];
        this.attributes = new Map();
        this.listeners = new Map();
        this.style = { properties: new Map(), setProperty: (name, value) => this.style.properties.set(name, value) };
        this.disabled = false;
        this.checked = false;
        this.value = '';
        this.textContent = '';
    }

    append(...nodes) { this.children.push(...nodes); }
    appendChild(node) { this.children.push(node); return node; }
    replaceChildren(...nodes) { this.children = [...nodes]; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    addEventListener(type, callback) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(callback);
        this.listeners.set(type, listeners);
    }
    dispatch(type) {
        for (const callback of this.listeners.get(type) || []) callback({ target: this });
    }
}

const root = new FakeElement('div');
globalThis.document = {
    createElement: (tagName) => new FakeElement(tagName),
    getElementById: (id) => id === 'opera-root' ? root : null,
};

const { showCastScreen } = await import('../src/stage/castScreen.js');

function descendants(node) {
    return [node, ...node.children.flatMap(descendants)];
}

function setupAudio(sing) {
    let primeCount = 0;
    return {
        api: { primeAudio: () => { primeCount += 1; }, sing },
        get primeCount() { return primeCount; },
    };
}

test('cast screen renders every voice option and marks low-confidence assignments', async () => {
    const libretto = {
        cast: [
            { id: 'c1', name: '<Mira>', role: 'The lead', voice: 'soprano', color: '#e0457b', voiceConfidence: 'low' },
            { id: 'c2', name: 'Noah', role: 'The witness', voice: 'bass', color: '#4a7fd1' },
        ],
    };
    const screenPromise = showCastScreen(libretto, setupAudio(() => Promise.resolve()).api);
    const nodes = descendants(root);
    const radios = nodes.filter((node) => node.type === 'radio');

    assert.equal(radios.length, 10);
    assert.equal(radios.filter((node) => node.checked).map((node) => node.value).join(','), 'soprano,bass');
    assert.equal(nodes.filter((node) => node.attributes.get('role') === 'listitem').length, 2);
    assert.equal(nodes.filter((node) => node.className === 'cast-card__confidence').length, 1);
    assert.ok(nodes.some((node) => node.textContent === '<Mira>'), 'cast names are rendered as text, not markup');
    assert.ok(nodes.some((node) => node.textContent === 'Costume colour #e0457b'));

    const button = nodes.find((node) => node.className === 'cast-screen__button');
    button.dispatch('click');
    assert.equal(await screenPromise, libretto);
    assert.equal(root.children.length, 0);
});

test('changing a voice updates the libretto and plays the preview before confirmation resolves', async () => {
    let finishPreview;
    const previews = [];
    const audio = setupAudio((line, member) => {
        previews.push({ line, member });
        return new Promise((resolve) => { finishPreview = resolve; });
    });
    const libretto = { cast: [{ id: 'c1', name: 'Mira', role: 'Lead', voice: 'alto', color: '#e0457b' }] };
    const screenPromise = showCastScreen(libretto, audio.api);
    const nodes = descendants(root);
    const bass = nodes.find((node) => node.type === 'radio' && node.value === 'bass');
    bass.checked = true;
    bass.dispatch('change');

    assert.equal(libretto.cast[0].voice, 'bass');
    assert.equal(previews.length, 1);
    assert.match(previews[0].line, /La la la, it is I/);
    assert.equal(previews[0].member, libretto.cast[0]);
    assert.equal(audio.primeCount, 1);

    let resolved = false;
    const result = screenPromise.then((value) => { resolved = true; return value; });
    nodes.find((node) => node.className === 'cast-screen__button').dispatch('click');
    await Promise.resolve();
    assert.equal(resolved, false, 'confirmation waits until the active preview has finished');

    finishPreview();
    assert.equal(await result, libretto);
});

test('rapid voice changes preview the latest choice without overlapping audio', async () => {
    const finishPreviews = [];
    const previews = [];
    const audio = setupAudio((line, member) => {
        previews.push(member.voice);
        return new Promise((resolve) => finishPreviews.push(resolve));
    });
    const libretto = { cast: [{ id: 'c1', name: 'Mira', role: 'Lead', voice: 'alto', color: '#e0457b' }] };
    const screenPromise = showCastScreen(libretto, audio.api);
    const nodes = descendants(root);
    const changeVoice = (voice) => {
        const radio = nodes.find((node) => node.type === 'radio' && node.value === voice);
        radio.checked = true;
        radio.dispatch('change');
    };

    changeVoice('tenor');
    changeVoice('baritone');
    nodes.find((node) => node.className === 'cast-screen__button').dispatch('click');
    assert.deepEqual(previews, ['tenor']);

    finishPreviews[0]();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(previews, ['tenor', 'baritone']);
    assert.equal(libretto.cast[0].voice, 'baritone');

    finishPreviews[1]();
    assert.equal(await screenPromise, libretto);
});