# Prove locali delle catture

Eseguire i controlli soltanto dopo l'approvazione dell'utente, come indicato nelle regole del progetto.

## Fondo caricato in ritardo: prove autorizzate del 21/09/2026

Il 20/09 l'utente aveva chiesto **«Per ora modifica soltanto il codice»** e non erano stati eseguiti controlli. Il 21/09, alla proposta esplicita di provare Yahoo, pagine veloci/lente, Stop, Multi Snip e regressioni Area, ha risposto **«ok»**. Le prove sotto sono state eseguite dopo questa autorizzazione, in browser isolati con codice reale e API Chrome adattate, non sull'estensione installata nel profilo dell'utente.

- `readCaptureDocument` in `capture-control.js` legge l'altezza e la posizione. Le fette intermedie non aggiungono attese; al fondo richiede 450 ms senza variazioni, oppure 1200 ms dopo crescita o segnali di caricamento. Il campionamento è ogni 100 ms, quindi il tempo effettivo include l'arrotondamento del timer e il costo delle chiamate. Non intercetta fetch/XHR e non aspetta il silenzio di tutta la rete: considera il documento ancora in parsing, indicatori visibili di caricamento e immagini visibili ancora incomplete, escludendo i marcatori pubblicitari noti e la UI dell'estensione.
- `doFullCapture` rilegge le misure prima/dopo gli scatti e segue il fondo aggiornato invece del numero iniziale di immagini. Se la geometria cambia durante lo scatto, lo scarta e riprende la stessa zona. Se la pagina cresce, invalida e riprende anche le foto che intersecavano l'ultimo viewport precedente: al 125% la prima prova aveva trovato **231 righe del vecchio footer** già entrate nella foto precedente; dopo questa correzione il controllo di tutte le righe passa. Il solo compositore Full Page del documento usa posizioni reali e sovrapposizione di un pixel fisico, con controllo di copertura e arrotondamenti dello zoom. La tolleranza del fondo non deve saltare un ultimo pixel ancora raggiungibile: una pagina alta esattamente due viewport viene verificata fino all'ultima riga.
- Limiti iniziali nel codice: 6 secondi per attesa al fondo, 20 secondi di attese complessive, massimo 20 schermate di altezza aggiunta e 24 tentativi oltre il numero iniziale stimato. Il limite temporale della coda è 60 secondi e parte solo raggiungendo il vecchio fondo: non penalizza una pagina già lunga per una piccola variazione iniziale. Al superamento viene segnalato un errore senza salvare un falso Full Page o un nuovo pezzo incompleto. Nessuna modifica a Stop, UI o salvataggio; restano i percorsi comuni di annullamento/ripristino.
- Vale per Full Page normale e Full Page avviato da Multi Snip tramite lo stesso motore, non copie separate. Area mantiene i confini scelti dall'utente; Visible, scroller interni e pannelli indipendenti non ricevono la nuova attesa/estensione. Non è un'estensione automatica della selezione Area.

Verifiche effettivamente eseguite con `test-area-sidebar.cjs`:

| Caso | Risultato |
| --- | --- |
| `--full --growth=static` | Documento 2200 px, tutte le righe presenti; sola attesa finale circa 504 ms. Nessuna attesa aggiuntiva nelle foto intermedie |
| `--full --growth=exact` | Documento 1800 px con viewport 900: inclusa anche l'ultima riga; due controlli finali da circa 505 ms in questo caso limite |
| `--full --growth=fast`, anche Multi editor/widget e zoom 110% | Tre aggiunte da 400/1200/800 px: da 2200 a 4600, ogni riga e footer una sola volta. PNG 4600 px al 100%, 5060 al 110% |
| `--full --growth=slow`, Multi editor al 100% e normale al 125% | Tre carichi ritardati di 2 s con `aria-busy`: attese effettive circa 1,6 s dopo lo scroll, più quiete finale di 1,2 s. Dopo il recupero della coda, zero righe sbagliate, PNG 5750 px al 125% |
| `--full --growth=slow --multi --stop-wait` | Stop durante l'attesa: interruzione/ripristino misurati in 13–282 ms nelle esecuzioni, nessun file/pezzo nuovo; pezzo precedente conservato |
| `--full --growth=stalled --multi --editor` | Caricamento che non finisce: errore dopo circa 6 s, nessun risultato incompleto, ripristino |
| `--full --growth=continuous`, Multi widget/editor | Crescita senza fine interrotta dai limiti; dopo il recupero della coda interviene il limite dei tentativi. Nessun pezzo nuovo, conservazione del precedente |
| `--growth=fast --multi --editor` (Area) | La pagina cresce a 2600 px, ma il PNG resta 2198 px come selezionato: non viene ampliata la selezione |
| DeepSeek Full e Area Multi editor, zoom 110% | PNG rispettivamente 1920×8645 e 1917×8643; 24 voci menu verificate senza differenze, ripristino. Full confronta il fondo misurato durante la cattura (7859), non l'altezza dopo il ripristino del menu (7877) |
| Pubblicità locali Full Multi widget e Area Multi editor | Entrambi gli annunci conservano tutte le 532 righe, nella posizione corretta e senza tagli |
| Colonne indipendenti Area Multi editor | Immagine invariata: SHA256 `46A75C1F8722AF5FDD3CD5AF36B9358BC46EF85744833635656522CA8D7775CF` |
| Full Multi editor con `--composition-gap` | Omessa deliberatamente una foto: errore specifico di copertura, nessun file/pezzo incompleto, ripristino |

