# IDEE.md — Full Page Screenshot

Unico elenco delle idee future del progetto.
Progetto: `C:\Progetti\full-page-screenshot`
Sorgenti: `full-page-screenshot-extension/`
Ultimo aggiornamento: **21 settembre 2026**.
Riordino delle idee dell'11/09; stato del codice e delle prove aggiornato fino al commit `03915d8`.

## Quale documento usare

- **Questo file:** funzioni ancora da realizzare e decisioni ancora aperte.
- [IDEE_FATTE.md](IDEE_FATTE.md): funzioni realizzate, date, file, commit e copia delle vecchie note.
- [DESCRIZIONE-STORE.md](DESCRIZIONE-STORE.md): testi della scheda Chrome Web Store, non una lista di nuove funzioni.
- [HANDOFF_SCREENSHOT.md](HANDOFF_SCREENSHOT.md): fotografia della situazione al 14 agosto; non descrive la versione corrente.

Ricerca dell'11/09/2026, comprese le cartelle nascoste e i file ignorati del progetto:
prima di questo riordino esisteva soltanto `IDEE.md`, senza altri file dedicati IDEE, TODO o roadmap.
L'ultima modifica registrata era del **07/08/2026** (`5fee6f9`), benché l'intestazione dicesse ancora luglio.
L'archivio IDEE_FATTE è creato con questo riordino, non è una seconda lista da seguire.

## Situazione della versione

- Manifest e ultimo pacchetto locale: **9.11**.
- La 9.10 risultava pubblicata nello screenshot dello Store fornito dall'utente; la 9.11 è stata successivamente inviata in revisione secondo la chat. L'esito attuale non è stato verificato qui.
- La 9.10 comprende i fix confermati dall'utente su Facebook e Yahoo, la selezione di più colonne e la pausa con Spazio.
- La 9.11 include il permesso per la copia negli appunti dopo catture lunghe e la quinta immagine Store aggiornata (`f7f0737`).
- Il pacchetto `full-page-screenshot-extension/9.11.zip` resta la copia preparata per lo Store; sono conservate anche le copie 9.8, 9.9 e 9.10.
- Il codice del 20/09 include la correzione AI Tarot e i suggerimenti Area in inglese (`6cecd13`), registrati in [IDEE_FATTE.md](IDEE_FATTE.md). Queste modifiche non sono ancora nello ZIP e non sono state pubblicate.
- Sono inoltre salvati il fix AiScore (`984c1fc`) e lo Stop con pannellino bianco approvato dall'utente, anche in Multi Snip (`2db11ed`). Dettagli e limiti in [IDEE_FATTE.md](IDEE_FATTE.md). Manifest, ZIP e Store non aggiornati.
- L'errore di salvataggio Area con zoom è corretto e confermato dall'utente su **DeepSeek al 110%**, con immagine salvata senza errori. Correzione e prove salvate in `03915d8` e archiviate in [IDEE_FATTE.md](IDEE_FATTE.md); nessun rilascio. La conferma non chiude le pubblicità Yahoo o le altre attività.
- Il fix delle colonne laterali è **corretto e confermato dall'utente il 21/09**: chiude il problema segnalato nella recensione dello Store. Le prove automatiche su Tailwind, DeepSeek e MDN erano passate in Full Page e Area, anche in Multi Snip. Codice in `02bd727`, voce archiviata in [IDEE_FATTE.md](IDEE_FATTE.md); risultati e limiti in `tools/README.md`. Restano aperte le pubblicità Yahoo; il riquadro laterale di Yahoo Finance è invece un **limite accettato**, non più in lavorazione (vedi «LIMITI NOTI ARCHIVIATI» in [IDEE_FATTE.md](IDEE_FATTE.md)). Manifest, ZIP e Store non aggiornati.
- Il fondo tagliato sulle pagine che caricano in ritardo è **corretto e confermato dall'utente il 21/09**, con una cattura Yahoo che include la sezione finale. Codice e prove in `03915d8`, dettagli archiviati in [IDEE_FATTE.md](IDEE_FATTE.md). Vale per Full Page anche in Multi Snip; Area mantiene i confini selezionati e le colonne indipendenti restano invariate. Manifest, ZIP e Store non aggiornati.
- Le pubblicità Yahoo **restano aperte**: la preparazione iniziale inclusa in `03915d8` è parziale. Una visita senza pre-scorrimento ha mostrato un contenitore che torna sticky e frammenti di annunci, anche se il fondo viene incluso. Il riquadro laterale di Yahoo Finance non rientra più fra le attività: il 22/09 il supervisore ha deciso di non investirci risorse, e il caso è descritto per intero fra i «LIMITI NOTI ARCHIVIATI» in [IDEE_FATTE.md](IDEE_FATTE.md), con la causa individuata e l'avvertenza di non danneggiare ciò che già funziona. Risultati distinti e limiti in `tools/README.md`; nessuna chiusura complessiva di Yahoo.
- Per le pagine troppo lunghe è ora impedito il download di un'immagine vuota; la suddivisione in più immagini raccolte in ZIP, già richiesta nella chat, non è ancora implementata.
- Le vecchie diciture «candidata 9.10» erano proposte, non conferme di inclusione. Nessuna delle idee qui sotto è automaticamente assegnata alla 9.10.

