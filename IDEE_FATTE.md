# IDEE_FATTE.md — Full Page Screenshot

Archivio delle idee realizzate e delle note precedenti.
Aggiornato il **20/09/2026**; commit e verifiche indicati nelle singole voci.
Per le attività ancora aperte usare esclusivamente [IDEE.md](IDEE.md).

Le date «Ideata il» indicano la data documentata, non una data inventata di prima discussione.
«Realizzata il» indica la presenza nel codice; non implica pubblicazione sullo Store.
Il riordino storico dell'11/09 non aveva eseguito nuovi collaudi; le verifiche successive sono indicate nelle singole voci.

## 20/09/2026 — Errore di salvataggio Area su MDN: chiusura confermata

**Ideata il:** 20/09/2026, dalla segnalazione dell'utente del messaggio «Image too large to save».
**Realizzata il:** 20/09/2026, verifica e chiusura esplicitamente confermata dall'utente; nessuna nuova correzione dedicata.

- Il confronto ha confermato la stessa cartella del progetto, ma un codice di cattura diverso già caricato nel browser dell'utente.
- Dopo aver ricaricato l'estensione, l'utente ha riprovato e confermato che l'errore era sparito, approvando la chiusura della segnalazione.
- L'URL infine precisata dall'utente è `https://developer.mozilla.org/en-US/docs/Web`. Le prove automatiche precedenti erano sulla diversa pagina `/en-US/docs/Web/CSS`: non vanno presentate come prove automatiche della pagina `/Web`.
- La chiusura riguarda soltanto questo errore di salvataggio, non il bug della recensione sulle colonne né i tagli pubblicitari ancora presenti su Yahoo. Non dimostra una causa specifica nel bordo destro o un limite effettivo delle dimensioni.

File: confronto delle funzioni in `full-page-screenshot-extension/sw.js` e `capture-control.js`; dettagli delle prove in `tools/README.md`. Nessun nuovo test durante l'archiviazione.
Commit del codice e delle prove confrontate: `02bd727`; nessun nuovo fix dedicato a questo errore. La chiusura è documentale e approvata dall'utente. Manifest, ZIP e Store invariati.

## 20/09/2026 — Stop e pannellino di avanzamento

**Ideata il:** 20/09/2026, dalla richiesta dell'utente di interrompere le catture lunghe.
**Realizzata il:** 20/09/2026; soluzione approvata dall'utente con richiesta di commit e push.

- Stop sull'icona dell'estensione con un clic durante Full Page e Area, anche quando aggiungono un pezzo a Multi Snip; disponibile anche Esc. Visible Only mantiene l'icona normale.
- L'annullamento interrompe gli scatti successivi, ripristina le modifiche temporanee e lo scorrimento della pagina, senza salvare immagini incomplete. Non annulla un'immagine completa già consegnata al salvataggio.
- In Multi Snip conserva la raccolta, i pezzi precedenti e il cestino; i percorsi dal widget e dall'editor usano lo stesso controllo della cattura.
- Pannellino bianco compatto in alto a destra, con percentuale e barra semplice, senza coprire Stop. Viene nascosto durante ogni scatto e rimosso alla fine; l'utente ha accettato il possibile lampeggio. Nessuna colonna laterale, finestra separata o percentuale sopra l'icona.
- I risultati immagine vuoti vengono rifiutati con un messaggio, evitando il download TXT vuoto. La divisione delle pagine enormi in immagini dentro uno ZIP resta da implementare.

Verifiche precedentemente autorizzate: controlli automatici di Stop, salvataggio, ripristino e percorsi Multi Snip superati con chiamate Chrome simulate; controlli della resa reale del pannellino in Edge a larghezze 1280 e 390, su sfondo chiaro e scuro, compresa l'esclusione dallo scatto. Non equivalgono a una prova automatica del clic sulla barra strumenti dell'estensione installata. Gli esperimenti precedenti non riusciti o con aspettative superate sono distinti in `tools/README.md`. Nessun nuovo collaudo eseguito durante il commit.

File: `full-page-screenshot-extension/capture-control.js`, `sw.js`, `popup.js`, `stop_94.png`; strumenti di prova e relative note in `tools/`.
Commit: `2db11ed`.
Il bug della recensione sulle colonne laterali **resta aperto**; le modifiche preliminari già presenti non sono dichiarate risolutive. Manifest ancora **9.11**; ZIP e Store non aggiornati.

## 20/09/2026 — Menu duplicato e sfondo discontinuo su AI Tarot