**Yahoo senza pre-scorrimento (`--full --site=yahoo --cold`):** il fondo aggiunto viene incluso. Cattura normale 1920×11435 (da 11012 durante la cattura), Multi editor 1920×11312 (da 10889), Multi widget 1920×11435 (da 11012). In entrambi i Multi le ultime 128 righe dell'output coincidono pixel per pixel con l'ultimo fotogramma, e l'altezza coincide con quella finale del documento. Il test Multi editor ha passato anche il controllo dei tre annunci, tutti coperti.

**Esito Yahoo NON interamente superato:** nella visita Multi widget un contenitore pubblicitario preparato è tornato `sticky` durante la cattura, e altri annunci sono apparsi dopo la preparazione. Il controllo di posizione ha fallito (deriva 1853,53 px); l'immagine, aperta e ispezionata, mostra frammenti pubblicitari. Il fondo è presente, ma questo NON certifica il fix pubblicitario. Resta inoltre il dock destro ripetuto vicino al footer. Artefatti `full-yahoo-cold-multi-widget-*`; nessuna asserzione indebolita per far passare questo difetto.

Ripetuti i **39** controlli Area con zoom, i **33** guardrail dei menu, i **59** controlli pubblicitari locali e la suite Stop/popup/movimenti (**88 passati, 0 falliti, 21 obsoleti saltati**). Sintassi dei sorgenti/script e `git diff --check` superati. Il simulatore della suite Stop è stato aggiornato con le nuove misure, senza fingere di testare i tempi: quelli sono provati nel browser. Due aspettative del test live sono state corrette: il numero di annunci può crescere fra apertura e preparazione; il ripristino del menu può cambiare l'altezza rispetto all'immagine. Le immagini Yahoo e della fixture al 125% sono state aperte e guardate. Nessun clic sulla toolbar dell'estensione installata, nessuna prova dell'account Facebook; i limiti temporali globali da 20/60 s non sono stati esauriti separatamente.

**Limiti della strategia:** una pagina che non espone segnali di caricamento e aggiunge contenuti solo dopo l'intervallo di quiete può ancora sfuggire; non è possibile promettere la cattura di futuri aggiornamenti arbitrariamente tardivi. Inserimenti sopra la coda ripresa, pubblicità mutate successivamente e duplicazione del dock Yahoo restano fuori da questa correzione.

**Conferma manuale del 21/09:** l'utente ha allegato una cattura Yahoo di 1920×18562 con la sezione finale presente e ha approvato la chiusura del solo problema del fondo tagliato, chiedendo commit e push. Le pubblicità restano aperte. Riepilogo e commit in `IDEE_FATTE.md`; manifest, ZIP e Store invariati. Nessun nuovo test durante il salvataggio su Git.

## Pubblicità Yahoo: correzione locale in attesa di conferma, 20/09/2026

**Aggiornamento del 21/09:** questa sezione conserva le prove iniziali. Le visite senza pre-scorrimento descritte sopra hanno confermato che il fix pubblicitario è ancora parziale; la successiva conferma dell'utente riguarda soltanto il fondo caricato in ritardo.

