import { primeAudio } from '../audio/index.js';
import './landing.css';

const BACKSTAGE = [
  'Tuning the violins…',
  'Finding the most dramatic pause…',
  'Warming up the chorus…',
  'Setting the stage for one last “seen”…',
];

/** Render the landing page and deliver a libretto to the caller when ready. */
export function onLibretto(callback) {
  const root = document.getElementById('app');
  if (!root) throw new Error('Could not find the #app element.');

  root.innerHTML = `
    <main class="opera-landing">
      <header class="opera-brand"><span class="opera-brand-mark" aria-hidden="true">✦</span> THE CHAT ROOM OPERA COMPANY</header>
      <section class="opera-intro" aria-labelledby="opera-title">
        <div class="opera-copy">
          <p class="opera-eyebrow">A little drama, in three acts</p>
          <h1 id="opera-title">Group Chat:<br><em>The Opera</em></h1>
          <p class="opera-deck">Every missed reply has a story. Every “on my way” deserves an aria.</p>
          <div class="opera-upload-card">
            <label class="opera-dropzone" id="dropzone" for="chat-file">
              <span class="opera-upload-icon" aria-hidden="true">↑</span>
              <strong id="file-label">Drop a WhatsApp export here</strong>
              <span>or browse for a <b>.txt</b> file</span>
              <input id="chat-file" type="file" accept=".txt,text/plain" />
            </label>
            <button class="opera-primary" id="perform-chat" type="button" disabled>Turn this chat into an opera <span aria-hidden="true">↗</span></button>
            <div class="opera-divider"><span>or</span></div>
            <button class="opera-sample" id="use-sample" type="button">Use the sample chat <span aria-hidden="true">→</span></button>
            <p class="opera-privacy">Use a fictional chat, or one every participant agrees to share. Its text is sent to the opera composer.</p>
          </div>
        </div>
        <div class="opera-poster" aria-hidden="true">
          <div class="poster-halo"></div><div class="poster-curtain poster-curtain-left"></div><div class="poster-curtain poster-curtain-right"></div>
          <div class="poster-stage"><span class="poster-star">✳</span><span class="poster-chat">…</span><span class="poster-caption">TONIGHT ONLY<br>ONE UNREAD MESSAGE</span></div>
          <span class="poster-number">NO. 01 &nbsp; / &nbsp; THREE ACTS</span>
        </div>
      </section>
      <section class="opera-loading" id="loading" hidden aria-live="polite" aria-busy="true">
        <span class="loading-ornament" aria-hidden="true">✳</span><p class="opera-eyebrow">Backstage</p>
        <h2 id="loading-message">Tuning the violins…</h2><div class="loading-rule"><i></i></div>
        <p class="loading-note">Your curtain is about to rise.</p>
      </section>
      <p class="opera-error" id="error" role="alert" hidden></p>
      <footer class="opera-footer"><span>Made from messages, performed with feeling.</span><span>ACT I &nbsp;—&nbsp; THE BEGINNING</span></footer>
    </main>`;

  const input = root.querySelector('#chat-file');
  const dropzone = root.querySelector('#dropzone');
  const fileLabel = root.querySelector('#file-label');
  const perform = root.querySelector('#perform-chat');
  const sample = root.querySelector('#use-sample');
  const loading = root.querySelector('#loading');
  const loadingMessage = root.querySelector('#loading-message');
  const error = root.querySelector('#error');
  let chosenFile = null;
  let busy = false;
  let messageTimer;

  function selectFile(file) {
    if (!file) return;
    error.hidden = true;
    if (!file.name.toLowerCase().endsWith('.txt')) {
      error.textContent = 'Please choose a WhatsApp .txt export.';
      error.hidden = false;
      return;
    }
    chosenFile = file;
    fileLabel.textContent = file.name;
    perform.disabled = false;
  }

  async function performChat(chatText) {
    if (busy) return;
    busy = true;
    error.hidden = true;
    loading.hidden = false;
    root.querySelector('.opera-intro').hidden = true;
    root.querySelector('.opera-footer').hidden = true;
    sample.disabled = true;
    perform.disabled = true;
    void primeAudio(); // Unlock audio from this user gesture; no sound plays yet.
    let beat = 0;
    messageTimer = window.setInterval(() => {
      beat = (beat + 1) % BACKSTAGE.length;
      loadingMessage.textContent = BACKSTAGE[beat];
    }, 1500);

    try {
      const response = await fetch('/api/libretto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatText }),
      });
      if (!response.ok) throw new Error(`The composer returned ${response.status}. Please try again.`);
      const libretto = await response.json();
      if (!libretto || !Array.isArray(libretto.scenes)) throw new Error('The composer returned an unexpected libretto.');
      window.clearInterval(messageTimer);
      if (typeof callback === 'function') callback(libretto);
    } catch (cause) {
      window.clearInterval(messageTimer);
      loading.hidden = true;
      root.querySelector('.opera-intro').hidden = false;
      root.querySelector('.opera-footer').hidden = false;
      error.textContent = cause instanceof Error ? cause.message : 'Something went wrong. Please try again.';
      error.hidden = false;
      sample.disabled = false;
      perform.disabled = !chosenFile;
      busy = false;
    }
  }

  input.addEventListener('change', () => selectFile(input.files?.[0]));
  perform.addEventListener('click', async () => {
    if (!chosenFile) return;
    void primeAudio();
    try { await performChat(await chosenFile.text()); }
    catch { error.textContent = 'Could not read that file. Please try another .txt export.'; error.hidden = false; }
  });
  sample.addEventListener('click', async () => {
    if (busy) return;
    void primeAudio();
    busy = true;
    sample.disabled = true;
    error.hidden = true;
    try {
      const response = await fetch('/api/sample');
      if (!response.ok) throw new Error(`Could not load the sample chat (${response.status}).`);
      const chatText = await response.text();
      busy = false;
      await performChat(chatText);
    } catch (cause) {
      busy = false;
      sample.disabled = false;
      error.textContent = cause instanceof Error ? cause.message : 'Could not load the sample chat.';
      error.hidden = false;
    }
  });
  for (const type of ['dragenter', 'dragover']) dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add('is-dragging');
  });
  for (const type of ['dragleave', 'drop']) dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-dragging');
  });
  dropzone.addEventListener('drop', (event) => selectFile(event.dataTransfer?.files?.[0]));

  return () => window.clearInterval(messageTimer);
}
