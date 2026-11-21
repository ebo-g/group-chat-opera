import { buildCharacterSVG, sexOf } from './characters.js';

const VOICES = ['soprano', 'alto', 'tenor', 'baritone', 'bass'];
const NAME_MAX = 24;
// When the sex is changed, move the voice to the matching register.
const VOICE_FOR_SEX = {
    female: { tenor: 'soprano', baritone: 'alto', bass: 'alto' },
    male: { soprano: 'tenor', alto: 'baritone' },
};
const originalNames = new WeakMap();
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

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, (char) => '\\' + char);

/** Replace a renamed character's old name inside the libretto text (whole words only). */
function applyRenames(libretto, cast) {
    for (const member of cast) {
        const oldName = originalNames.get(member);
        if (!oldName || !member.name || member.name === oldName) continue;
        const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(oldName)}(?![\\p{L}\\p{N}])`, 'gu');
        const swap = (text) => (typeof text === 'string' ? text.replace(pattern, () => member.name) : text);
        libretto.title = swap(libretto.title);
        for (const scene of libretto.scenes || []) {
            scene.title = swap(scene.title);
            for (const line of scene.lines || []) {
                line.lyric = swap(line.lyric);
                line.direction = swap(line.direction);
            }
        }
        originalNames.set(member, member.name);
    }
}

function makeCastCard(member, index, requestPreview) {
    const castMember = member || {};
    const name = String(castMember.name || `Singer ${index + 1}`);
    if (!originalNames.has(castMember)) originalNames.set(castMember, name);
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

    const avatar = element('div', 'cast-card__avatar');
    avatar.setAttribute('aria-hidden', 'true');
    const refreshAvatar = () => { avatar.innerHTML = buildCharacterSVG(castMember); };
    refreshAvatar();
    card.appendChild(avatar);

    const fields = element('div', 'cast-fields');
    const nameLabel = element('label', 'cast-field');
    nameLabel.appendChild(element('span', '', 'Name'));
    const nameInput = element('input', 'cast-field__input');
    nameInput.type = 'text';
    nameInput.value = name;
    nameInput.maxLength = NAME_MAX;
    nameInput.setAttribute('aria-label', `Name for ${name}`);
    nameInput.addEventListener('input', () => {
        const typed = String(nameInput.value).trim().slice(0, NAME_MAX);
        castMember.name = typed || originalNames.get(castMember) || name; // never leave a singer nameless
        title.textContent = castMember.name;
        monogram.textContent = [...castMember.name][0]?.toUpperCase() || '♪';
        refreshAvatar();
    });
    nameLabel.appendChild(nameInput);

    const sexLabel = element('label', 'cast-field');
    sexLabel.appendChild(element('span', '', 'Sex'));
    const sexSelect = element('select', 'cast-field__input');
    for (const value of ['female', 'male']) {
        const option = element('option', '', value === 'female' ? 'Female' : 'Male');
        option.value = value;
        sexSelect.appendChild(option);
    }
    sexSelect.value = sexOf(castMember);
    sexSelect.setAttribute('aria-label', `Sex for ${name}`);
    sexLabel.appendChild(sexSelect);
    fields.append(nameLabel, sexLabel);
    card.appendChild(fields);

    const voiceFieldset = element('fieldset', 'cast-voices');
    voiceFieldset.appendChild(element('legend', '', 'Choose a voice'));
    const options = element('div', 'cast-voices__options');
    const selectedVoice = VOICES.includes(castMember.voice) ? castMember.voice : 'alto';
    const voiceInputs = [];
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
            refreshAvatar();
            requestPreview(castMember);
        });
        voiceInputs.push(input);
        label.append(input, labelText);
        options.appendChild(label);
    }
    voiceFieldset.appendChild(options);
    card.appendChild(voiceFieldset);

    // Changing sex re-dresses the singer and moves the voice to the matching register.
    sexSelect.addEventListener('change', () => {
        castMember.sex = sexSelect.value === 'female' ? 'female' : 'male';
        const moved = VOICE_FOR_SEX[castMember.sex][castMember.voice];
        if (moved) {
            castMember.voice = moved;
            voiceInputs.forEach((input) => { input.checked = input.value === moved; });
        }
        refreshAvatar();
        requestPreview(castMember);
    });
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
            applyRenames(libretto, cast);
            root.replaceChildren();
            resolve(libretto);
        });
        actions.appendChild(raiseCurtain);
        content.append(brand, title, introduction, cards, actions);
        screen.append(curtain, content);
        root.replaceChildren(screen);
    });
}