L'utente ha chiesto di riprendere questo problema prima dei commit e ha autorizzato esplicitamente catture Yahoo/locali, Full Page, Area e Multi Snip.

**Causa osservata:** una carta pubblicitaria entra in una foto solo in parte; nella foto successiva diventa sticky e il vecchio trattamento la nasconde interamente come duplicato. La parte inferiore non viene acquisita. Il confronto pubblico `--site=yahoo --ref=383de46` e la riproduzione locale `--ads --ref=383de46` conservano il difetto; nella seconda il controllo delle righe dell'annuncio fallisce.

`prepareCaptureAds` nel controller comune mantiene temporaneamente nel flusso i contenitori sticky corti e stretti identificati da marcatori pubblicitari (senza regole per hostname). Non cambia altezza/larghezza, non rimuove annunci e ripristina i valori CSS originali. Esclude elementi fixed, barre/header/menu, modali, feed, contenitori indipendenti e layout inadatti. Un dock laterale sticky con etichetta modal non blocca gli annunci esterni, ma non viene modificato. Area usa la composizione per coordinate anche quando sono questi annunci a essere preparati, riutilizzando il fix dello zoom. Full/Area normali e Multi condividono la preparazione e il ripristino.

Verifiche eseguite:

- Pagina locale `--ads`: Full Page, Area e Area Multi editor conservano ciascuna carta di 532 righe per intero, una sola volta e nella posizione prevista. Nessuna fascia mancante o ricollocata. Stop Area Multi editor ed errore Full Multi widget ripristinano gli stili, conservano il pezzo precedente e non producono immagini incomplete.
- Yahoo Full/Area normali, Area Multi widget, Full Multi editor e Full Multi widget: immagini prodotte e ripristino verificato. Le tre carte identificate restano nella stessa posizione del documento e i fotogrammi coprono le loro righe inferiori (tolleranza di una riga CSS per bordi frazionari). Le immagini Full/Area normali e Full Multi widget sono state aperte: i riquadri pubblicitari presenti risultano interi. Il confronto è visivo e sulle geometrie dei fotogrammi, non un confronto pixel fra annunci dinamici di visite diverse.
- Yahoo Area Multi editor con zoom reale 110%: PNG 1917×12428, composizione e ripristino superati. **In questa visita diversi spazi pubblicitari erano vuoti**: questa immagine verifica il percorso e le geometrie, non la resa di creatività pubblicitarie che Yahoo non ha mostrato.
- `test-capture-ads.cjs`: **59 verifiche passate** su ambito della modifica, marcatori alternativi, dimensioni invariate, priorità CSS, ripetizione della preparazione e ripristino. Ripetuti i 39 controlli dello zoom, i 33 dei menu e la suite precedente (88 passati, 0 falliti, 21 obsoleti saltati).
- DeepSeek Area Multi editor al 110% ancora valido: 24 link verificati senza differenze e ripristino. Colonne indipendenti Area Multi editor ancora identiche: SHA256 `46A75C1F8722AF5FDD3CD5AF36B9358BC46EF85744833635656522CA8D7775CF`.

**Limiti ancora aperti:** Yahoo può crescere dopo la selezione/misura (per esempio da 11012 a 11435 pixel); il fondo aggiunto può restare fuori. In alcune Full Page ricompare inoltre parte del dock destro vicino al footer: non è il taglio pubblicitario corretto qui, né una regressione dimostrata di questa modifica. Contenitori nuovi creati solo dopo la preparazione non vengono normalizzati da questo helper. Non dichiarare Yahoo risolto in generale. I test usano codice reale con API Chrome adattate nel browser isolato, non il clic sull'icona dell'estensione installata. Nessun nuovo commit, push, pacchetto o rilascio; richiesta la conferma manuale dell'utente prima di archiviare la correzione pubblicitaria.

## Area con zoom: correzione confermata, 20/09/2026

L'utente ha precisato che l'errore è ricomparso su **DeepSeek Thinking Mode al 110%**, non su MDN in quest'ultima prova, e ha autorizzato tutte le verifiche, comprese quelle Multi Snip.

