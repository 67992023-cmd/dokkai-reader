'use strict';

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const smooth = () => (reduceMotion() ? 'auto' : 'smooth');
const HAS_KANJI = /[\u3400-\u9fff\uf900-\ufaff々〆]/;
const LANG_CODE = { Thai: 'th', English: 'en', Japanese: 'ja', Chinese: 'zh', Korean: 'ko', Vietnamese: 'vi', Indonesian: 'id' };

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
  catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { alert('Browser storage is full. Delete a few passages and try again.'); return false; }
}

/* ---------- state ---------- */
const DEFAULTS = { apiKey: '', model: 'gemini-2.5-flash', lang: 'Thai', models: [] };
const settings = { ...DEFAULTS, ...load('settings', {}) };
const ui = { furi: true, tr: false, mode: '', ...load('ui', {}) };
let passages = load('passages', []);
let current = null;
let selected = null;

const savePassages = () => save('passages', passages);
const saveSettings = () => save('settings', settings);
const saveUi = () => save('ui', ui);

/* ---------- prompts and schemas ---------- */
const Q_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      number: { type: 'INTEGER' },
      prompt: { type: 'STRING' },
      options: { type: 'ARRAY', items: { type: 'STRING' } },
      answer: { type: 'INTEGER' },
      explanation: { type: 'STRING' },
    },
    required: ['number', 'prompt', 'options', 'answer', 'explanation'],
  },
};
const PASSAGE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    sentences: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          newParagraph: { type: 'BOOLEAN' },
          tokens: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { t: { type: 'STRING' }, r: { type: 'STRING' }, m: { type: 'STRING' } },
              required: ['t', 'r', 'm'],
            },
          },
          translation: { type: 'STRING' },
        },
        required: ['newParagraph', 'tokens', 'translation'],
      },
    },
    questions: Q_SCHEMA,
  },
  required: ['title', 'sentences', 'questions'],
};
const QUIZ_SCHEMA = { type: 'OBJECT', properties: { questions: Q_SCHEMA }, required: ['questions'] };

function passagePrompt(lang) {
  return `You are helping a Japanese learner (around JLPT N3) read a passage from the attached photo(s).

1. Read all Japanese text of the passage in reading order. If there are several photos, they are consecutive pages. Ignore page numbers and headers. Printed furigana is not part of the text, but use it to confirm readings.
2. Split the passage into sentences, and each sentence into words (tokens) the way a learner's dictionary would: particles separate, verbs and adjectives kept with their conjugation endings.
3. For every token give:
   - "t": the exact text as printed
   - "r": the reading in hiragana, only if the token contains kanji, otherwise ""
   - "m": a short meaning in ${lang} for this word in this context. For particles and grammar, a short note on its function. Punctuation tokens get "r": "" and "m": "".
   Joining all "t" values of a sentence must reproduce the original sentence exactly, including punctuation.
4. "translation": a natural ${lang} translation of the whole sentence.
5. "newParagraph": true if the sentence starts a new paragraph.
6. A numbered blank in the passage (for example 41, （41）, ＿41＿) becomes one token with "t" written as "【41】", "r": "", and "m" saying "blank 41" in ${lang}.
7. If the photos contain printed questions about the passage, put each one in "questions": "number" (the printed number, or 1, 2, 3 if unnumbered), "prompt" (the question text, "" for a fill-in blank), "options" (choice texts without their numbers), "answer" (0-based index of the correct option, your best judgement), "explanation" (short, in ${lang}). If there are no printed questions, use an empty array.
8. "title": a short title for the passage in Japanese.`;
}

function manualPassagePrompt(lang) {
  return `${passagePrompt(lang)}

Reply with only one JSON object in a code block, no other text, in exactly this shape:
{"title":"...","sentences":[{"newParagraph":true,"tokens":[{"t":"大阪","r":"おおさか","m":"..."},{"t":"に","r":"","m":"..."},{"t":"。","r":"","m":""}],"translation":"..."}],"questions":[{"number":41,"prompt":"","options":["...","...","...","..."],"answer":0,"explanation":"..."}]}`;
}