## Idee ancora aperte

### Full Page fino a qui — linea di fine cattura

**Ideata il:** 20/09/2026.
**Stato:** idea futura; salvataggio approvato dall'utente, non implementata.

Catturare tutta la larghezza della pagina, dall'inizio fino a un punto finale scelto dall'utente.
Utile quando interessa soltanto una parte di una pagina molto lunga, senza disegnare un rettangolo come in Seleziona area.

Comportamento proposto:

- Opzione attivabile e disattivabile dal menu, normalmente spenta.
- L'utente scorre la pagina e clicca il punto dove vuole terminare la cattura: compare una linea orizzontale.
- La linea può essere spostata o cancellata prima di avviare la cattura.
- Premendo Full Page, la cattura parte dall'inizio e termina alla linea, senza includere la linea nell'immagine salvata.

Da gestire con attenzione: il punto finale deve restare legato al contenuto scelto anche quando la pagina carica nuovi elementi durante lo scorrimento.
Resta da definire il comportamento sulle pagine con più colonne a scorrimento indipendente.
È distinta dal comando Stop: sceglie in anticipo dove finire, non annulla una cattura già avviata.
Nessuna implementazione o assegnazione a una versione è autorizzata dal solo salvataggio dell'idea.

### Scorciatoia da tastiera per catturare / aggiungere un pezzo

**Ideata il:** 05/08/2026, già presente fra i casi d'uso della vecchia lista.
**Stato:** non implementata; proposta nuovamente l'11/09, non ancora autorizzata.

Avviare una cattura senza cliccare sull'icona.
Proposta attuale: aprire Seleziona area e, se Multi Snip è attivo, aggiungere il pezzo alla raccolta.
Da concordare la combinazione di tasti e il comportamento esatto.
È la candidata più piccola secondo la valutazione sul codice attuale: riusa i percorsi di cattura esistenti.
Non confonderla con Spazio, che serve già a sospendere lo scorrimento durante la selezione.

### #13 — Modalità Raffica

**Ideata il:** 06/08/2026.
**Stato:** non implementata.

Selezionare e salvare più aree consecutive: ogni ritaglio diventa subito un file e la selezione si riapre.
Diversa da Multi Snip, che raccoglie i pezzi e apre l'editor.
L'uscita deve essere evidente, con conteggio dei file salvati ed Esc per interrompere.
Riusa parti esistenti, ma richiede di gestire bene annullamento, errori e fine della sequenza.

### #3 — Copiare il testo dalle immagini (OCR locale)

**Ideata il:** già registrata il 17/07/2026; riconfermata il 06/08/2026.
**Stato:** non implementata.

Nell'editor: selezionare un pezzo e usare «Copia testo» per estrarre le parole dall'immagine.
La scelta concordata è l'elaborazione sul dispositivo, senza inviare le immagini a servizi esterni.
Tesseract.js era la soluzione proposta: prima di implementarla vanno verificati lingue, peso del pacchetto, tempi e qualità.
I vecchi numeri su dimensioni e prestazioni restano nell'archivio come stime storiche, non come dati verificati oggi.
L'esportazione di più ritagli come testo unico, prevista nell'idea #1, dipende da questo lavoro.