- Riproduzione: `node tools/test-area-sidebar.cjs --live --zoom=110 --ref=383de46`. Il codice salvato produce 10 scatti da 1920×911 ma la composizione rifiuta un falso buco di un pixel e non salva. Il ramo responsabile era stato aggiunto in `02bd727`. Nel browser adattato l'errore originale è visibile direttamente; non è una riproduzione dell'esatta scritta generica restituita dalle API dell'estensione installata.
- Causa: `innerHeight` arrotonda 828,18 a 828; il rapporto ricavato da quel valore introduce una deriva. Anche arrotondare separatamente la distanza anziché i bordi assoluti può inventare un pixel. Al 125% il passo arrotondato può invece saltare una riga reale.
- Correzione locale: scala compatibile con i pixel reali, bordi assoluti e passo con un pixel di sovrapposizione nel solo percorso Area dei documenti con menu aperto temporaneamente. Le colonne indipendenti e il motore Full Page non sono modificati. Gli errori di composizione vengono restituiti esplicitamente; restano vietati risultati con veri buchi o fondo mancante.
- `--zoom=90|100|110|125` usa il vero zoom del browser in un profilo temporaneo, non solo l'emulazione della risoluzione. La chiave della preferenza deriva dal [codice Chromium](https://chromium.googlesource.com/chromium/src/+/lkgr/chrome/browser/ui/zoom/chrome_zoom_level_prefs.cc). Nessuna preferenza dell'utente viene letta o cambiata. I nomi degli artefatti distinguono zoom e riferimento Git; `--site=web` seleziona ora l'esatta URL MDN `/en-US/docs/Web`.

Verifiche finali approvate:

| Prova | Esito |
| --- | --- |
| DeepSeek Area 110%, normale e Multi widget | 10 scatti, PNG 1917×8643; 24 voci menu, zero differenze nei frammenti verificati; ripristino |
| DeepSeek Area 110%, Multi editor, trascinamento al bordo destro fino al fondo | PNG 1863×8468 e ripristino; selezione via mouse CDP, non sopra una scrollbar nativa visibile; nessuna asserzione sui pixel del menu parzialmente escluso |
| DeepSeek Area 125%, Multi editor | 11 scatti, PNG 1918×9771; 24 voci menu, zero differenze nei frammenti verificati; ripristino |
| DeepSeek Area 100% e 90% | PNG e ripristino; al 90% il menu entra già nella finestra, quindi non viene espanso e si usa il percorso precedente |
| DeepSeek Full Page 110% | PNG 1920×8647, menu verificato e ripristino; il motore non è cambiato |
| MDN `/Web`, Area 110%, Multi editor | PNG 1917×4620; 16 link verificati senza differenze e ripristino |
| Stop DeepSeek 110% Multi; fotogramma deliberatamente omesso nella prova locale Multi editor | Nessun file/pezzo incompleto; pezzo precedente e stili conservati; errore specifico, non «immagine troppo grande» |

`test-area-fractional.cjs`: **39 controlli passati** sul compositore reale e canvas nel browser, con righe sorgente deterministiche, scale 90–200%, origini frazionarie, dimensioni, buchi reali, fondo mancante, errore di decodifica e scala alternativa. `--composition-gap` nel test integrato omette una foto per verificare il rifiuto e il ripristino. Ripetuti anche i 33 controlli sui menu e la suite Stop/popup/movimenti: 88 passati, 0 falliti, 21 casi obsoleti saltati. La cattura delle colonne indipendenti Multi editor conserva SHA256 `46A75C1F8722AF5FDD3CD5AF36B9358BC46EF85744833635656522CA8D7775CF`.

Le immagini Area Multi al 110% e 125% sono state aperte e ispezionate. Le prove del flusso restano con API Chrome adattate: non sono un collaudo del clic sulla barra strumenti dell'estensione installata. La prima modifica risolveva il 110% ma non il 125%; il passo è stato corretto prima delle verifiche finali. Un'asserzione del test che pretendeva l'espansione del menu anche quando già visibile al 90% è stata corretta e la prova ripetuta con successo.

**Conferma manuale ricevuta:** alla domanda se avesse riprovato al 110% e salvato senza errori, l'utente ha risposto «esatto», allegando l'immagine DeepSeek risultante (1918×8433). Chiusura di questo errore registrata in `IDEE_FATTE.md`. Nessun nuovo test durante l'archiviazione; nessun nuovo commit, push, ZIP o rilascio. Le pubblicità Yahoo restano in pausa e non sono state corrette. La vecchia chiusura MDN sotto è conservata come cronologia distinta.

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