const passageText = p => p.sentences.map(s => s.tokens.map(t => t.t).join('')).join('\n');

function quizPrompt(p, manual) {
  const lang = p.lang || settings.lang;
  return `Here is a Japanese reading passage:

${passageText(p)}

Write 4 multiple-choice comprehension questions about it, in Japanese, at JLPT N3 level, in the style of the JLPT reading section. Each question has 4 options in Japanese. "answer" is the 0-based index of the correct option. "explanation" is a short explanation in ${lang} that points to the part of the passage with the answer. Number the questions from 1.${manual ? `

Reply with only one JSON object in a code block, no other text, in exactly this shape:
{"questions":[{"number":1,"prompt":"...","options":["...","...","...","..."],"answer":0,"explanation":"..."}]}` : ''}`;
}

/* ---------- Gemini API ---------- */
const API = 'https://generativelanguage.googleapis.com/v1beta';

function friendlyError(status, msg = '') {
  if ((status === 400 && /api key/i.test(msg)) || status === 401 || status === 403) return 'Gemini didn’t accept the API key. Check it in Settings.';
  if (status === 404) return `The model “${settings.model}” isn’t available. Choose another model in Settings.`;
  if (status === 429) return 'You’ve reached the free limit for now. Wait a minute and try again, or use the Gemini App tab.';
  if (status >= 500) return 'Gemini is busy right now. Try again in a moment.';
  return msg || `The request failed (${status}).`;
}

async function apiFetch(url, opts = {}) {
  let res;
  try { res = await fetch(url, opts); }
  catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('Couldn’t reach Gemini. Check your internet connection.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(friendlyError(res.status, data?.error?.message));
  return data;
}

async function gemini(parts, schema, signal) {
  const data = await apiFetch(`${API}/models/${encodeURIComponent(settings.model)}:generateContent`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
    }),
  });
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts || []).map(p => p.text || '').join('');
  if (cand?.finishReason === 'MAX_TOKENS') throw new Error('The passage is too long for one scan. Try fewer photos at a time.');
  if (!text) throw new Error(data.promptFeedback?.blockReason ? 'Gemini declined this image. Try a different photo.' : 'Gemini returned an empty answer. Try again.');
  return parseJSON(text);
}