**Ideata il:** 20/09/2026, dalla segnalazione e dalle prove dell'utente nella chat.
**Realizzata il:** 20/09/2026; chiusura confermata dall'utente.

- Nelle catture lunghe Full Page e Area il menu non viene ripetuto quando i suoi discendenti hanno una transizione di visibilità ancora in corso.
- Gli elementi già esclusi dalla cattura vengono resi trasparenti soltanto durante lo scatto; l'opacità originale viene ripristinata anche se lo scatto fallisce, senza interrompere le transizioni di dimensioni o posizione.
- Il riconoscimento degli elementi ancorati usa uno spostamento immediato, anche sui siti con scorrimento animato.
- I fondi decorativi fissi compatibili vengono distribuiti lungo il documento e ripristinati alla fine, evitando le fasce ripetute. Sono esclusi dialoghi, contenitori interattivi e catture di pannelli interni.
- I suggerimenti di selezione, pausa con Spazio e ripresa sono in inglese sia in Area sia in Multi Snip. Non è un sistema di traduzione dell'interfaccia.

Verifiche: procedure reali Full Page e Area eseguite in un browser di prova sulla pagina pubblica AI Tarot, controllo del ripristino e casi mirati di transizioni/errore; risultato confermato anche dallo screenshot dell'utente. Controllo di sintassi e sei controlli dei testi/stati in Area e Multi Snip superati.
La diversa segnalazione della recensione sulle colonne laterali sticky più alte dello schermo **non è dichiarata risolta** da questa correzione.

File: `full-page-screenshot-extension/sw.js`.
Commit: `6cecd13`.
Manifest ancora **9.11**; ZIP e pubblicazione non aggiornati per questa correzione.

## 11/09/2026 — Cattura di colonne e correzioni Facebook/Yahoo

**Ideata il:** 11/09/2026, dai casi segnalati dall'utente.
**Realizzata il:** 11/09/2026.

- Selezione nei popup dei commenti, senza scorrere la pagina dietro.
- Gestione delle scrollbar personalizzate durante la cattura.
- Margine esterno del 15% nel riconoscimento della selezione di un pannello; numeri delle dimensioni mantenuti visibili.
- Selezione che parte sopra una colonna, come dal logo Yahoo.
- Cattura di colonne indipendenti e del caso misto pagina centrale + sidebar.
- Le prove su Yahoo e Facebook sono state confermate dall'utente nella chat; non è una garanzia universale su ogni sito.

File: `full-page-screenshot-extension/sw.js`, `full-page-screenshot-extension/settings.js`, `full-page-screenshot-extension/manifest.json`.
Commit: `70bc9fa`, `a66631b`, `d7a5c5e`, `93f26d9`.
Pacchetto aggiornato: `full-page-screenshot-extension/9.10.zip` (locale, non versionato in Git).

## 11/09/2026 — Pausa dello scorrimento con Spazio

**Ideata il:** 11/09/2026.
**Realizzata il:** 11/09/2026.

Tenere premuto Spazio prima o durante la selezione ferma lo scorrimento automatico e quello con rotella.
Rilasciarlo permette di riprendere; un messaggio indica la pausa.
La descrizione lunga resta fuori dallo ZIP e si aggiorna manualmente sullo Store.

File: `full-page-screenshot-extension/sw.js`, `full-page-screenshot-extension/settings.js`, `DESCRIZIONE-STORE.md`.
Commit: `d7a5c5e`.

## 09/09/2026 — Rifiniture dell'editor e delle catture

**Ideata il:** richieste di rifinitura documentate nella chat del 09/09/2026; editor di base già precedente.
**Realizzata il:** 09/09/2026.

Barra strumenti riordinata, scelta libera dei colori, anteprima isolata dall'editor;
correzioni per barre fisse, cattura Area nelle chat e Full Page con più pannelli.
Le precedenti rifiniture del 12/08 sono nel commit `9e5a3a1`.

File: `full-page-screenshot-extension/editor.html`, `full-page-screenshot-extension/editor.js`,
`full-page-screenshot-extension/sw.js` e impostazioni.
Commit: `a3b08be`, `e7d0fec`, `5407161`, `e49889b`.

## 07/08/2026 — #14–17: forme, numeretti, sfondi e lente di richiamo

**Ideata il:** 07/08/2026, dal collaudo dell'editor.
**Realizzata il:** 07/08/2026.

