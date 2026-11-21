import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseChat, selectDramatic } from './parser.js';
import { validateLibretto } from './libretto.js';

const sample = readFileSync(new URL('./sample-chat.txt', import.meta.url), 'utf8');
const msgs = parseChat(sample);
const { senders, messages } = selectDramatic(msgs);

console.log(`parsed ${msgs.length} messages; top senders: ${senders.join(', ')}; selected ${messages.length}`);

// Sample chat
assert.equal(msgs.length, 60, 'sample should have 60 real messages');
assert.ok(!msgs.some((m) => /end-to-end|created group/.test(m.text)), 'system lines dropped');
assert.ok(!msgs.some((m) => /media omitted/i.test(m.text)), 'media dropped');
assert.ok(!msgs.some((m) => /7700/.test(m.text)), 'phone number stripped');
assert.ok(msgs.some((m) => m.text.includes('Step 2') && m.text.split('\n').length === 3), 'multi-line kept');
assert.equal(senders.length, 5);
assert.ok(!senders.includes('Gareth'), 'least active sender cut');

// iOS format + multi-line + system line
const ios = [
  '[12/03/2025, 18:03:11] Ann: hello',
  '[12/03/2025, 18:04:00] Ann: line one',
  'line two',
  '[12/03/2025, 18:05:00] Bob: ‎image omitted',
  '[12/03/2025, 18:06:00] Bob: call +1 (555) 123-4567 now',
  '[12/03/2025, 18:07:00] Bob changed the group description',
  '[12/03/2025, 18:08:00] ‪+44 7700 900123‬: who am i',
].join('\n');
const p = parseChat(ios);
assert.deepEqual(p.map((m) => m.sender), ['Ann', 'Ann', 'Bob', 'Mystery Guest']);
assert.equal(p[1].text, 'line one\nline two');
assert.equal(p[2].text, 'call now');

// Android 12-hour format
const a = parseChat('3/4/25, 9:05 PM - Zed: hi\n3/4/25, 9:06 PM - Zed: yo');
assert.equal(a.length, 2);

// 120-message cap picks a window
const big = Array.from({ length: 300 }, (_, i) => ({ sender: 'A' + (i % 3), text: i >= 100 && i < 220 ? 'NOOOO!!! WHY?!' : 'ok' }));
const sel = selectDramatic(big);
assert.equal(sel.messages.length, 120);
assert.ok(sel.messages.every((m) => m.text !== 'ok'), 'dramatic stretch chosen');

// Validator
assert.deepEqual(validateLibretto(JSON.parse(readFileSync(new URL('./mock-libretto.json', import.meta.url)))), []);
assert.ok(validateLibretto({}).length > 0);

console.log('all parser tests passed');
