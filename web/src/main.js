// ============================================================
// GROUP CHAT: THE OPERA — FLOW ORCHESTRATOR
// Owned by B (jointly editable boundary with stage).
//
// Flow: landing -> overture -> each scene
//       (orchestra(mood), then for each line: playLine + sing together)
//       -> finale -> curtainCall
//
// CONTRACT.md's "stage" interface only guarantees playLine/showScene/
// curtainCall, and its "audio" interface guarantees sing/orchestra/
// overture/finale. The visual curtain open/close is ours (stage.js)
// but isn't part of the cross-team contract, so we run it in parallel
// with audio's overture()/finale() rather than exporting it as if it
// were the contract function of the same name.
//
// Audio is stubbed with timers until Person C's /web/src/audio module
// calls window.__setOperaAudio({ sing, orchestra, overture, finale })
// to override it. Landing (Person C) should call runOpera(libretto)
// once it has a libretto JSON from POST /api/libretto (or GET /api/sample).
//
// Real repo's index.html only provides a single <div id="app"></div> —
// it isn't owned by any one person in CONTRACT.md, so rather than edit it
// we build our own mount points inside #app here, and pull in stage.css
// as a JS import (standard Vite pattern) instead of a <link> tag.
// ============================================================

import './stage/stage.css';
import { initStage, openCurtains, showScene, playLine, closeCurtains, curtainCall } from './stage/stage.js';

// ---------------- mount points (built here since index.html just has #app) ----------------

const appEl = document.getElementById('app');
appEl.innerHTML = `
  <div id="landing-root"></div>
  <div id="opera-root" class="opera-root hidden"></div>
`;

// ---------------- audio stubs (replaced by Person C's audio.js) ----------------

let audioImpl = {
    // Stub: resolves after a reading-speed delay, same estimate stage.js uses
    // internally, so visuals and "singing" stay roughly in sync pre-integration.
    sing: (line) => {
        const wordCount = (line.lyric || '').trim().split(/\s+/).filter(Boolean).length;
        const duration = Math.max(1200, wordCount * 350);
        return new Promise((resolve) => setTimeout(resolve, duration));
    },
    // Stubs: real versions start/stop a Tone.js loop. overture/finale should
    // resolve once their respective musical stings finish (or immediately,
    // if they're just kicking off a background loop).
    orchestra: (_mood) => Promise.resolve(),
    overture: () => Promise.resolve(),
    finale: () => Promise.resolve(),
};

/**
 * Called by Person C's audio.js once Tone.js + speechSynthesis are wired up:
 *   import { sing, orchestra, overture, finale } from './audio/audio.js';
 *   window.__setOperaAudio({ sing, orchestra, overture, finale });
 */
window.__setOperaAudio = (impl) => {
    audioImpl = { ...audioImpl, ...impl };
};

// ---------------- main flow ----------------

/**
 * Runs the full opera from a libretto JSON object.
 * See CONTRACT_STAGE_NOTES.md for the expected shape.
 * @param {{title:string, cast:Array, scenes:Array}} libretto
 */
export async function runOpera(libretto) {
    const landingRoot = document.getElementById('landing-root');
    const operaRoot = document.getElementById('opera-root');

    if (landingRoot) landingRoot.classList.add('hidden');
    if (operaRoot) operaRoot.classList.remove('hidden');

    initStage(operaRoot, libretto.cast || []);

    // Visual curtain-open + audio overture sting run together.
    await Promise.all([openCurtains(), audioImpl.overture()]);

    for (const scene of libretto.scenes || []) {
        await showScene(scene);
        await audioImpl.orchestra(scene.mood);

        for (const line of scene.lines || []) {
            const castMember = (libretto.cast || []).find((c) => c.id === line.cast) || {
                id: line.cast,
                name: line.cast,
            };
            // Stage animation + singing audio run together; line advances once both finish.
            await Promise.all([playLine(line, castMember), audioImpl.sing(line, castMember)]);
        }
    }

    // Visual finale wash + audio finale sting run together.
    await Promise.all([closeCurtains(), audioImpl.finale()]);
    curtainCall(libretto.cast || []);
}

// ---------------- standalone preview ----------------
// If nothing else (landing.js) has taken ownership of startup by the time
// this module loads, auto-fetch the mock libretto so `index.html` works
// on its own for fast iteration on stage visuals.

if (!window.__OPERA_LANDING_WILL_START__) {
    // Vite serves /web/public at the site root, so the file at
    // web/public/mock-libretto.json is fetched as "/mock-libretto.json",
    // regardless of which page/route is currently loaded.
    fetch('/mock-libretto.json')
        .then((res) => res.json())
        .then((libretto) => runOpera(libretto))
        .catch((err) => {
            // eslint-disable-next-line no-console
            console.error('Stage standalone preview failed to load mock-libretto.json', err);
        });
}

