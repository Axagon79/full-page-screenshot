# HANDOFF — Full Page Screenshot Extension

**Generato:** 14 agosto 2026  
**Origine:** recupero selettivo da una chat diventata mista fra due progetti.  
**Ambito esclusivo:** estensione Chrome Full Page Screenshot, catture, Multi Snip, editor, pacchetto 9.9 e Chrome Web Store.

> Non importare qui alcun contenuto di AI Simulator, Mistral, partite, pronostici o del vault `G:\AI_Simulator_vault`.

## Coordinate del progetto

```text
Repository: C:\Progetti\full-page-screenshot
Sorgente estensione: C:\Progetti\full-page-screenshot\full-page-screenshot-extension
Repository remoto: github.com/Axagon79/full-page-screenshot
```

- Versione nel manifest: **9.9**.
- Versione pubblicata sul Chrome Web Store secondo il contesto della sessione: **9.8**.
- La 9.9 **non è ancora pubblicata**.
- Branch attivo al momento di questo handoff: `chore/project-session-stamp`, HEAD `f8eba46`, allineato al remoto.
- `main` e `origin/main` sono a `9e5a3a1`, ultimo commit di prodotto.
- Il commit `f8eba46` aggiunge soltanto il timbro progetto `AGENTS.md` e ignora il file personale `dialetto-frasi.json`; non cambia l'estensione.

Prima di nuove modifiche, verificare il branch e decidere consapevolmente se lavorare sul branch corrente o integrare il timbro in `main`. Non cambiare branch o fare merge senza l'utente.

## Obiettivo della 9.9

La 9.9 è la release del **Multi Snip** e dell'editor integrato:

- accumulo di più catture, anche da tab differenti;
- catture Area, Visibile e Full Page nella stessa sessione;
- pannello di raccolta che segue i tab;
- composizione su tela libera con spostamento, ridimensionamento, snapping e guide;
- annotazioni, oscuramento, testo, forme, contatori, lente di richiamo e sfondo;
- export PNG, JPG, WEBP, PDF e copia negli appunti.

Il posizionamento deciso è: **multi-snip + multi-tab + tela libera**, combinazione non trovata nei concorrenti analizzati.

## Lavoro già presente nel codice

### Nucleo Multi Snip

Dal 05/08 sono stati implementati raccolta progressiva, widget sulla pagina, sessione cross-tab, tela libera, pezzi trascinabili/ridimensionabili, calamita, guide, undo/redo della raccolta, anteprima, stampa e importazione universale di immagini con `Ctrl+V`.

Commit principale iniziale: `6e04af4`, seguito dalla serie di affinamenti del 05-06/08 documentata nella cronologia Git.

### Editor 9.9

Commit principali:

- `a99acc9` — ritaglio, oscuramento, evidenziazione, linea, testo ed export PNG/JPEG/PDF;
- `e46661a` — annotazioni ancorate al pezzo, Solid/Blur, strumenti persistenti, Move/Esc, cronologia, linee selezionabili e Fit canvas reversibile;
- `075b933` — zoom completo dell'area di lavoro;
- `0f75f99` — export WEBP;
- `ae88c58` — copia negli appunti senza salvare;
- `7886355` — libreria di 37 forme;
- `d13b1cf` — contatori numerati con rinumerazione automatica;
- `40cafd9` — lente di richiamo/zoom callout;
- `6934d16` — studio dello sfondo: preset, gradiente/solido, margine, ombra, angoli, proporzioni e filigrana.

### Ultimo affinamento professionale dell'editor

Commit `9e5a3a1` del 12/08, file interessati:

```text
full-page-screenshot-extension/editor.html
full-page-screenshot-extension/editor.js
full-page-screenshot-extension/sw.js
```

Nel codice risultano implementati:

- barra strumenti raggruppata e capace di andare su più righe;
- Undo e Redo con frecce riconoscibili e testo esplicito;
- selettore formato descrittivo e pulsante `Save PNG/JPG/WEBP/PDF` coerente;
- oscuramento selezionabile, trascinabile e ridimensionabile;
- pannellino Solid/Blur cliccabile anche con uno strumento armato;
- ritorno automatico a Move dopo la creazione dell'oscuramento;
- pannellino disposto sopra la nota o, se manca spazio, sotto: non deve coprire l'effetto regolato;
- levetta blur verticale continua da 0% a 400%, curva meno sensibile e 0% realmente trasparente;
- uso di `writing-mode` al posto di `appearance: slider-vertical`, che generava l'avviso Chrome;
- spunta `✓` su ogni pannellino per confermare e chiudere;
- testo con 7 font locali, colore personalizzato, dimensione 10-120 px, maniglie e clipping coerente nell'export;
- rotellina coerente nell'editor: scorrimento normale, `Ctrl` + rotella per lo zoom;
- rotellina in modalità Area inoltrata alla pagina o allo scroller interno prima e durante il trascinamento, anche dentro Multi Snip.

Questi punti sono stati verificati nel codice, **non collaudati visivamente in questo audit**. Non dichiararli conclusi o pronti per lo Store senza prova reale dell'utente.

## Residui tecnici osservati nel codice

- In una finestra molto stretta, il gruppo interno `Annotate` non va a capo da solo e può ancora oltrepassare il bordo sotto circa 580 px.
- Il pannellino delle annotazioni sceglie sopra/sotto, ma non viene ancora limitato orizzontalmente ai bordi della tela.
- Le annotazioni hanno quattro maniglie angolari; pezzi e tela dispongono della gestione più ricca a otto maniglie.

