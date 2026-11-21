import './stage/stage.css';
import './stage/castScreen.css';
import { showCastScreen } from './stage/castScreen.js';
import {
    initStage,
    openCurtains,
    showScene,
    playLine,
    closeCurtains,
    curtainCall,
} from './stage/stage.js';
import * as audio from './audio/index.js';
import { onLibretto } from './landing/index.js';

const app = document.getElementById('app');
if (!app) throw new Error('Could not find the #app element.');

const landingRoot = document.createElement('div');
landingRoot.id = 'landing-root';
const operaRoot = document.createElement('div');
operaRoot.id = 'opera-root';
operaRoot.style.display = 'none';

// Audio failures or stalled playback should not hold the visual performance.
const guardedAudio = (play, timeoutMs) => (...args) => {
    let timer;
    const timeout = new Promise((resolve) => {
        timer = window.setTimeout(resolve, timeoutMs);
    });
    return Promise.race([
        Promise.resolve()
            .then(() => play(...args))
            .catch((err) => console.warn('audio error:', err)),
        timeout,
    ]).finally(() => window.clearTimeout(timer));
};
const performanceAudio = {
    sing: guardedAudio(audio.sing, 35000),
    orchestra: guardedAudio(audio.orchestra, 8000),
    overture: guardedAudio(audio.overture, 8000),
    finale: guardedAudio(audio.finale, 8000),
};

let running = false;

export async function runOpera(libretto) {
    if (running) return;
    if (!libretto || !Array.isArray(libretto.cast) || !Array.isArray(libretto.scenes)) {
        console.error('Opera cannot start: the libretto is missing its cast or scenes.');
        return;
    }

    running = true;
    try {
        landingRoot.style.display = 'none';
        landingRoot.setAttribute('aria-hidden', 'true');
        operaRoot.style.display = 'block';
        operaRoot.removeAttribute('aria-hidden');

        const performance = await showCastScreen(libretto, audio);
        await audio.prepareOpera(performance);
        await audio.primeAudio();
        initStage(operaRoot, performance.cast);
        await Promise.all([openCurtains(), performanceAudio.overture()]);

        for (const scene of performance.scenes) {
            await showScene(scene);
            await performanceAudio.orchestra(scene.mood);

            for (const line of scene.lines) {
                const castMember = performance.cast.find((c) => c.id === line.cast);
                if (!castMember) {
                    console.warn('No cast member for line.cast =', line.cast);
                    continue;
                }
                const singing = performanceAudio.sing(line, castMember);
                await Promise.all([playLine(line, castMember, singing), singing]);
            }
        }

        await Promise.all([closeCurtains(), performanceAudio.finale()]);
        await curtainCall(performance.cast);
    } catch (err) {
        console.error('Opera failed:', err);
        operaRoot.style.display = 'none';
        operaRoot.setAttribute('aria-hidden', 'true');
        landingRoot.style.display = '';
        landingRoot.removeAttribute('aria-hidden');
    } finally {
        running = false;
    }
}

export async function previewOpera() {
    const response = await fetch('/mock-libretto.json');
    if (!response.ok) throw new Error(`Could not load the mock libretto (${response.status}).`);
    await runOpera(await response.json());
}

// Render the landing page before wrapping its live DOM, so the landing module's
// event listeners and #app-scoped queries continue to work after mounting.
onLibretto(runOpera);
while (app.firstChild) landingRoot.appendChild(app.firstChild);
app.append(landingRoot, operaRoot);

// The mock stage is available on demand without replacing the normal landing flow.
if (new URLSearchParams(window.location.search).get('preview') === '1') {
    previewOpera().catch((err) => console.error('Could not load mock libretto:', err));
}