- #14: libreria di 37 forme, incluse frecce e fumetti — `7886355`.
- #15: contatori numerati con rinumerazione — `d13b1cf`.
- #16: sfondo, gradiente, margine, ombra, angoli, proporzioni e filigrana — `6934d16`.
- #17: ingrandimento di un dettaglio con lente di richiamo — `40cafd9`.

File: `full-page-screenshot-extension/editor.html`, `full-page-screenshot-extension/editor.js`.

## 06–07/08/2026 — #4: editor e formati di esportazione

**Ideata il:** già registrata il 17/07/2026; dettagliata nei collaudi del 06–07/08.
**Realizzata il:** 06–07/08/2026; rifiniture successive il 12/08 e 09/09.

Ritaglio, oscuramento coprente o sfocato, evidenziatore, linee e testo;
annotazioni ancorate al pezzo, undo/redo, spostamento e ridimensionamento.
Esportazione della composizione in PNG, JPG, PDF e WEBP, copia negli appunti e zoom dell'area di lavoro.
Non include OCR o salvataggio in blocco dei singoli pezzi.

File: `full-page-screenshot-extension/editor.html`, `full-page-screenshot-extension/editor.js`,
`full-page-screenshot-extension/sw.js`.
Commit: `a99acc9`, `e46661a`, `075b933`, `0f75f99`, `ae88c58`.

## 06/08/2026 — #11: lente nella selezione area

**Ideata il:** 05/08/2026.
**Realizzata il:** 06/08/2026.

Lente con griglia per selezionare con precisione; attivabile dalle impostazioni.
Non è la lente di richiamo #17, che invece è un'annotazione dell'editor.

File: `full-page-screenshot-extension/sw.js` e impostazioni.
Commit iniziale: `a4afa5e`.

## 06/08/2026 — #12A: importazione dagli appunti

**Ideata il:** 06/08/2026.
**Realizzata il:** 06/08/2026.