Sono osservazioni, non modifiche autorizzate. Verificarle nell'estensione prima di decidere se intervenire.

## Cattura Area e top bar

- `567a189` corregge il caso in cui la scocca `fixed` dell'applicazione disattivava la difesa contro la top bar.
- Durante una cattura le animazioni della pagina possono fermarsi e riprendono alla fine: l'utente lo ha verificato e non lo considera un congelamento permanente.
- In una prova successiva la selezione Area escludeva correttamente la top bar dopo aver ricaricato l'estensione. Tenere distinta una vecchia estensione caricata dal codice attuale.

## Stato reale del pacchetto 9.9

Il file esistente:

```text
C:\Progetti\full-page-screenshot\full-page-screenshot-extension\9.9.zip
```

è del **08/08/2026** e non rispecchia il sorgente corrente. Confronto voce per voce: 14 file coincidono, ma questi tre sono diversi:

```text
editor.html
editor.js
sw.js
```

Sono esattamente i file aggiornati da `9e5a3a1` il 12/08. Lo ZIP attuale non contiene quindi gli ultimi fix dell'editor e della rotellina.

Prima della pubblicazione:

1. completare il collaudo e le eventuali correzioni autorizzate;
2. rigenerare localmente `9.9.zip` dalla cartella sorgente;
3. confrontare nuovamente ogni file ZIP con il sorgente;
4. controllare che lo ZIP contenga solo i file necessari all'estensione;
5. pubblicare sullo Store soltanto su ordine esplicito dell'utente.

Lo ZIP è ignorato da Git tramite `*.zip`; non esistono `package.json`, build system o script di release automatico.

## Chrome Web Store e policy

Manifest attuale:

- Manifest V3;
- permessi: `activeTab`, `scripting`, `downloads`, `storage`, `contextMenus`;
- `<all_urls>` è `optional_host_permissions`, non permesso obbligatorio;
- promessa dichiarata: nessuna raccolta dati, nessun account, nessun tracking, elaborazione locale.

Decisione già presa: **niente review gating**. L'invito mostra sempre sia il link per lasciare una stella sia quello per inviare feedback; non separa utenti soddisfatti e insoddisfatti.

Non risulta completato un audit policy definitivo della 9.9. Prima di pubblicare verificare almeno:

- coerenza fra permessi richiesti e funzioni effettive;
- nessun codice remoto o caricamento dinamico vietato;
- privacy policy coerente con storage, clipboard e download reali;
- descrizione Store fedele al comportamento corrente;
- motivazione dell'accesso opzionale multi-tab/all URLs;
- assenza di flussi che possano essere interpretati come review manipulation.

L'avviso di sicurezza visto sull'estensione concorrente GoFullPage non dimostra automaticamente una violazione nostra o loro; ha soltanto rafforzato la decisione di fare un controllo policy serio.

## Documentazione da riallineare

### `IDEE.md`

È arretrato:

- intestazione ferma al 17/07 e versione dichiarata 9.8;
- dice ancora che Multi Snip non è iniziato;
- indica forme, contatori, sfondo e lente di richiamo come aperti, ma sono implementati nei commit del 07/08.

Non cancellare o spostare voci senza seguire la regola TODO/IDEE e senza conferma dell'utente.

### `DESCRIZIONE-STORE.md`

La descrizione 9.9 presenta correttamente `BUILT-IN EDITOR (NEW)`, ma più sotto contiene ancora la frase contraddittoria:

```text
No image editor built in (annotations, arrows, blur) — on the roadmap.
```

Va corretta prima di incollare la descrizione lunga nella dashboard dello Store.

## File principali

```text
C:\Progetti\full-page-screenshot\IDEE.md
C:\Progetti\full-page-screenshot\DESCRIZIONE-STORE.md
C:\Progetti\full-page-screenshot\README.md
C:\Progetti\full-page-screenshot\full-page-screenshot-extension\manifest.json
C:\Progetti\full-page-screenshot\full-page-screenshot-extension\editor.html
C:\Progetti\full-page-screenshot\full-page-screenshot-extension\editor.js
C:\Progetti\full-page-screenshot\full-page-screenshot-extension\sw.js
C:\Progetti\full-page-screenshot\full-page-screenshot-extension\settings.js
C:\Progetti\full-page-screenshot\full-page-screenshot-extension\9.9.zip
```

## Vincoli per la nuova chat

- Lavorare esclusivamente su Full Page Screenshot.
- Verificare i file prima di modificarli.
- Non considerare la 9.9 pronta finché editor, pacchetto e policy non sono verificati.
- Non rigenerare lo ZIP, pubblicare sullo Store o modificare permessi senza ordine esplicito.
- Non ripetere ricerche sui concorrenti già consolidate in `IDEE.md` salvo nuova richiesta.
- Non dichiarare risolto un problema grafico sulla sola lettura del codice: serve collaudo reale.
- Preservare le modifiche dell'utente e non mischiare contenuti di AI Simulator.

## Come recuperare questo handoff

Nella nuova chat aperta sul progetto Screenshot, non usare il generico “recupera la chat”, perché l'altro progetto possiede un handoff distinto. Scrivere invece:

> Recupera esclusivamente il progetto Screenshot leggendo `C:\Progetti\full-page-screenshot\HANDOFF_SCREENSHOT.md`. Non leggere né usare l'handoff di AI Simulator.

La nuova chat deve prima confermare di aver letto questo file e poi chiedere all'utente da quale punto vuole riprendere.
