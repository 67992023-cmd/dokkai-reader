# 読解 Reader

Photograph a Japanese reading passage, and it becomes an interactive study reader. Tap any word to see its reading (furigana), meaning and pronunciation. Printed questions become an interactive quiz, and the optional **Make Quiz** button writes extra practice questions.

It is a static single-page app (HTML, CSS, JavaScript) with no build step and no backend server, hosted for free on GitHub Pages.

## Supported Free AI Models & Providers

You can select your AI provider and model under **Settings**:

### 1. Google Gemini (Recommended)
Free API key from [Google AI Studio](https://aistudio.google.com/apikey).
- **Gemini 2.5 Flash:** Fast, multimodal, high quota (recommended default).
- **Gemini 2.5 Pro:** Flagship model, best accuracy for complex reading and JLPT grammar (free tier: 50 requests/day).
- **Gemini 2.0 Flash / Flash Lite:** Next-generation speed and lightweight options.
- **Gemini 1.5 Flash / 1.5 Pro:** Long-context predecessors.
- **Live refresh:** Tap *Refresh model list* to discover newly released models directly from Google.

### 2. OpenRouter (Open-source & Qwen models)
Free API key from [OpenRouter](https://openrouter.ai/keys).
- **Qwen 2.5 VL 72B (`:free`):** Top open-source vision language model running in the cloud.
- **Google Gemma 4 31B (`:free`):** Open multimodal model.
- **Meta Llama 3.2 11B Vision (`:free`):** Lightweight open vision.
- **Nemotron 3.5 Super VL (`:free`):** NVIDIA multimodal model.
- **Live refresh:** Discovers all currently active `:free` vision models on OpenRouter.

### 3. Groq (Ultra-fast inference)
Free API key from [Groq Console](https://console.groq.com/keys).
- **Llama 3.2 11B Vision**
- **Llama 3.2 90B Vision**

### 4. Custom Model ID
Type any model identifier supported by your selected provider.

---

## Two ways to create a reader

| | Automatic (API Key) | Gemini App (Manual) |
|---|---|---|
| Needs | Free API key (Gemini, OpenRouter, or Groq) | Any Gemini app account (Free or Pro) |
| Steps | Choose photos, tap Create Reader | Copy prompt, paste into Gemini with photos, paste JSON reply back |

> **Privacy & Security Note:** API keys are stored solely inside your browser's `localStorage` and sent directly to the model provider. They are never committed or published to GitHub.

---

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Publish to GitHub Pages

```sh
git add .
git commit -m "Support multiple free models and providers"
git branch -M main
git remote add origin https://github.com/<your-username>/N3ReadingStudy.git
git push -u origin main
```

On GitHub: **Settings → Pages → Build and deployment → Deploy from a branch (`main` / root) → Save**.
The site will be live at `https://<your-username>.github.io/N3ReadingStudy/`.

On iPhone: Open in Safari, tap **Share → Add to Home Screen** to install as a full-screen web app.

## File Structure

- [index.html](file:///Users/po/Desktop/N3ReadingStudy/index.html): Semantic layout, dialogs, and controls.
- [style.css](file:///Users/po/Desktop/N3ReadingStudy/style.css): Apple HIG design tokens, dark and light appearance.
- [app.js](file:///Users/po/Desktop/N3ReadingStudy/app.js): Multi-provider API routing, OCR parser, tokenizer, reader, quiz generator, and storage.
- [sample.js](file:///Users/po/Desktop/N3ReadingStudy/sample.js): Bundled sample reading passage.