const ver = n => { const m = n.match(/^gemini-(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
const isPreview = n => /(preview|exp)/.test(n);
function pickDefaultModel(list) {
  const flash = list.filter(n => /flash/.test(n) && !/lite/.test(n));
  const pool = flash.length ? flash : list;
  return [...pool].sort((a, b) => ver(b) - ver(a) || isPreview(a) - isPreview(b) || a.length - b.length)[0] || DEFAULTS.model;
}

async function refreshModels(key) {
  const data = await apiFetch(`${API}/models?pageSize=1000`, { headers: { 'x-goog-api-key': key } });
  const names = (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''))
    .filter(n => /^gemini-/.test(n) && !/(tts|image|embedding|audio|live|robotics|computer-use)/.test(n));
  settings.models = [...new Set(names)].sort((a, b) => ver(b) - ver(a) || a.localeCompare(b));
  if (!settings.models.includes(settings.model)) settings.model = pickDefaultModel(settings.models);
  saveSettings();
  return settings.models;
}

/* ---------- parsing and normalising ---------- */
function parseJSON(text) {
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1];
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('This reply doesn’t contain the reader data. Copy Gemini’s whole reply, including the code box.');
  try { return JSON.parse(s.slice(a, b + 1)); }
  catch { throw new Error('The reply looks cut off. Ask Gemini to send the complete JSON again, then paste it.'); }
}

const stripNum = s => String(s).replace(/^\s*[（(]?[1-9１-９][)）.．、]\s*/, '');
function normQs(list) {
  return (Array.isArray(list) ? list : []).map((q, i) => {
    const options = (q.options || []).map(stripNum).filter(Boolean);
    return {
      number: Number(q.number) > 0 ? Number(q.number) : i + 1,
      prompt: String(q.prompt || ''),
      options,
      answer: Math.min(Math.max(0, Number(q.answer) || 0), options.length - 1),
      explanation: String(q.explanation || ''),
    };
  }).filter(q => q.options.length >= 2);
}

function normPassage(o, lang) {
  const sentences = (o?.sentences || []).map(s => ({
    newParagraph: !!s.newParagraph,
    translation: String(s.translation || ''),
    tokens: (s.tokens || []).map(t => {
      const tt = String(t.t ?? ''), r = String(t.r ?? '');
      return { t: tt, r: HAS_KANJI.test(tt) && r !== tt ? r : '', m: String(t.m ?? '') };
    }).filter(t => t.t),
  })).filter(s => s.tokens.length);
  if (!sentences.length) throw new Error('No Japanese text was found. Try a sharper, well-lit photo.');
  const title = String(o.title || '').trim() || sentences[0].tokens.map(t => t.t).join('').slice(0, 20);
  return { id: uid(), created: Date.now(), title, lang, sentences, questions: normQs(o.questions), quiz: [] };
}

function makeSample() {
  const { S, Q } = SAMPLE;
  const sentences = S.map(([toks, tr], i) => ({
    newParagraph: [0, 5, 13].includes(i),
    translation: tr,
    tokens: [
      ...toks.split(';').map(k => {
        const f = k.split('/');
        return f.length < 3 ? { t: f[0], r: '', m: '' } : { t: f[0], r: f[1], m: f[2] };
      }),
      { t: '。', r: '', m: '' },
    ],
  }));
  const questions = Q.map(([number, options, answer, explanation]) => ({ number, prompt: '', options, answer, explanation }));
  return { id: uid(), created: Date.now(), title: '有栖川からの手紙', lang: 'Thai', sentences, questions, quiz: [], sample: true };
}

/* ---------- routing ---------- */
function showView(name) {
  $('#library').hidden = name !== 'library';
  $('#reader').hidden = name !== 'reader';
}
function route() {
  const m = location.hash.match(/^#\/p\/(.+)$/);
  const p = m && passages.find(x => x.id === decodeURIComponent(m[1]));
  closePanel(true);
  if (p) { current = p; showView('reader'); renderReader(); }
  else { current = null; showView('library'); renderLibrary(); }
  window.scrollTo(0, 0);
}
const openReader = id => { location.hash = '#/p/' + encodeURIComponent(id); };

/* ---------- library ---------- */
const CHEV = '<svg class="chev" viewBox="0 0 8 14" aria-hidden="true"><path d="m1 1 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const fmtDate = ts => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function renderLibrary() {
  const el = $('#libList');
  if (!passages.length) {
    el.innerHTML = `
      <div class="empty">
        <h2>No passages yet</h2>
        <p>Take a photo of a Japanese reading passage. It becomes a page where you can tap any word to see its reading and meaning.</p>
        <button type="button" class="btn secondary" id="trySample">Open Sample Passage</button>
      </div>`;
    $('#trySample').onclick = () => {
      const p = makeSample();
      passages.unshift(p);
      savePassages();
      openReader(p.id);
    };
    return;
  }
  el.innerHTML = `<ul class="list">${passages.map(p => {
    const bits = [fmtDate(p.created), `${p.sentences.length} sentences`];
    if (p.questions?.length) bits.push(`${p.questions.length} questions`);
    return `<li><button type="button" class="row" data-id="${esc(p.id)}">
      <span class="row-main"><span class="row-title" lang="ja">${esc(p.title)}</span><span class="row-sub">${bits.join(' · ')}</span></span>${CHEV}
    </button></li>`;
  }).join('')}</ul>`;
  $$('.row', el).forEach(b => { b.onclick = () => openReader(b.dataset.id); });
}

/* ---------- reader ---------- */
// Put furigana over the kanji only: お変わり / おかわり → お<ruby>変<rt>か</rt></ruby>わり
function rubyHTML(t, r) {
  const kana = c => !HAS_KANJI.test(c);
  let a = 0;
  while (a < t.length - 1 && a < r.length && t[a] === r[a] && kana(t[a])) a++;
  let b = 0;
  while (b < t.length - a - 1 && b < r.length - a && t[t.length - 1 - b] === r[r.length - 1 - b] && kana(t[t.length - 1 - b])) b++;
  const core = t.slice(a, t.length - b), rc = r.slice(a, r.length - b);
  if (!core || !rc) return `<ruby>${esc(t)}<rt>${esc(r)}</rt></ruby>`;
  return `${esc(t.slice(0, a))}<ruby>${esc(core)}<rt>${esc(rc)}</rt></ruby>${esc(t.slice(t.length - b))}`;
}

function sentenceHTML(s, i, lang) {
  const toks = s.tokens.map((t, k) => {
    if (!t.r && !t.m) return esc(t.t);
    const blank = /^【\d+】$/.test(t.t);
    const face = t.r ? rubyHTML(t.t, t.r) : esc(t.t);
    return `<span class="w${blank ? ' blank' : ''}" role="button" tabindex="0" data-s="${i}" data-k="${k}">${face}</span>`;
  }).join('');
  return `<span class="sent">${toks}<span class="tr" lang="${lang}">${esc(s.translation)}</span></span>`;
}

function renderReader() {
  const p = current;
  $('#readerTitle').textContent = p.title;
  $('#navTitle').textContent = p.title;
  const lang = LANG_CODE[p.lang] || '';
  const paras = [];
  p.sentences.forEach((s, i) => {
    if (!paras.length || (s.newParagraph && paras.at(-1).length)) paras.push([]);
    paras.at(-1).push(i);
  });
  $('#passage').innerHTML = paras.map(ix => `<p>${ix.map(i => sentenceHTML(p.sentences[i], i, lang)).join('')}</p>`).join('');
  applyToggles();
  renderQs($('#printedQs'), p.questions, 'p');
  renderQuiz();
}

function renderQuiz() {
  $('#quizStatus').hidden = true;
  renderQs($('#quizSec'), current.quiz, 'g');
  $('#mkQuiz').textContent = current.quiz?.length ? 'New Quiz' : 'Make Quiz';
}

function applyToggles() {
  $('#passage').classList.toggle('no-furi', !ui.furi);
  $('#passage').classList.toggle('show-tr', ui.tr);
  $('#tgFuri').setAttribute('aria-pressed', ui.furi);
  $('#tgTr').setAttribute('aria-pressed', ui.tr);
}

function renderQs(section, list, prefix) {
  const box = $('.qs', section);
  section.hidden = !list?.length;
  if (!list?.length) { box.innerHTML = ''; return; }
  box.innerHTML = list.map(q => `
    <div class="q" id="q-${prefix}-${q.number}">
      <div class="q-head"><span class="q-num">${q.number}</span>${q.prompt ? `<span class="q-prompt" lang="ja">${esc(q.prompt)}</span>` : ''}</div>
      <div class="opts" role="group" aria-label="Question ${q.number}">
        ${q.options.map((o, i) => `<button type="button" class="opt" data-i="${i}"><span class="opt-n">${i + 1}</span><span class="opt-t" lang="ja">${esc(o)}</span><span class="opt-mark"></span></button>`).join('')}
      </div>
      <p class="ex" hidden>${esc(q.explanation)}</p>
    </div>`).join('');
  $$('.q', box).forEach((el, qi) => {
    const q = list[qi];
    $$('.opt', el).forEach(b => {
      b.onclick = () => {
        const ok = Number(b.dataset.i) === q.answer;
        b.classList.add(ok ? 'ok' : 'bad');
        $('.opt-mark', b).textContent = ok ? 'Correct' : 'Incorrect';
        if (ok && q.explanation) $('.ex', el).hidden = false;
      };
    });
  });
}

/* word panel */
function selectWord(w) {
  const s = current.sentences[Number(w.dataset.s)];
  const t = s.tokens[Number(w.dataset.k)];
  selected?.classList.remove('on');
  selected = w;
  w.classList.add('on');
  const blank = t.t.match(/^【(\d+)】$/);
  if (blank) {
    const q = document.getElementById('q-p-' + blank[1]);
    if (q) {
      q.scrollIntoView({ behavior: smooth(), block: 'center' });
      q.classList.add('flash');
      setTimeout(() => q.classList.remove('flash'), 1400);
    }
  }
  showPanel(t, s, !!blank);
}

function showPanel(t, s, blank) {
  const panel = $('#wordPanel');
  const sentence = s.tokens.map(x => x.t).join('').replace(/【\d+】/g, '');
  panel.innerHTML = `
    <div class="wp-head">
      <div lang="ja"><span class="wp-surface">${esc(t.t)}</span>${t.r ? `<span class="wp-reading">${esc(t.r)}</span>` : ''}</div>
      <button type="button" class="link" id="wpClose">Done</button>
    </div>
    <p class="wp-meaning">${esc(t.m)}</p>
    <div class="wp-actions">
      ${blank ? '' : '<button type="button" class="btn tinted small" id="wpSay">Listen</button>'}
      <button type="button" class="btn tinted small" id="wpSaySent">Listen to Sentence</button>
    </div>
    <div class="wp-sent"><span class="wp-label">Sentence</span><p lang="${LANG_CODE[current.lang] || ''}">${esc(s.translation)}</p></div>`;
  panel.hidden = false;
  requestAnimationFrame(() => panel.classList.add('open'));
  document.body.classList.add('panel-open');
  $('#wpClose').onclick = () => closePanel();
  if (!blank) $('#wpSay').onclick = () => speak(t.r || t.t);
  $('#wpSaySent').onclick = () => speak(sentence);
}

function closePanel(instant) {
  const panel = $('#wordPanel');
  selected?.classList.remove('on');
  const prev = selected;
  selected = null;
  document.body.classList.remove('panel-open');
  panel.classList.remove('open');
  if (instant || reduceMotion()) panel.hidden = true;
  else setTimeout(() => { if (!panel.classList.contains('open')) panel.hidden = true; }, 260);
  if (!instant) prev?.focus({ preventScroll: true });
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP';
  const v = speechSynthesis.getVoices().find(x => /^ja[-_]JP$/i.test(x.lang));
  if (v) u.voice = v;
  u.rate = 0.9;
  speechSynthesis.speak(u);
}

/* quiz */
async function autoQuiz() {
  const p = current, st = $('#quizStatus'), btn = $('#mkQuiz');
  $('#quizSec').hidden = false;
  st.hidden = false;
  st.classList.remove('err');
  st.textContent = 'Writing questions about this passage…';
  btn.disabled = true;
  st.scrollIntoView({ behavior: smooth(), block: 'center' });
  try {
    const out = await gemini([{ text: quizPrompt(p, false) }], QUIZ_SCHEMA);
    const quiz = normQs(out.questions);
    if (!quiz.length) throw new Error('Gemini didn’t return any questions. Try again.');
    p.quiz = quiz;
    savePassages();
    if (current === p) renderQuiz();
  } catch (e) {
    if (current === p) {
      st.textContent = e.message;
      st.classList.add('err');
    }
  } finally {
    btn.disabled = false;
  }
}

/* ---------- copy ---------- */
async function copyText(text, btn) {
  const label = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  btn.textContent = 'Copied';
  setTimeout(() => { btn.textContent = label; }, 1800);
}

/* ---------- settings ---------- */
function fillModelSelect() {
  const list = settings.models?.length ? [...settings.models] : [DEFAULTS.model];
  if (!list.includes(settings.model)) list.unshift(settings.model);
  $('#sModel').innerHTML = list.map(n => `<option${n === settings.model ? ' selected' : ''}>${esc(n)}</option>`).join('');
}

function openSettings() {
  $('#sKey').value = settings.apiKey;
  $('#sLang').value = settings.lang;
  $('#sStatus').textContent = '';
  fillModelSelect();
  $('#settingsDlg').showModal();
}

$('#settingsForm').addEventListener('submit', () => {
  const key = $('#sKey').value.trim();
  const keyChanged = key !== settings.apiKey;
  settings.apiKey = key;
  settings.model = $('#sModel').value || settings.model;
  settings.lang = $('#sLang').value;
  saveSettings();
  if (keyChanged && key) refreshModels(key).catch(() => {});
});

$('#sRefresh').onclick = async () => {
  const key = $('#sKey').value.trim();
  const st = $('#sStatus');
  if (!key) { st.textContent = 'Enter an API key first.'; return; }
  st.textContent = 'Loading models…';
  try {
    const list = await refreshModels(key);
    fillModelSelect();
    st.textContent = `Found ${list.length} models. ${settings.model} is selected.`;
  } catch (e) {
    st.textContent = e.message;
  }
};

$('#settingsDlg').addEventListener('close', updateScanState);

/* ---------- scan ---------- */
let pending = [];
let abortCtl = null;
let busyTimer = null;
const BUSY_STEPS = ['Preparing photos', 'Reading the Japanese text', 'Splitting sentences into words', 'Adding readings and meanings', 'Writing translations', 'Checking the questions', 'Almost done'];

function setMode(mode) {
  ui.mode = mode;
  saveUi();
  const auto = mode === 'auto';
  $('#tabAuto').setAttribute('aria-selected', auto);
  $('#tabManual').setAttribute('aria-selected', !auto);
  $('#paneAuto').hidden = !auto;
  $('#paneManual').hidden = auto;
  $('#scanErr').hidden = true;
}

function updateScanState() {
  $('#noKey').hidden = !!settings.apiKey;
  $('#createAuto').disabled = !settings.apiKey || !pending.length;
  $('#createManual').disabled = !$('#pasteIn').value.trim();
}

function renderThumbs() {
  $('#thumbs').innerHTML = pending.map((p, i) => `
    <div class="thumb"><img src="${p.preview}" alt="Photo ${i + 1}">
      <button type="button" data-i="${i}" aria-label="Remove photo ${i + 1}"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="m1 1 8 8M9 1 1 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
    </div>`).join('');
  $$('#thumbs button').forEach(b => {
    b.onclick = () => { pending.splice(Number(b.dataset.i), 1); renderThumbs(); updateScanState(); };
  });
  $('.file-btn').firstChild.textContent = pending.length ? 'Add More Photos' : 'Choose Photos';
}

function prepImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 2000;
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const dataUrl = c.toDataURL('image/jpeg', 0.88);
      resolve({ mime: 'image/jpeg', data: dataUrl.split(',')[1], preview: dataUrl });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Couldn’t open “${file.name}”. Try a JPEG or PNG photo.`)); };
    img.src = url;
  });
}

function showScanError(msg) {
  const el = $('#scanErr');
  el.textContent = msg;
  el.hidden = false;
}

function setBusy(on) {
  $('#scanForm').hidden = on;
  $('#scanBusy').hidden = !on;
  clearInterval(busyTimer);
  if (on) {
    $('#scanErr').hidden = true;
    let i = 0;
    $('#busyText').textContent = BUSY_STEPS[0];
    busyTimer = setInterval(() => {
      i = Math.min(i + 1, BUSY_STEPS.length - 1);
      $('#busyText').textContent = BUSY_STEPS[i];
    }, 4500);
  }
}

function finishPassage(out) {
  const p = normPassage(out, settings.lang);
  passages.unshift(p);
  if (!savePassages()) { passages.shift(); return; }
  pending = [];
  renderThumbs();
  $('#pasteIn').value = '';
  $('#scanDlg').close();
  openReader(p.id);
}

function openScan() {
  setBusy(false);
  setMode(ui.mode || (settings.apiKey ? 'auto' : 'manual'));
  renderThumbs();
  updateScanState();
  $('#scanDlg').showModal();
}

$('#fileIn').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  $('#scanErr').hidden = true;
  for (const f of files) {
    try { pending.push(await prepImage(f)); }
    catch (err) { showScanError(err.message); }
  }
  renderThumbs();
  updateScanState();
});

$('#createAuto').onclick = async () => {
  setBusy(true);
  abortCtl = new AbortController();
  try {
    const parts = pending.map(p => ({ inline_data: { mime_type: p.mime, data: p.data } }));
    parts.push({ text: passagePrompt(settings.lang) });
    const out = await gemini(parts, PASSAGE_SCHEMA, abortCtl.signal);
    setBusy(false);
    finishPassage(out);
  } catch (e) {
    setBusy(false);
    if (e.name !== 'AbortError') showScanError(e.message);
  } finally {
    abortCtl = null;
  }
};

$('#createManual').onclick = () => {
  $('#scanErr').hidden = true;
  try { finishPassage(parseJSON($('#pasteIn').value)); }
  catch (e) { showScanError(e.message); }
};

const cancelScan = () => { abortCtl?.abort(); $('#scanDlg').close(); };
$('#busyCancel').onclick = () => { abortCtl?.abort(); };
$('#scanCancel').onclick = cancelScan;
$('#scanDlg').addEventListener('close', () => { abortCtl?.abort(); setBusy(false); });
$('#tabAuto').onclick = () => setMode('auto');
$('#tabManual').onclick = () => setMode('manual');
$('#goSettings').onclick = openSettings;
$('#pasteIn').addEventListener('input', updateScanState);
$('#copyPrompt').onclick = e => copyText(manualPassagePrompt(settings.lang), e.currentTarget);

/* ---------- manual quiz ---------- */
function openQuizDlg() {
  $('#quizPaste').value = '';
  $('#quizAdd').disabled = true;
  $('#quizErr').hidden = true;
  $('#quizDlg').showModal();
}
$('#quizCancel').onclick = () => $('#quizDlg').close();
$('#quizPaste').addEventListener('input', () => { $('#quizAdd').disabled = !$('#quizPaste').value.trim(); });
$('#copyQuizPrompt').onclick = e => copyText(quizPrompt(current, true), e.currentTarget);
$('#quizAdd').onclick = () => {
  try {
    const quiz = normQs(parseJSON($('#quizPaste').value).questions);
    if (!quiz.length) throw new Error('No questions were found in this reply.');
    current.quiz = quiz;
    savePassages();
    $('#quizDlg').close();
    renderQuiz();
    $('#quizSec').scrollIntoView({ behavior: smooth(), block: 'start' });
  } catch (e) {
    $('#quizErr').textContent = e.message;
    $('#quizErr').hidden = false;
  }
};

/* ---------- wiring ---------- */
$('#openSettings').onclick = openSettings;
$('#openScan').onclick = openScan;
$('#back').onclick = () => { location.hash = '#/'; };
$('#passage').addEventListener('click', e => {
  const w = e.target.closest('.w');
  if (w) selectWord(w);
});
$('#passage').addEventListener('keydown', e => {
  const w = e.target.closest('.w');
  if (w && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectWord(w); }
});
$('#tgFuri').onclick = () => { ui.furi = !ui.furi; saveUi(); applyToggles(); };
$('#tgTr').onclick = () => { ui.tr = !ui.tr; saveUi(); applyToggles(); };
$('#mkQuiz').onclick = () => (settings.apiKey ? autoQuiz() : openQuizDlg());
$('#delPassage').onclick = () => {
  if (!confirm(`Delete “${current.title}”? This can’t be undone.`)) return;
  passages = passages.filter(p => p !== current);
  savePassages();
  location.hash = '#/';
};
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#wordPanel').hidden && !document.querySelector('dialog[open]')) closePanel();
});
new IntersectionObserver(([e]) => {
  $('#navTitle').classList.toggle('visible', !e.isIntersecting && !$('#reader').hidden);
}, { rootMargin: '-44px 0px 0px 0px' }).observe($('#readerTitle'));
if ('speechSynthesis' in window) speechSynthesis.getVoices();

window.addEventListener('hashchange', route);
route();
