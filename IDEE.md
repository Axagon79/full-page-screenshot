# IDEE.md — Full Page Screenshot

Repo: github.com/Axagon79/full-page-screenshot
Cartella: C:\Progetti\full-page-screenshot\full-page-screenshot-extension\
Ultimo aggiornamento: 17 luglio 2026 (sera)
Versione corrente nel manifest: 9.8 (pubblicata sullo store)

---

## DECISIONI 17/07/2026

- Versioni 9.7 e 9.8 pubblicate sullo store: fix Full/Area su app con scroll
  interno (scocca fixed non più cancellata, sidebar non più ripetuta) e fix
  siti col body-scroller (es. betexplorer: lo scroll ora parte). **9.8 è la
  versione corrente** — nessun bump di versione/pacchetto per le feature qui
  sotto: restano nel codice in attesa del prossimo giro di pubblicazione.
- Fatte oggi, nel codice ma non ancora impacchettate: **#5 changelog**,
  **#7 restyling settings**, **#6 invito a recensire**, più una voce non
  presente in questa lista originaria — una sezione "How it works" nelle
  impostazioni che spiega a parole semplici le tre modalità, dove finisce il
  file (cartella "screenshots" dentro Download) e come cambiare modalità.
- **#6 corretta**: il meccanismo "4-5 stelle → store, 1-3 → form interno" è
  *review gating* e viola le policy del Chrome Web Store. Versione adottata:
  banner con ENTRAMBI i link sempre visibili (stella + feedback).
- Prossimo lavoro vero: **#1 Multi-snip stessa pagina** (deciso 17/07, non
  ancora iniziato).

---

## FEATURE IN CODA

### 1. Multi-snip stessa pagina
Selezioni più frammenti d'area sulla stessa pagina → "+ Aggiungi" → "✓ Salva".
Output a scelta: immagine unica verticale / file separati / testo unico (richiede OCR).
Riusa `doAreaCapture` + array `captures[]` + UI floating.
Nota: l'UI dei bottoni deve stare **sulla pagina** (overlay che resta aperto dopo la cattura), non nel popup — il popup si chiude quando l'utente scrolla.

### 2. Multi-snip cross-page (research clipper)
Frammenti da pagine diverse (Wikipedia → altra pagina → altra ancora) accumulati e cuciti in un documento unico, con link alla fonte.
**Va dopo il #1**: richiede persistenza in `chrome.storage.session` (gli appunti tengono una cosa sola; il contesto muore al cambio pagina). Il nucleo (selezione + accumulo + cucitura) si riusa dal #1.
Nota tecnica 17/07: `storage.session` ha limite 10MB — servirà compressione JPEG dei frammenti o permesso `unlimitedStorage` (ogni modifica ai permessi fa scattare revisione store più attenta).
Casi d'uso: ricercatori, giornalisti, avvocati, studenti, analisti. Nessun competitor lo fa in questa forma.

### 3. OCR (Tesseract.js, locale)
Estrarre testo dalle catture. Gira nel browser, gratis, ~100 lingue.
Serve dove il testo NON è selezionabile: immagini, PDF scansionati, pagine che bloccano il copia-incolla, canvas/Figma, codice dentro video.
**Locale, non cloud**: l'AI vision in cloud darebbe qualità superiore ma tradirebbe il posizionamento "privacy first, everything stays on your device" — e gli utenti sono USA su Windows/ChromeOS (scuole), dove la privacy è requisito, non vezzo.
Nota tecnica 17/07: il pacchetto cresce di ~15MB (WASM + dati lingua inglese inclusi, niente download esterni). Sui Chromebook scolastici sarà lento ma funzionante.

### 4. Editor avanzato
Annotazioni, frecce, blur sopra lo screenshot. Era voce roadmap Pro, mai dettagliata. Il più grosso dei quattro (canvas, strumenti, undo).

### 5. Changelog / what's-new dentro l'estensione — FATTO 17/07 (nel codice, non ancora pubblicato)
Avviso novità dopo un update, così le feature non escono in silenzio.
Meccanica implementata: `chrome.runtime.onInstalled` con `reason: "update"` → badge "NEW" sull'icona + avviso nelle impostazioni (NON nel popup a sorpresa: il popup parte subito con la cattura). Si spegne aprendo Capture Mode. Changelog per versione scritto in `settings.js` (oggetto `CHANGELOG`), da aggiornare a ogni versione con novità visibili.

