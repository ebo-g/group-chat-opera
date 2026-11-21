import './stage/stage.css';
import {
    initStage,
    openCurtains,
    showScene,
    playLine,
    closeCurtains,
    curtainCall,
} from './stage/stage.js';

// ---- mount points (index.html only has #app) ----
const app = document.getElementById('app');

const landingRoot = document.createElement('div');
landingRoot.id = 'landing-root';
const operaRoot = document.createElement('div');
operaRoot.id = 'opera-root';
operaRoot.style.display = 'none';
app.append(landingRoot, operaRoot);

// ---- teammate C's modules (optional until they exist) ----
// import.meta.glob resolves at build time and returns {} if the file is missing,
// so this never breaks the dev server while C's folders are still empty.
const audioMods = import.meta.glob('./audio/index.js', { eager: true });
const landingMods = import.meta.glob('./landing/index.js', { eager: true });
const audioMod = Object.values(audioMods)[0] || {};
const landingMod = Object.values(landingMods)[0] || {};

const noop = () => Promise.resolve();
const audio = {
    sing: audioMod.sing || noop,
    orchestra: audioMod.orchestra || noop,
    overture: audioMod.overture || noop,
    finale: audioMod.finale || noop,
};

let running = false;

export async function runOpera(libretto) {
    if (running) return;
    running = true;
    try {
        landingRoot.style.display = 'none';
        operaRoot.style.display = 'block';

        initStage(operaRoot, libretto.cast);
        await Promise.all([openCurtains(), audio.overture()]);

        for (const scene of libretto.scenes) {
            await showScene(scene);
            await audio.orchestra(scene.mood);

            for (const line of scene.lines) {
                const castMember = libretto.cast.find((c) => c.id === line.cast);
                if (!castMember) {
                    console.warn('No cast member for line.cast =', line.cast);
                    continue;
                }
                await Promise.all([playLine(line, castMember), audio.sing(line, castMember)]);
            }
        }

        await Promise.all([closeCurtains(), audio.finale()]);
        await curtainCall(libretto.cast);
    } catch (err) {
        console.error('Opera failed:', err);
    } finally {
        running = false;
    }
}

// ---- startup ----
if (typeof landingMod.onLibretto === 'function') {
    landingMod.onLibretto(runOpera);
} else {
    // standalone preview: landing isn't wired up yet
    fetch('/mock-libretto.json')
        .then((res) => res.json())
        .then(runOpera)
        .catch((err) => console.error('Could not load mock libretto:', err));
}
