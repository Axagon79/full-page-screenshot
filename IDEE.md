# IDEE.md — Full Page Screenshot

Unico elenco delle idee future del progetto.
Progetto: `C:\Progetti\full-page-screenshot`
Sorgenti: `full-page-screenshot-extension/`
Ultimo aggiornamento: **11 settembre 2026**.
Stato confrontato con sorgenti e cronologia fino al commit `93f26d9`.

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

- Manifest e pacchetto locale: **9.10**.
- La 9.9 è stata inviata alla pubblicazione secondo quanto riferito dall'utente; l'esito Store non è stato verificato qui.
- La 9.10 comprende i fix confermati dall'utente su Facebook e Yahoo, la selezione di più colonne e la pausa con Spazio.
- Il pacchetto `full-page-screenshot-extension/9.10.zip` è stato aggiornato dopo `93f26d9`. Le copie 9.8 e 9.9 sono conservate.
- Questo riordino modifica soltanto la documentazione: nessuna nuova funzione, nessun aggiornamento dello ZIP e nessun invio allo Store.
- Le vecchie diciture «candidata 9.10» erano proposte, non conferme di inclusione. Nessuna delle idee qui sotto è automaticamente assegnata alla 9.10.

## Idee ancora aperte

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
