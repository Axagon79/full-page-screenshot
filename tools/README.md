# Prove locali delle catture

Eseguire i controlli soltanto dopo l'approvazione dell'utente, come indicato nelle regole del progetto.

## Controlli della versione del 20/09/2026

- `test-capture-stop.cjs` e `test-popup-stop.cjs`: controlli automatici con le funzioni dell'estensione e le chiamate Chrome simulate. L'ultima esecuzione approvata è passata; i vecchi casi del pulsante Stop dentro il pannellino sono esplicitamente saltati perché quel pulsante è stato rifiutato.
- `check-progress-layout.cjs`: usa Edge e la pagina di prova locale per controllare il pannellino bianco corrente. L'ultima esecuzione approvata è passata a larghezze 1280 e 390, con sfondo chiaro e scuro. Controlla posizione, aggiornamento, rimozione e assenza del pannellino nello scatto. Le immagini generate restano in `tools/artifacts/`, esclusa da Git.
- `test-capture-motion.cjs`: controlli della correzione AiScore già salvata nel commit `984c1fc`.

I controlli con chiamate Chrome simulate non equivalgono a una prova del clic sulla barra strumenti di un'estensione installata. Gli script usano Node.js; quelli con browser richiedono anche il browser locale indicato nel codice.

## Strumenti esplorativi conservati

- `test-stop-browser.cjs`: precedenti prove nel browser; contiene anche aspettative della vecchia interfaccia, non è il controllo aggiornato del pannellino bianco.
- `test-native-popup.cjs` e `fixtures/popup-behavior/`: esperimento isolato sul popup nativo, non usato dall'estensione. La prova non è riuscita ad accedere a `chrome.action` nel browser di prova; non va considerata una verifica superata.

## Colonne laterali: correzione e prove approvate del 20/09/2026

La modifica locale apre temporaneamente i soli menu sticky scrollabili dei documenti, prima delle misure Full Page e della selezione Area. Ripristina stili e scorrimento interno alla fine o dopo Stop/errore. Area usa posizioni esatte per questi documenti, evitando piccoli tagli dovuti al confronto delle righe bianche. Le colonne indipendenti, le pagine con feed, i dialoghi e Visible non vengono convertiti.

Gli script nuovi usano il codice reale del controller, della selezione e della composizione dentro Edge headless, con le API Chrome adattate tramite CDP. Generano PNG reali senza download nel profilo dell'utente. Non sono una prova dell'estensione installata né del clic fisico sull'icona Stop. Il pannellino deve essere nascosto in ogni fotogramma; non viene cambiata la sua interfaccia.

- `test-area-sidebar.cjs`: Full Page (`--full`), Area (predefinita), Visible (`--visible`); normali e Multi Snip (`--multi`, anche `--editor`); Stop al secondo scatto (`--stop`) e errore simulato (`--failure`). I vecchi pezzi Multi devono rimanere intatti. `--tailwind`, `--live` (DeepSeek), `--site=mdn`, `--site=wiki`, `--site=yahoo` scelgono le pagine pubbliche. `--baseline` legge i sorgenti del commit precedente ai fix `06d75a4`, senza modificarli. Il riferimento è stato fissato durante il salvataggio su Git per conservare lo stesso confronto anche dopo i nuovi commit; nessun nuovo test eseguito in quel passaggio.
- `test-sidebar-guards.cjs`: **33 verifiche superate** su DOM reale: menu direttamente scrollabile o contenuto in un wrapper, valori CSS prioritari, scorrimento precedente, ripetizione della preparazione, esclusione di elementi fixed/feed/dialoghi/colonne indipendenti/layout inadatti e Visible. Controlla il ripristino dei valori e delle priorità; un attributo style vuoto equivale all'assenza dello stesso.
- `inspect-area-sidebar.cjs URL`: ispezione separata di geometrie e stili, con immagine del viewport. `compare-sidebar-images.cjs`: confronto pixel della prima giuntura MDN, Full/Area; **zero differenze**. Le copie sovrapposte sotto l'header mobile non sono l'oracolo: il confronto usa i frammenti effettivamente conservati nella composizione.

### Risultati delle catture iniziali (aggiornamenti più sotto)