### 6. Invito a recensire — FATTO 17/07 (nel codice, non ancora pubblicato)
Slogan scelto: **"Se ti ho aiutato, lascia una stella o un commento"** (in inglese: *"If I helped you, leave a star or a comment"*).
Prima persona — l'estensione parla, si vede che dietro c'è una persona. Niente lagna tipo "aiutami, sono piccolo".
Implementato in `sw.js`: dopo 15 catture riuscite (soglia `SOGLIA_INVITO_RECENSIONE`), banner sulla pagina, una volta sola, con ENTRAMBI i link sempre visibili — "★ Leave a star" (allo store) e "Tell me what to improve" (mailto). Stesso invito ripetuto in fondo a `settings.html`.
~~Se l'utente dà 4-5 stelle → store; se 1-3 → form interno di feedback.~~ **NO: è review gating, vietato dalle policy CWS.**
Nota: "stella o commento" perché "recensione" spaventa, la stella no.

### 7. Restyling settings.html — FATTO 17/07 (nel codice, non ancora pubblicato)
Era "un giocattolo". Sistemato:
- Via le emoji (📷📄👁️✂️) → SVG monocrome a contorno, stesso stile per tutte le icone
- Un solo colore d'accento, il ciano `#00d4ff` (prima: toggle verde + radio blu + Salva verde = look casuale)
- Card contenitore per ogni sezione, spaziature coerenti, respiro
- Aggiunta non prevista in origine: sezione "How it works" in fondo alla pagina — spiega a parole semplici le tre modalità, dove finisce il file salvato (cartella "screenshots" dentro Download, non Download direttamente — verificato nel codice `sw.js` dopo una correzione), e come cambiare modalità.

### 8. Descrizione store in elenco puntato
Rifare la descrizione con elenco chiaro **di quello che l'estensione fa davvero** (niente feature copiate dai concorrenti).
Includere una sezione onesta "cosa NON fa" (limiti): gestisce le aspettative e aumenta la fiducia.

### 9. Internazionalizzazione (`_locales/`)
Tradurre l'estensione (ora tutta in inglese).
**Bassa priorità**: i dati dicono che gli utenti sono quasi tutti USA. L'inglese pulito conta più delle traduzioni.

---

## MONETIZZAZIONE (discussa, non decisa)
Base gratis e completa; eventuale freemium: scroll selection / OCR / multi-snip come "Pro" ~$2.99/mese o $19/anno (sotto Nimbus). Stripe o Lemon Squeezy. Utenti esistenti grandfathered.
Il multi-snip cross-page giustificherebbe un prezzo più alto ($5-10/mese): è un'altra categoria di prodotto.

---

## LIMITI NOTI ARCHIVIATI (non bug, non da inseguire)
- **PDF full-page**: limite di piattaforma (Chrome blocca l'iniezione in PDFium). Nemmeno GoFullPage ci riesce. Lo risolverà il multi-snip.
- **YouTube modalità Area esce bianca**: lazy-loading React.
- **Chrome Web Store / pagine chrome://**: il browser vieta l'iniezione → fallback automatico al visibile (dalla 9.6).

---

## ANALISI DATI STORE 05/08/2026 (mese 5 lug – 3 ago)

Funnel del mese: ~286 impressioni → 86 visite scheda (~30% di click) →
69 installazioni (**~80% di conversione visita→install, eccezionale**).
Disinstallazioni 23 (concentrate a inizio luglio, pre-fix). Utenti
settimanali da 10 a 26 (+160%); 18-20 giornalieri su 26 settimanali =
uso quasi quotidiano. **La scheda converte benissimo: il collo di
bottiglia sono le impressioni (~10/giorno, piatte da giugno).**

Geografia CAMBIATA rispetto a giugno: USA fermi a 2-4 settimanali,
**India da 0 a 5 ed è la regione che cresce di più**, base sparsa su ~19
paesi. La narrativa "USA + scuole ChromeOS" non regge più. Inglese resta
la lingua giusta (India tech = inglese), #9 resta bassa priorità.

Canale emergente: 2 visite da **chatgpt.com** — le AI consigliano
estensioni leggendo la descrizione dello store. La #8 serve a tre
pubblici: algoritmo di ricerca, umani, AI.

Riflessione da seconda analisi (altro modello, riconciliata coi numeri):
il ~30% di click impressione→visita è già buono, MA il click è un
segnale di ranking (più click = più impressioni), quindi curare la
"carta" nei risultati di ricerca paga due volte. La carta è: icona +
titolo + **descrizione breve (132 caratteri)** + **stelle**. Punto
critico: **zero recensioni = zero stelle nei risultati**, probabile
freno principale al click — la leva è l'invito a recensire della 9.9.

---

## SCOPRIBILITÀ (lezione dai dati, giugno 2026)
Il collo di bottiglia della crescita **non è il prodotto** (zero disinstallazioni, chi installa tiene) ma la **visibilità**.
Il cambio titolo della 9.5 ("Full Page Screenshot - Scroll, Area & Full Capture") ha funzionato: impressioni da 1-2/giorno a 9-14/giorno. **Insistere su questa strada**: titolo, descrizione con keyword, recensioni.
La parola d'oro è **scroll selection** — nessun competitor la presidia.
Pubblico reale: USA, Windows + ChromeOS (1 al giorno costante = probabilmente scuole).
