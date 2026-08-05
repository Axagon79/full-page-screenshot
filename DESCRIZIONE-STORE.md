# Descrizione Chrome Web Store — Full Page Screenshot

Fonte versionata dei testi della scheda store. La descrizione BREVE vive nel
`manifest.json` (va live col pacchetto, 9.9); la LUNGA si incolla a mano
nella dashboard sviluppatore → "Scheda dello Store" (live subito, nessun
pacchetto richiesto).

---

## Descrizione breve (manifest.json, max 132 caratteri — appare nei risultati di ricerca)

```
Full page screenshots, scrolling capture & scroll selection. Auto-copies to clipboard. No account, no tracking — 100% on-device.
```

(128 caratteri. Keyword coperte: full page screenshot, scrolling capture,
scroll selection, clipboard. Promessa privacy in chiusura.)

---

## Descrizione lunga — VERSIONE DEFINITIVA 05/08 (fusione: testo esistente dell'utente + sezione onesta + differenziatori; SOLO funzioni già pubblicate nella 9.8)

```
Full Page Screenshot — capture entire web pages, precise areas, or scrolling selections with a single click. Every capture is also copied straight to your clipboard, ready to paste with Ctrl+V.

THREE CAPTURE MODES

✔ Full Page — automatically scrolls and stitches the entire page into one image. Works on regular sites AND on web apps that scroll inside an internal panel (dashboards, chat apps).
✔ Visible Only — captures exactly what you see on screen, instantly.
✔ Select Area — drag to select a custom region, with auto-scroll when you reach the viewport edge: you can select areas taller than the screen. That's scroll selection — almost no other extension does it.

FEATURES

- Copy to clipboard — every screenshot is instantly copied, so you can paste it anywhere with Ctrl+V (toggle it on or off in settings)
- Saves to a "screenshots" folder inside your Downloads — no cloud, no account needed
- Smart detection of scrollable containers (not just the main page)
- Hides sticky headers/footers so they don't repeat in your screenshot
- Water-fill animation shows capture progress in real time
- Right-click the extension icon to change capture mode anytime

PRIVACY FIRST

Zero data collection, zero tracking, zero analytics. Everything stays on your device: your screenshots go to your Downloads folder and your clipboard, nowhere else.

WHAT IT DOESN'T DO (yet — honesty matters)

✘ PDF files opened in the browser: Chrome blocks extensions there, so full-page capture of PDFs isn't possible (no extension can). Visible capture works.
✘ Browser internal pages (chrome://, the Web Store): Chrome blocks capture there by design; the extension falls back to the visible screen where allowed.
✘ No image editor built in (annotations, arrows, blur) — on the roadmap.

If a page captures wrong, report it and it gets fixed — recent updates added support for web apps with internal scrolling and sites where the body handles the scroll.

If I helped you, leave a star or a comment — it's how other people find this extension.
```

DOPO la pubblicazione della 9.9, aggiungere a Select Area: "Push to the
very edge for turbo speed; when you're done, you're taken back to the
top." e agli update recenti: "admin consoles with fixed top bars".

---

## Descrizione lunga (prima bozza, superata dalla versione qui sopra)

```
Capture any web page — the whole page, just what you see, or exactly the area you choose. Even areas taller than your screen: drag near the edge and the page scrolls with you. That's scroll selection, and almost no other extension does it.

WHAT IT DOES

✔ Full Page — one click: scrolls the entire page for you and stitches everything into a single image, top to bottom. Works on regular sites AND on web apps that scroll inside an internal panel (dashboards, admin consoles, chat apps).

✔ Select Area — drag a rectangle around exactly what you need. If the selection is taller than the screen, keep dragging near the edge: the page auto-scrolls (push to the very edge for turbo speed). When you're done, you're taken back to the top.

✔ Visible Only — instant screenshot of what's on screen right now. No scrolling, no waiting.

✔ Copy to clipboard — every capture is automatically copied: just press Ctrl+V to paste it into a document, an email, a chat. The file is also saved to a "screenshots" folder inside your Downloads.

✔ Set your default mode once (right-click the icon → Capture Mode), then every capture is a single click on the icon.

PRIVACY FIRST

Everything happens on your device. No account, no sign-up, no cloud upload, no tracking, no data collection. Your screenshots are yours: they go to your Downloads folder and your clipboard, nowhere else.

WHAT IT DOESN'T DO (yet — honesty matters)

✘ PDF files opened in the browser: Chrome blocks extensions there, so full-page capture of PDFs isn't possible (no extension can). Visible-area capture works.
✘ Browser internal pages (chrome://, the Web Store): Chrome blocks capture there by design; the extension falls back to capturing the visible screen where allowed.
✘ No image editor built in (annotations, arrows, blur) — on the roadmap.

WHY USERS KEEP IT

Small, fast, no permissions beyond what capturing needs, and it does one job well. If a page captures wrong, report it and it gets fixed — recent updates added support for web apps with internal scrolling, sites where the body handles scrolling, and admin consoles with fixed top bars.

If I helped you, leave a star or a comment — it's how other people find this extension.
```

---

## Note operative

- La breve è già nel manifest (pronta per la 9.9).
- La lunga: dashboard → l'estensione → Scheda dello Store → campo
  Descrizione → incolla → Salva bozza → Invia. Le modifiche alla sola
  scheda passano una revisione leggera, di solito rapida.
- Keyword su cui insistiamo (dai dati: la parola d'oro è "scroll
  selection", nessun competitor la presidia): full page screenshot,
  scrolling screenshot/capture, scroll selection, capture area, clipboard.
- Tre pubblici della descrizione: algoritmo di ricerca dello store,
  persone, AI che consigliano estensioni (2 visite arrivate da
  chatgpt.com a luglio).