| Pagina | Full Page | Area | Altri controlli |
| --- | --- | --- | --- |
| Tailwind, installation/using-vite | Menu completo, 198 voci; anche Multi | Menu completo anche Multi editor; nessun pixel perso nei frammenti controllati | Full desktop scuro e larghezza 390; layout ripristinato |
| DeepSeek, guides/thinking_mode | Menu completo e ripristino verificati | Menu completo, indice destro non ripetuto, footer in fondo; Multi widget ed editor | Confronto pixel e ripristino |
| MDN, CSS/Reference/Properties/position | Menu completo, normale e Multi widget | Menu completo, normale e Multi editor | Visible Multi, Stop Area Multi; 150 link realmente visibili verificati pixel per pixel |
| Wikipedia, Pagina_principale | PNG completo, normale e Multi editor | PNG completo, normale e Multi widget | Visible Multi e Stop Full; questa homepage non presenta il lungo menu scrollabile del caso Tailwind |
| Yahoo Finance, homepage | PNG completo, normale e Multi widget | PNG prodotto, normale e Multi editor, **ma anomalia visiva ancora presente** | Visible e Stop Full Multi; vedi limite sotto |

Le immagini sono state anche aperte e guardate. Il controllo locale delle colonne indipendenti produce un PNG identico a quello precedente (SHA256 `46A75C1F8722AF5FDD3CD5AF36B9358BC46EF85744833635656522CA8D7775CF`); non sostituisce una prova sull'account Facebook dell'utente.

La suite precedente Stop/popup/movimenti ha **88 test passati, zero falliti, 21 vecchi casi esplicitamente saltati**. Stop e l'errore simulato non producono immagini incomplete e preservano i pezzi Multi già esistenti.

### Limiti delle prove iniziali (aggiornamenti più sotto)

- Yahoo **Area** ricolloca vicino al fondo una parte del riquadro destro e presenta frammenti di pubblicità laterali. È osservato sia con la modifica locale sia con `--baseline` sul commit `06d75a4`: non è introdotto dalla preparazione dei menu, che su Yahoo non si attiva. Non è stato corretto né dichiarato superato. Il successo tecnico del salvataggio PNG non equivale a correttezza visiva.
- Yahoo è stato aperto in un profilo temporaneo; quando richiesto, sono stati rifiutati i cookie facoltativi. Notizie, annunci e video possono cambiare durante le prove: non si confrontano come immagini identiche fra visite. Per questo l'altezza totale di Yahoo viene registrata, non usata come prova di ripristino degli stili.
- Alcune prime esecuzioni su MDN/DeepSeek hanno rilevato contenuti caricati in ritardo che cambiavano l'altezza di partenza; dopo il caricamento completo i controlli sono passati. Anche i controlli di visibilità del pannellino e dei frammenti sovrapposti sono stati allineati al comportamento effettivo prima dell'esecuzione finale.
- Nessun rilascio, aggiornamento della versione o modifica al pacchetto Store. Il caso originale della recensione resta in attesa della conferma dell'utente; nessuna idea è stata archiviata come conclusa.

PNG e rapporti JSON restano in `tools/artifacts/`, esclusa da Git.

## Seguito: Yahoo e segnalazione intermittente su MDN CSS

**Aggiornamento finale MDN del 20/09/2026:** segnalazione chiusa su conferma esplicita dell'utente dopo il ricaricamento dell'estensione. Il percorso caricato da Chrome coincideva con il progetto, ma il confronto delle sei funzioni di cattura in memoria dava un'impronta diversa da quella locale (`cd4ffc925bfade1c685726528842ae66abd7be34467c17db7619af953c648dfa`). Dopo il ricaricamento l'utente ha riferito che l'errore era sparito. Nessuna nuova correzione dedicata o causa specifica del bordo destro è dimostrata. L'URL precisata alla fine era `/en-US/docs/Web`, mentre i controlli automatici sotto erano su `/en-US/docs/Web/CSS`: `/Web` non è stata collaudata automaticamente. Le note sotto conservano la cronologia, inclusi i limiti delle riproduzioni. La chiusura non comprende Yahoo o il bug della recensione; riepilogo in `IDEE_FATTE.md`.