Ctrl+V nell'editor aggiunge un'immagine dagli appunti come nuovo pezzo.
La cattura diretta di finestre/schermo (#12B) resta un'idea futura.

File: `full-page-screenshot-extension/editor.js`, `full-page-screenshot-extension/sw.js`.
Commit: `122bca7`.

## 05/08/2026 — #1 e parte di #2: Multi Snip e raccolta fra schede

**Ideata il:** già registrata il 17/07/2026.
**Realizzata il:** 05/08/2026, con ampliamenti successivi.

Raccolta di catture sulla stessa pagina o su schede diverse, pannello sulla pagina,
composizione su tela libera, spostamento/ridimensionamento, guide, undo/redo, anteprima e stampa.
La sessione gestisce il limite di spazio, anche comprimendo o rifiutando il pezzo troppo grande.
Il documento con collegamenti alle fonti e le uscite residue della voce #1 restano in IDEE.md.

File: `full-page-screenshot-extension/sw.js`, `full-page-screenshot-extension/editor.html`,
`full-page-screenshot-extension/editor.js`, pannelli dell'estensione.
Commit iniziale: `6e04af4`; ampliamenti: `5259b70`, `4a1a2b4`, `41d5be2`, `c98df38`.

## 05/08/2026 — #8: descrizione dello Store

**Ideata il:** già registrata il 17/07/2026.
**Realizzata il:** 05/08/2026; aggiornata il 07/08 e 11/09.

Descrizione breve e testo lungo organizzato per funzioni.
Fonte corrente: DESCRIZIONE-STORE.md. La pubblicazione della descrizione lunga resta manuale.

File: `DESCRIZIONE-STORE.md`, `full-page-screenshot-extension/manifest.json`.
Commit: `468b4b1`, `c2e0249`, `a5d75a8`, `d7a5c5e`.

## 17/07/2026 — #5, #6 e #7: novità, recensioni e impostazioni

**Ideata il:** già registrata il 17/07/2026.
**Realizzata il:** 17/07/2026; impostazioni e guida ampliate ad agosto/settembre.

- #5: changelog nell'estensione e segnalazione delle novità dopo un aggiornamento.
- #6: invito con entrambi i collegamenti, recensione e feedback, sempre disponibili.
  Non adottare il vecchio filtro in base al numero di stelle.
- #7: pagina impostazioni riordinata e guida «How it works».

File: `full-page-screenshot-extension/sw.js`, `full-page-screenshot-extension/settings.html`,
`full-page-screenshot-extension/settings.js`.
Commit iniziale: `f66bd9b`; guida ampliata: `b16bba9`.

---

## Copia storica delle note precedenti

Il testo seguente è la copia integrale di IDEE.md prima del riordino dell'11/09/2026.
L'ultima modifica di quel file era del 07/08/2026 (`5fee6f9`); l'intestazione era rimasta a luglio.

**Non è una seconda roadmap.** Date di versione, attività «ancora aperte», statistiche,
affermazioni sui concorrenti, limiti tecnici e prezzi sono appunti storici,
non verifiche aggiornate. Sono conservati per non perdere ragionamenti e decisioni.

<details>
<summary>Apri il testo storico originale</summary>

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

### VALIDAZIONE MULTI-SNIP 05/08/2026 (ricerca 4 angoli, 31 candidati)
**Nessuna estensione Chrome ha il flusso completo**: selezioni multiple
illimitate → accumulo "+ aggiungi" (anche cross-pagina) → cucitura
automatica verticale in immagine unica / documento con fonti. I più vicini:
SelectorsHub "Dual Select" (solo 2 aree, stessa pagina, affiancate),
FireShot Pro (pagamento + app desktop, concatena solo tab intere), ShareX
(desktop, regioni da un singolo fermo-schermo). **La domanda esiste ed è
documentata**: thread Microsoft Q&A senza soluzione, richieste inevase sul
forum FireShot ("time-consuming" farlo a mano), un intero ecosistema di
app "stitcher" nato per unire screenshot a mano. Concorrente diretto Handy
Screenshot (30k utenti, 4,84★): editor+export forte, ma niente multi-snip
né scroll selection. → Il multi-snip non è una feature: è il posizionamento.

**RIVERIFICA 05/08/2026 sera (a Multi Snip costruito)** — ricontrollati i
due candidati più vicini emersi da ricerche fresche:
- SelectorsHub "Screenshot with URL": Dual Select = SOLO 2 aree, SOLO
  stessa pagina, fusione automatica affiancata a layout fisso; l'editor è
  di annotazione, non di composizione; nessun accumulo cross-tab, nessun
  mix di tipi di cattura. Split View = finestre aperte affiancate d'ufficio.
  VERIFICA SU STORE 06/08 (dopo dubbio dell'utente — un chatbot aveva detto
  "SelectorsHub non fa screenshot" ma parlava dell'estensione PRINCIPALE
  XPath, questa è un prodotto separato della stessa casa): esiste, ID
  ekobnhinclimmneheimhlokgmafjndog, 7.000 utenti, 4,9★ (35 recensioni),
  aggiornata 28/07/2026. Ha anche "2-Page Screenshot" (DUE tab affiancate
  d'ufficio, layout fisso — la cosa più vicina al multi-tab sul mercato,
  ma sempre automatica, 2 tab max, zero sessione/tela libera) e cattura
  console/network LOG testuali (non la UI dei DevTools).
- FramedShot: compositore a GRIGLIA DI SLOT FISSI (dichiarano loro stessi
  "not a free canvas"), lavora su immagini già esistenti via tray; niente
  raccolta progressiva durante la navigazione, niente cattura scroll.
- LongScreenshot: "merge with other captures" = concatenazione verticale di
  long-screenshot, non collage libero.
**Il nostro combo resta unico: multi-snip + MULTI-TAB** — sessione che
accumula catture di ogni tipo (area/visibile/full-page con scroll) da
schede diverse col pannellino che segue, undo/redo, e composizione su tela
LIBERA (trascina/sovrapponi/ridimensiona/calamita con guide) nell'editor
integrato. Nessun concorrente ha nemmeno metà del flusso.

**CASI D'USO DOCUMENTATI (ricerca 05/08 sera) → implicazioni di design:**
1. *QA / bug report* (expected vs actual; le guide QA impongono screenshot
   come allegato; SelectorsHub ha costruito Dual Select dichiaratamente
   "for comparisons and bug reports" ma max 2 aree stessa pagina).
   → Conferma fase 2: testo + evidenzia + oscura. Affiancato ✓ già coperto.
2. *Confronto prodotti/prezzi su più tab* ("manually driven, very
   time-consuming"; esiste un BREVETTO US20190317647 per aggregare
   contenuto multi-tab a fini comparativi). → Pannellino che segue ✓,
   allineamento con guide ✓. Etichette di testo (fase 2) per i prezzi.
3. *Documentazione/tutorial* (utente FireShot: calvario cattura→documento→
   incolla ripetuto). → Impilamento verticale ✓. MICRO-IDEA: strumento
   "numeretti 1-2-3" da timbrare sui pezzi (banale da fare, oro per i tutorial).
4. *Workflow alla ShareX* (issue #1052 CHIUSA: descrive alla lettera il
   nostro editor — raccolta con hotkey + finestra di composizione con
   snapping). → MICRO-IDEA: scorciatoia da tastiera "aggiungi pezzo"
   (chrome.commands, max 4 shortcut) per catturare senza click.
5. *Studio/ricerca/genealogia* (community che confrontano documenti da più
   schede). → Multi-tab ✓; la citazione della fonte resta l'idea #2 (cross-page
   clipper con link) — domanda confermata.
