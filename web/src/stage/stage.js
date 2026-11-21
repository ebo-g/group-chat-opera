// Stage controller: visuals only. Audio is driven separately from main.js.
import { renderCastRow } from './characters.js';

const MOODS = ['tense', 'romantic', 'comic', 'tragic', 'triumphant'];

let root = null;
let ui = {};
let castRowEl = null;
let singerMap = {};
let currentCast = null;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Resolves when `el` finishes its transform transition (with a safety timeout).
function transitionDone(el, maxMs = 2800) {
    return new Promise((resolve) => {
        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            el.removeEventListener('transitionend', onEnd);
            resolve();
        };
        const onEnd = (e) => {
            if (e.target === el && e.propertyName === 'transform') finish();
        };
        el.addEventListener('transitionend', onEnd);
        setTimeout(finish, maxMs);
    });
}

function countWords(text) {
    return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function moveSpotlightTo(el) {
    const stageRect = root.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    ui.spotlight.style.left = rect.left - stageRect.left + rect.width / 2 + 'px';
    ui.spotlight.classList.add('on');
}

function clearSinging() {
    Object.values(singerMap).forEach((el) => el.classList.remove('singing'));
}

export function initStage(containerEl, cast) {
    containerEl.innerHTML = '';
    root = document.createElement('div');
    root.className = 'stage-root';
    root.innerHTML = `
    <div class="stage-backdrop"></div>
    <div class="spotlight"></div>
    <div class="stage-floor"></div>
    <div class="cast-row"></div>
    <div class="surtitles">
      <div class="surtitle-speaker"></div>
      <div class="surtitle-lyric"></div>
      <div class="surtitle-direction"></div>
      <div class="surtitle-emotion"></div>
    </div>
    <div class="curtain curtain-left"></div>
    <div class="curtain curtain-right"></div>
    <div class="valance"></div>
    <div class="title-card">
      <div class="title-card-mood"></div>
      <div class="title-card-text"></div>
    </div>
    <div class="curtain-call">
      <button class="bravo-btn" type="button">Bravo!</button>
    </div>
  `;
    containerEl.appendChild(root);

    ui = {
        spotlight: root.querySelector('.spotlight'),
        castRow: root.querySelector('.cast-row'),
        speaker: root.querySelector('.surtitle-speaker'),
        lyric: root.querySelector('.surtitle-lyric'),
        direction: root.querySelector('.surtitle-direction'),
        emotion: root.querySelector('.surtitle-emotion'),
        curtainLeft: root.querySelector('.curtain-left'),
        titleCard: root.querySelector('.title-card'),
        titleMood: root.querySelector('.title-card-mood'),
        titleText: root.querySelector('.title-card-text'),
        callLayer: root.querySelector('.curtain-call'),
        bravo: root.querySelector('.bravo-btn'),
    };

    castRowEl = ui.castRow;
    currentCast = cast;
    singerMap = renderCastRow(castRowEl, cast);

    ui.bravo.addEventListener('click', spawnRoses);
    return root;
}

export async function openCurtains() {
    void root.offsetWidth; // force reflow so the transition runs
    root.classList.add('open');
    await transitionDone(ui.curtainLeft);
}

export async function closeCurtains() {
    void root.offsetWidth;
    root.classList.remove('open');
    ui.spotlight.classList.remove('on');
    clearSinging();
    await transitionDone(ui.curtainLeft);
}

export async function showScene(scene) {
    MOODS.forEach((m) => root.classList.remove('mood-' + m));
    if (scene.mood) root.classList.add('mood-' + scene.mood);

    ui.titleText.textContent = scene.title || '';
    ui.titleMood.textContent = scene.mood ? scene.mood : '';
    ui.titleCard.classList.add('show');
    await wait(2400);
    ui.titleCard.classList.remove('show');
    await wait(700); // let the fade-out finish
}

export async function playLine(line, castMember) {
    clearSinging();
    const singerEl = castMember ? singerMap[castMember.id] : null;
    if (singerEl) {
        moveSpotlightTo(singerEl);
        singerEl.classList.add('singing');
    }

    ui.speaker.textContent = castMember ? castMember.name : '';
    ui.speaker.style.color = castMember && castMember.color ? castMember.color : '';
    ui.lyric.textContent = line.lyric || '';
    ui.direction.textContent = line.direction ? `(${line.direction})` : '';
    ui.emotion.textContent = line.emotion || '';
    root.classList.add('has-surtitle');

    const duration = Math.max(1200, countWords(line.lyric) * 350);
    await wait(duration);

    if (singerEl) singerEl.classList.remove('singing');
}

export async function curtainCall(cast) {
    if (cast && cast !== currentCast) {
        currentCast = cast;
        singerMap = renderCastRow(castRowEl, cast);
    }
    clearSinging();
    ui.spotlight.classList.remove('on');
    ui.speaker.textContent = '';
    ui.lyric.textContent = '';
    ui.direction.textContent = '';
    ui.emotion.textContent = '';
    root.classList.remove('has-surtitle');

    root.classList.add('calling');
    Object.values(singerMap).forEach((el, i) => {
        el.style.setProperty('--bow-delay', i * 0.18 + 's');
    });

    void root.offsetWidth;
    root.classList.add('open'); // reopen curtains for the bows
    await transitionDone(ui.curtainLeft);
    ui.callLayer.classList.add('show');
}

function spawnRoses() {
    for (let i = 0; i < 24; i++) {
        const rose = document.createElement('span');
        rose.className = 'rose';
        rose.textContent = '🌹';
        rose.style.left = Math.random() * 96 + '%';
        rose.style.setProperty('--dur', 2.5 + Math.random() * 2.5 + 's');
        rose.style.setProperty('--delay', Math.random() * 1.2 + 's');
        rose.style.setProperty('--spin', (Math.random() > 0.5 ? 1 : -1) * (360 + Math.random() * 360) + 'deg');
        rose.addEventListener('animationend', () => rose.remove());
        ui.callLayer.appendChild(rose);
    }
}