- Dopo l'autorizzazione alla correzione Yahoo è stata preparata una modifica circoscritta ad Area con scorrimento del documento: un duplicato effettivamente riconosciuto mentre era visibile resta escluso anche quando la sua colonna smette di essere sticky. Le barre inferiori vere e i contenitori a scorrimento indipendente mantengono le regole precedenti. Dopo il successivo OK sono state eseguite Area normale, Multi widget e Multi editor: 13 scatti e PNG 1918×11433 in ciascun percorso. Il riquadro destro non ricompare in fondo; verificati immagini e registrazioni per fotogramma, compreso il mantenimento della visibilità nascosta dei duplicati. **Restano tagli nei riquadri pubblicitari: non dichiarare Yahoo completamente corretto.**
- `test-area-sidebar.cjs --release` controlla una colonna corta con contenitore limitato e una vera barra inferiore. Sono passati il controllo normale, quello Multi editor, Stop Multi widget ed errore simulato Multi editor. Colonna presente per intero una volta (340 righe), barra inferiore una volta in fondo (70 righe), ripristino della visibilità e nessun pezzo incompleto. Anche il codice precedente passa questo caso: è una verifica contro regressioni, **non una riproduzione del difetto Yahoo**. Le geometrie locali provate non fanno ricomparire la colonna in un fotogramma utile.
- Ripetuti dopo la modifica: 33 controlli di esclusione/ripristino dei menu e la suite Stop/popup/movimenti (88 passati, 0 falliti, 21 casi vecchi saltati). La cattura Area Multi editor delle colonne indipendenti conserva lo stesso SHA256 riportato sopra. Full Yahoo salva il PNG e ripristina gli stili, ma questa visita è cresciuta da 11012 a 11435 pixel durante la cattura: la correttezza completa su contenuto dinamico non è dimostrata e sono visibili anche frammenti pubblicitari. Le prove non usano un'estensione installata né il profilo dell'utente.
- L'utente ha segnalato il messaggio `Image too large to save` su `https://developer.mozilla.org/en-US/docs/Web/CSS`, soltanto in Area; al tentativo successivo non si è ripresentato. Con approvazione esplicita sono passati Area normale, Area Multi editor e Full Page su questa URL, con 5 scatti per cattura e immagini rispettivamente 1918×4188 e 1920×4190. **Errore non riprodotto, causa non dimostrata, nessuna correzione specifica dichiarata.**
- La nuova opzione `--site=css` distingue questa pagina breve dalla pagina sulla proprietà position (`--site=mdn`). I rapporti registrano le dimensioni passate alla composizione Area. Il messaggio attuale è generico per qualsiasi risultato non valido: da solo non prova il superamento dei limiti di dimensione.
- L'utente ha poi precisato che l'errore MDN avviene rilasciando il mouse sopra la barra destra, non sotto il fondo. Le prove `--overshoot=20` (bordo inferiore), `--right-edge` e `--right-edge --from-content --multi --editor` non producono l'errore. Queste ultime inviano eventi DOM all'overlay, non alla barra nativa.
- La prova aggiuntiva `--site=css --native-edge` usa eventi del mouse attraverso il browser, con rilascio a x=1919: PNG 1869×4029, 5 scatti, ripristino verificato. **Limite importante:** il codice corrente nasconde le scrollbar prima della selezione; nella prova `scrollbar-width` è `none` e il rilascio arriva all'overlay. Non dimostra il comportamento del rilascio sopra una barra effettivamente visibile nel browser dell'utente. Per MDN nessuna causa o correzione specifica è stata dimostrata; serve osservare il rettangolo e il bordo destro prima del rilascio nel caso segnalato.
- Su ulteriore indicazione dell'utente è stata provata anche la discesa continua, senza saltare al fondo con un singolo evento della rotella: `--site=css --drag-edge`. Mouse mantenuto a x=1919, y=899, auto-scroll reale dell'estensione fino a scrollY=3290, poi rilascio. La pagina resta alta 4190; la selezione arriva a 1869×4029; salvataggio PNG e ripristino superati (5 scatti). `selection-drag-edge.png` documenta il rettangolo prima del rilascio. Il messaggio originale resta non riprodotto e nessun codice di produzione è stato cambiato per questa segnalazione.
- Il tentativo `--site=css --drag-edge --outside-right --multi --editor` sposta il puntatore a x=1940, oltre il viewport 1920 del browser automatico. Non completa la selezione: i movimenti fuori viewport non avanzano il rettangolo (rimane 4×4) e lo scroll resta a zero. Il controllo fallisce per mancata selezione, **non** con `Image too large to save`; non è una verifica riuscita di Multi né una riproduzione del bug. Non estrapolare questo limite dell'automazione al browser dell'utente.
