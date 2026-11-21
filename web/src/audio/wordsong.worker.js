// Runs the word-singing DSP off the main thread so the stage animation never stutters.
import { singLyric, rapLyric } from './wordsong.js';

self.onmessage = (event) => {
  const { id, speech, sampleRate, text, member, mood, options, rap } = event.data;
  try {
    const result = rap ? rapLyric(speech, sampleRate, text, member, rap, options) : singLyric(speech, sampleRate, text, member, mood, options);
    if (!result) {
      self.postMessage({ id, result: null });
      return;
    }
    const { samples, sampleRate: rate, heard, expected, transposed } = result;
    self.postMessage({ id, result: { samples, sampleRate: rate, heard, expected, transposed } }, [samples.buffer]);
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) });
  }
};
