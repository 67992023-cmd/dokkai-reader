# 読解 Reader

Photograph a Japanese reading passage, and it becomes a page where you can tap any word to see its reading, meaning and pronunciation. Printed questions become an interactive quiz, and the optional **Make Quiz** button writes extra practice questions.

It's a static site (HTML, CSS, JavaScript) with no build step and no server, so it runs free on GitHub Pages.

## Two ways to create a reader

| | Automatic | Gemini App |
|---|---|---|
| Needs | Free Gemini API key | Your Gemini subscription (or free Gemini) |
| Steps | Choose photos, tap Create Reader | Copy prompt, paste into Gemini with photos, paste reply back |

Get a free API key at https://aistudio.google.com/apikey, then paste it in **Settings**.

> The key is stored only in your browser (`localStorage`). It is never part of the code, so it is safe to publish this repository.

## Run locally

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Publish on GitHub Pages

```sh
git init
git add .
git commit -m "Reader"
git branch -M main
git remote add origin https://github.com/<your-username>/N3ReadingStudy.git
git push -u origin main
```

Then on GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / root → Save**.
The site appears at `https://<your-username>.github.io/N3ReadingStudy/`.

On iPhone, open it in Safari and choose **Share → Add to Home Screen** to use it like an app.

## Files

- `index.html`: layout and dialogs
- `style.css`: design tokens, light and dark appearance
- `app.js`: scanning, Gemini calls, reader, quiz, storage
- `sample.js`: the sample passage

Passages are saved in your browser only. Clearing site data removes them.