### #2 — Documento con le fonti dei ritagli

**Ideata il:** già registrata il 17/07/2026.
**Stato:** parzialmente realizzata.

La raccolta di immagini da schede diverse esiste già: non va ricostruita.
Resta da associare a ogni pezzo la pagina di provenienza e riportarne il collegamento nel documento esportato.
Nel codice attuale i pezzi salvano immagine, tipo e identificativo, non un URL della fonte per ciascuna immagine.
Da definire come mostrare le fonti e come trattare gli indirizzi che contengono informazioni personali.
Il limite della raccolta è già gestito con compressione/rifiuto del pezzo: non è deciso alcun nuovo permesso.

### #1 — Esportare i pezzi di Multi Snip come file separati

**Ideata il:** già prevista nella voce #1 al 17/07/2026.
**Stato:** parte residua dell'idea originale.

Raccolta e composizione di più pezzi sono già realizzate.
Il salvataggio corrente dell'editor esporta la composizione unica; non è stato trovato un comando per salvare in blocco ogni pezzo separatamente.
Questa possibilità resta da realizzare/concordare, senza confonderla con la modalità Raffica.
L'uscita come testo unico resta collegata all'OCR.

### #9 — Tradurre l'interfaccia

**Ideata il:** già registrata il 17/07/2026.
**Stato:** non implementata come sistema di lingue.

L'interfaccia usa prevalentemente l'inglese, con alcuni messaggi in italiano.
Dal 20/09 i suggerimenti di selezione e pausa con Spazio sono uniformati in inglese; questo non realizza il sistema multilingue.
Restano da scegliere le lingue e organizzare la traduzione dei testi.
La priorità bassa deriva dalla discussione storica: i dati di pubblico di luglio/agosto non sono statistiche aggiornate a oggi.

### #10 — Catture a risoluzione doppia

**Ideata il:** 05/08/2026.
**Stato:** parcheggiata, non implementata.

Ottenere più dettagli reali, non ingrandire semplicemente i pixel già catturati.
Le due strade discusse erano cambiare lo zoom della pagina oppure usare gli strumenti di debug del browser.
Restano da valutare cambiamenti di impaginazione, permessi, consumo di memoria e limiti sulle immagini lunghe.
Nessuna decisione su una versione a pagamento. Le vecchie stime tecniche sono conservate nell'archivio e andranno riverificate.

### #12B — Catturare finestre o schermo intero

**Ideata il:** 06/08/2026.
**Stato:** parcheggiata, non implementata.

Catturare anche superfici esterne alla pagina, compresi gli strumenti sviluppatore.
L'idea prevedeva la scelta esplicita della finestra/schermo e un permesso dedicato, da valutare prima di procedere.
La parte #12A, incollare immagini nell'editor con Ctrl+V, è invece già realizzata.

## Decisione commerciale ancora aperta

Monetizzazione discussa, **non decisa**.
Nessuna funzione gratuita viene spostata a pagamento con questo aggiornamento.
Prezzi, formule e tutele degli utenti già presenti erano ipotesi: sono conservati nelle note storiche, non sono un piano approvato.

## Rimandi alle idee realizzate

Dettagli, date e commit sono in [IDEE_FATTE.md](IDEE_FATTE.md):

- #1: Multi Snip e composizione sulla stessa pagina; restano soltanto le uscite indicate sopra.
- #2: raccolta fra schede diverse; resta il documento con fonti.
- #4: editor, annotazioni, oscuramento, ritaglio, cronologia ed esportazione.
- #5, #6, #7: novità nell'estensione, invito a recensire e impostazioni.
- #8: descrizione Store riscritta; resta da incollare il testo aggiornato nella scheda quando si pubblica.
- #11: lente di precisione durante la selezione.
- #12A: importazione delle immagini dagli appunti.
- #14, #15, #16, #17: forme, numeretti, sfondi/cornici e lente di richiamo.

## Note da non scambiare per nuove attività

I vecchi limiti su PDF, YouTube e pagine protette sono conservati nell'archivio.
Non sono stati riprovati in questo riordino e non sono automaticamente dichiarati risolti da Multi Snip.
Le ricerche sui concorrenti e i dati Store sono datati: non dimostrano l'unicità o la situazione commerciale attuale.
