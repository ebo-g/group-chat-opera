const VOICES = ['soprano', 'alto', 'tenor', 'baritone', 'bass'];
const PREVIEW_LINE = 'La la la, it is I, la la la!';

function safeColor(value) {
    return /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value || '')
        ? value
        : '#d4af37';
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function makeCastCard(member, index, requestPreview) {
    const castMember = member || {};
    const name = String(castMember.name || `Singer ${index + 1}`);
    const color = safeColor(castMember.color);
    const card = element('article', 'cast-card');
    card.setAttribute('role', 'listitem');
    card.style.setProperty('--cast-accent', color);

    const heading = element('div', 'cast-card__heading');
    const monogram = element('span', 'cast-card__monogram', [...name][0]?.toUpperCase() || '♪');
    monogram.setAttribute('aria-hidden', 'true');
    monogram.style.setProperty('--cast-accent', color);
    const identity = element('div', 'cast-card__identity');
    const title = element('h2', 'cast-card__name', name);
    const role = element('p', 'cast-card__role', String(castMember.role || 'Featured performer'));
    identity.append(title, role);

    const confidence = castMember.voiceConfidence === 'low'
        ? element('span', 'cast-card__confidence', '?')
        : null;
    if (confidence) {
        confidence.setAttribute('title', 'Voice assignment has low confidence');
        confidence.setAttribute('aria-label', 'Voice assignment has low confidence');
    }
    heading.append(monogram, identity);
    if (confidence) heading.appendChild(confidence);
    card.appendChild(heading);

    const colorRow = element('p', 'cast-card__color');
    const swatch = element('span', 'cast-card__swatch');
    swatch.style.setProperty('--cast-accent', color);
    swatch.setAttribute('aria-hidden', 'true');
    colorRow.append(swatch, element('span', '', `Costume colour ${color}`));
    card.appendChild(colorRow);

    const voiceFieldset = element('fieldset', 'cast-voices');
    voiceFieldset.appendChild(element('legend', '', 'Choose a voice'));
    const options = element('div', 'cast-voices__options');
    const selectedVoice = VOICES.includes(castMember.voice) ? castMember.voice : 'alto';
    for (const voice of VOICES) {
        const label = element('label', 'cast-voice');
        const input = element('input');
        input.type = 'radio';
        input.name = `cast-voice-${index}`;
        input.value = voice;
        input.checked = voice === selectedVoice;
        const labelText = element('span', 'cast-voice__label', voice);
        input.addEventListener('change', () => {
            if (!input.checked) return;
            castMember.voice = voice;
            requestPreview(castMember);
        });
        label.append(input, labelText);
        options.appendChild(label);
    }
    voiceFieldset.appendChild(options);
    card.appendChild(voiceFieldset);
    return card;
}

/** Show the cast introductions and resolve with the libretto after the curtain is raised. */
export function showCastScreen(libretto, audio = null) {
    const root = document.getElementById('opera-root');
    if (!root) return Promise.reject(new Error('Could not find the #opera-root element.'));
    const cast = Array.isArray(libretto?.cast) ? libretto.cast : [];

    return new Promise((resolve) => {
        let previewVersion = 0;
        let playedVersion = 0;
        let requestedMember;
        let previewTask;
        let confirming = false;

        function runQueuedPreview() {
            if (previewTask) return previewTask;
            previewTask = (async () => {
                while (playedVersion !== previewVersion) {
                    const version = previewVersion;
                    const member = requestedMember;
                    playedVersion = version;
                    try {
                        audio?.primeAudio?.();
                        await audio?.sing?.(PREVIEW_LINE, member);
                    } catch (error) {
                        console.warn('Voice preview failed:', error);
                    }
                }
            })().finally(() => {
                previewTask = undefined;
                if (playedVersion !== previewVersion) void runQueuedPreview();
            });
            return previewTask;
        }

        function requestPreview(member) {
            requestedMember = member;
            previewVersion += 1;
            void runQueuedPreview();
        }

        const screen = element('main', 'cast-screen');
        screen.setAttribute('aria-labelledby', 'cast-screen-title');
        const curtain = element('div', 'cast-screen__curtain');
        curtain.setAttribute('aria-hidden', 'true');
        const content = element('div', 'cast-screen__content');
        const brand = element('p', 'cast-screen__brand', 'THE CHAT ROOM OPERA COMPANY');
        const title = element('h1', 'cast-screen__title', 'Meet the Cast');
        title.id = 'cast-screen-title';
        const introduction = element('p', 'cast-screen__intro', 'Choose the voice that feels right. Each singer will give you a little preview.');
        const cards = element('div', 'cast-screen__cards');
        cards.setAttribute('role', 'list');
        if (cast.length) {
            cast.forEach((member, index) => cards.appendChild(makeCastCard(member, index, requestPreview)));
        } else {
            cards.appendChild(element('p', 'cast-screen__empty', 'The company is still assembling.'));
        }
        const actions = element('div', 'cast-screen__actions');
        const raiseCurtain = element('button', 'cast-screen__button', 'Raise the Curtain');
        raiseCurtain.type = 'button';
        raiseCurtain.addEventListener('click', async () => {
            if (confirming) return;
            confirming = true;
            raiseCurtain.disabled = true;
            await previewTask;
            root.replaceChildren();
            resolve(libretto);
        });
        actions.appendChild(raiseCurtain);
        content.append(brand, title, introduction, cards, actions);
        screen.append(curtain, content);
        root.replaceChildren(screen);
    });
}