6. *Chat/ricevute/thread spezzati* ("4 immagini separate non sopravvivono a
   una chat di gruppo"). → Contatto 0px ✓, export unico ✓.
7. *Before/after di build e progetti* (FramedShot lo usa come esempio di
   marketing). → Affiancato ✓ + etichette testo (fase 2).

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

### 3. OCR (Tesseract.js, locale) — RICONFERMATA 06/08, candidata TITOLO della 9.10
Deciso col boss il 06/08: NON nella 9.9 (già carica col multi-snip) ma
pezzo forte della release successiva, insieme alla lente #11 — una novità
grossa per aggiornamento tiene vivo changelog/badge NEW e il flusso
recensioni. UX prevista: pezzo selezionato nell'editor → bottone "Copia
testo" → testo negli appunti. Zero menu, stile casa.
Estrarre testo dalle catture. Gira nel browser, gratis, ~100 lingue.
Serve dove il testo NON è selezionabile: immagini, PDF scansionati, pagine che bloccano il copia-incolla, canvas/Figma, codice dentro video.
**Locale, non cloud**: l'AI vision in cloud darebbe qualità superiore ma tradirebbe il posizionamento "privacy first, everything stays on your device" — e gli utenti sono USA su Windows/ChromeOS (scuole), dove la privacy è requisito, non vezzo.
Nota tecnica 17/07: il pacchetto cresce di ~15MB (WASM + dati lingua inglese inclusi, niente download esterni). Sui Chromebook scolastici sarà lento ma funzionante.

### 4. Editor avanzato — PRIMO GIRO FATTO 07/08, quattro pezzi grossi ancora aperti
Annotazioni, frecce, blur sopra lo screenshot. Era voce roadmap Pro, mai dettagliata. Il più grosso dei quattro (canvas, strumenti, undo).

**Collaudo 07/08 dell'editor Multi Snip — otto difetti trovati e CORRETTI** (commit e46661a):
la toppa non seguiva il pezzo (buco di privacy: spostando la foto il dato
riemergeva), oscuramento solo coprente, strumenti one-shot, stato armato
poco visibile, manina invece del mirino, niente annulla/ripeti, linea alta
3px impossibile da riprendere, Fit canvas senza ritorno.

**Restano aperti — quattro pezzi grossi, candidati alla 9.10 o alla 9.11**
(tutti nati dal collaudo del 07/08, l'utente li ha chiesti a voce uno dietro
l'altro guardando l'editor):

- **14. Libreria di forme (~30 oggetti).** Quadrato, rettangolo, cerchio,
  triangolo, stella, mezzaluna, frecce di ogni verso, **fumetti/callout**.
  Impianto: un tipo di nota `forma` con un nome, disegnata come path — a
  schermo in SVG, nell'export con `Path2D` sullo stesso canvas. Le ~30 forme
  sono in gran parte una tabella di path, il costo vero è l'interfaccia di
  scelta (pannellino a griglia) e il riuso dei gesti già esistenti
  (sposta/ridimensiona/colore/ancoraggio al pezzo).
- **15. Contatori numerati.** Click su un punto → pallino "1", click
  successivo → "2", e via progredendo da solo. È lo strumento delle guide
  passo-passo, e nessuno dei concorrenti diretti censiti ce l'ha.
  Attenzione: serve una rinumerazione automatica quando se ne cancella uno
  in mezzo.
- **16. Studio dello sfondo / cornice** (modello dichiarato dall'utente:
  Handy Screenshot). Sfondo a tinta unita o **sfumatura** da una tavolozza
  di preset, dimensione del margine, **ombra** portata, **angoli
  arrotondati** (esterni e interni), proporzioni forzate (1:1, 16:9,
  Original) e **filigrana** opzionale. È la funzione che trasforma uno
  screenshot in un'immagine da social/presentazione: alto impatto visivo,
  costo medio (è tutto disegno sul canvas dell'export + un pannello di
  controlli).
- **17. Lente di richiamo (zoom callout).** Selezioni una regione piccola e
  l'editor ne piazza una copia INGRANDITA a fianco, collegata all'originale
  da due linee di richiamo (l'effetto "dettaglio" delle recensioni e dei
  tutorial). Impianto: una nota che tiene il rettangolo sorgente nello
  spazio naturale del pezzo (l'ancoraggio del 07/08 serve già a questo) più
  un fattore di ingrandimento; l'export ridisegna quella regione con
  `drawImage` a 9 argomenti.

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

### 10. Modalità "High quality 2×" (aggiunta 05/08/2026, parcheggiata)
Catture a risoluzione doppia, così lo zoom sgrana al 200% invece che al
100%. Punto chiave: la pipeline attuale è GIÀ lossless (PNG a risoluzione
schermo, composizione 1:1) — lo sgranamento è il limite fisico dei pixel
renderizzati, non una perdita nostra. Per avere più pixel serve
renderizzare la pagina in grande. Due strade, entrambe con un prezzo:
- **A. `chrome.tabs.setZoom(2)`** prima della cattura, ripristino dopo:
  zero permessi nuovi, MA il viewport CSS si dimezza e i siti responsive
  cambiano layout (rischi di catturare la versione tablet).
- **B. `chrome.debugger` + `Emulation.setDeviceMetricsOverride`**
  (deviceScaleFactor 2, la strada di DevTools): layout identico, vera 2×,
  MA permesso `debugger` = barra gialla "ha avviato il debug" a ogni
  cattura + revisione store dura + contraddice il posizionamento
  "permessi minimi" della descrizione nuova.
Vincoli comuni: limiti canvas Chrome (~16.384px di lato, ~268Mpx di
area) — sulle pagine lunghe il 2× va cappato o rifiutato con messaggio.
Candidata naturale come **feature Pro** quando si riapre la
monetizzazione (Handy vende rifiniture simili nel suo PRO one-time).

### 11. Lente di ingrandimento nella selezione area (idea 05/08 notte)
Loupe stile PicPick/ShareX/Greenshot (o selezione testo iOS): riquadro
vicino al mirino che mostra la zona attorno al cursore ingrandita 4-8×
con griglia pixel e coordinate → bordi della selezione piazzati al pixel.
Allineata alla stella polare "precisione della cattura". Tecnica: NIENTE
ricattura live (captureVisibleTab è cappato a ~2 chiamate/sec) — una
cattura all'apertura dell'overlay (pagina statica, animazioni già in
pausa), la lente è un canvas che panna dentro la bitmap cachata;
ricattura debounced solo a scroll fermo (turbo autoscroll compreso).

### 12. Cattura DevTools / import universale (idea 06/08)
Catturare il pannello F12 direttamente è IMPOSSIBILE (devtools:// è
superficie protetta, captureVisibleTab lo esclude anche se docked).
Due strade:
- **A. Incolla-da-appunti nell'editor (candidata subito, fase 2)**:
  listener `paste` sulla pagina editor — Ctrl+V aggiunge come pezzo
  QUALSIASI immagine negli appunti (Win+Shift+S dei DevTools, altre app,
  immagini copiate dal web). Zero permessi nuovi, tre righe di codice,
  apre l'import universale nel collage.
- **B. desktopCapture (parcheggiata post-9.9)**: permesso dedicato (può
  essere opzionale) + picker di Chrome → cattura finestra/schermo interi,
  DevTools compresi, da frame di uno stream video. Avviso permesso
  "cattura contenuti dello schermo" + dialog a ogni uso + review più dura.

### 13. Modalità Raffica / burst area (idea 06/08, promossa a parole — candidata 9.10)
Un click sull'icona, poi ritagli-e-salva a ripetizione: ogni selezione
area viene salvata SUBITO come file a sé e l'overlay si ri-arma, senza
chiedere nulla. Gemella del giro Multi Snip ("+ Area" ripetuto) ma con
mestiere opposto: Multi Snip = raccogli e componi, Raffica = spara e
salva. Riusa la meccanica esistente → costo basso. Rischio UX unico:
l'USCITA deve essere evidentissima (badge "Raffica: N salvati · Esc per
uscire", Esc chiude sempre). Casi d'uso: QA che documenta molti punti,
docenti che ritagliano esercizi, ricerca. Da valutare con OCR e
scorciatoia da tastiera nella "release della produttività" (9.10).

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

</details>
