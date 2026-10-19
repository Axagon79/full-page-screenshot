# Prove locali delle catture

Eseguire i controlli soltanto dopo l'approvazione dell'utente, come indicato nelle regole del progetto.

## Area deve rispettare il taglio scelto — 19/10/2026, chiusura confermata

Precisazione dell'utente: la selezione finiva a metà chat, prima della barra
di input. Non si chiede di rimuovere sempre la barra, ma di catturare solo
il rettangolo scelto, senza aggiungere UI e senza coprire il testo finale.
Correzione e prove locali autorizzate esplicitamente.

Riproduzioni con `node tools/test-area-sidebar.cjs --chat
--chat-before-input --ref=d7f00f2` e `--chat
--chat-before-input-one-frame --ref=d7f00f2`: il codice precedente aggiunge
rispettivamente 100 e 50 righe della barra pur con intersezione selezionata
pari a zero. Nel primo caso sostituisceva il fondo del contenuto con una
barra ricatturata al fondo reale della chat. Nel secondo bastava uno scatto,
ma lo spostamento necessario della selezione portava la barra sopra il testo.

In `sw.js` viene ricordata la posizione del bordo inferiore della selezione,
anche nei trascinamenti verso l'alto. Le barre inferiori sono escluse dagli
scatti del contenuto; vengono ricopiate solo se incluse nel rettangolo,
dalla vista scelta e solo per la porzione selezionata. Non si scorre più al
fondo dell'intera pagina per fotografarle. La composizione esatta dei campi
di chat rimane attiva anche quando la barra deve essere esclusa.
Uno scatto singolo conserva letteralmente la vista solo quando era già
visibile: se occorre spostarlo, vengono gestite anche le barre sovrapposte.
Nessuna modifica a Full Page, Visible Only, riga o politica di ripristino.

Prove locali al 100% passate, usando lo stesso motore Area e API Chrome
adattate in Edge isolato, senza account o conversazioni reali:

- `--chat --chat-before-input`, anche `--multi --editor --dark` e
  `--multi --mobile --dark`: PNG 1900×1710 / 370×1710, zero righe della
  barra, ogni riga di contenuto senza differenze, taglio esatto e scroll
  ripristinato a 640. Immagini aperte e controllate.
- `--chat --chat-before-input-one-frame --multi --editor`: PNG 1900×800,
  zero barra e zero differenze pur dopo lo spostamento della selezione.
- `--chat --chat-partial-input --multi`: solo le 50 righe effettivamente
  selezionate della barra, PNG 1900×1910, nessun contenuto estraneo.
- `--chat --multi --editor --mobile`: barra selezionata fino a un pixel
  prima del fondo; 99 righe, non 100. Confini selezionati e contenuto corretti.
- `--chat --chat-reverse --multi --editor`: trascinamento verso l'alto,
  PNG 1900×1110, soltanto le 50 righe della barra incluse all'inizio del drag.
- `--chat --chat-document --chat-before-input --multi --editor`: anche lo
  scorrimento del documento rispetta il taglio, zero barra e zero differenze.
- `--chat --chat-short`: selezione già visibile, PNG 1900×250 senza barra.
- `--chat --chat-before-input --multi --stop`: nessun nuovo pezzo/file,
  pezzi precedenti e posizione iniziale conservati.
- `--release --multi --editor`: colonna laterale presente una volta per
  tutte le 340 righe; barra inferiore realmente selezionata per 69 righe.
  Il controllo precedente non è stato indebolito.
- `--full --growth=static --start-scrolled --multi --editor`: Full Page
  invariata, PNG 1920×2200 senza differenze, ritorno in cima.
- Suite Stop: 75 passati, 0 falliti, 21 vecchi casi saltati; suite bollino
  NEW: 8 passati. Sintassi dei due file modificati e `git diff --check` passati.

File: `full-page-screenshot-extension/sw.js`, `tools/test-area-sidebar.cjs`.
L'utente ha provato sulla propria chat, riferito «Adesso funziona» e
confermato esplicitamente di considerare risolto questo problema il 19/10.
Voce archiviata in `IDEE_FATTE.md`. Nessun nuovo test durante l'archiviazione.
Nessun nuovo tentativo al
125%, nessuna nuova diagnosi dell'errore intermittente lasciato invariato
dall'utente il 18/10. Durante la sola archiviazione nessun commit/push o
aggiornamento ZIP. Su successiva richiesta dell'utente codice, prove e nota
nelle impostazioni salvati in `fddc31b`; pacchetto aggiornato come indicato
qui sotto. Nessun invio allo Store.

## ZIP 9.14 aggiornato con il taglio Area — 19/10/2026

Commit, push e aggiornamento richiesti dall'utente; confronto del pacchetto
autorizzato esplicitamente. `full-page-screenshot-extension/9.14.zip` contiene
26 file, versione 9.14, **1.621.916 byte**. Ogni file letto nello ZIP è stato
confrontato tramite SHA-256 con il sorgente sul PC: tutti identici. Inclusi
la correzione Area confermata e la relativa nota nelle impostazioni, senza
bollino NEW. Nessun file di lavoro, prova o ZIP annidato.

La copia del 18/10 è conservata, senza sovrascriverla, in
`full-page-screenshot-extension/Versioni precedenti zip/9.14-2026-10-18-prima-taglio-area.zip`;
impronta identica al precedente `9.14.zip`. Il pacchetto del 03/10 resta
anch'esso conservato. La 9.13 è stata soltanto letta per confronto: invariata.

SHA-256 nuovo ZIP 9.14: `FC17C9F9E4773F0710B6FF6CA170989A86871C18FDEE60B3DDF32FBC0AC74B19`.
SHA-256 copia 9.14 del 18/10: `19F32530734E623F08D3AA92A1331926CA687EE55337CBC21EE631115ADE5254`.
SHA-256 ZIP 9.13 invariato: `008478FCD5A2C7B13BAB13A287DD867A4C09F7B82F6BAC417692342776F69C8C`.

Il primo comando di creazione si è fermato prima di scrivere il pacchetto:
mancava il caricamento dell'assembly `System.IO.Compression` nella sessione
PowerShell. Caricato esplicitamente e ripetuto con successo; controllo dei
26 file passato prima della sostituzione. Nessun nuovo test di cattura.
ZIP locali ignorati da Git; su GitHub vanno codice, prove e documentazione.
La 9.14 resta in lavorazione, senza pubblicazione sullo Store. Restano
separati il confronto sintetico al 125% e la segnalazione intermittente.

## Area su chat: casella duplicata e posizione iniziale — 18/10/2026, in lavorazione

L'utente segnala la casella «Chiedi a ChatGPT» duplicata e sovrapposta al testo
in Area, più il ritorno molto sopra il punto iniziale dopo il salvataggio.
Autorizzate correzione e prove locali. Precisazione esplicita: **Full Page
deve continuare a tornare in cima; solo Area deve tornare alla posizione
precedente alla selezione**, anche quando usata in Multi Snip.

**Seguito del 18/10:** lo screenshot del menu Chrome dell'utente conferma
zoom **100%**. Riprese soltanto le verifiche indipendenti a quel livello;
nessun terzo tentativo sul 125%. Il caso al 100% è pronto per la verifica
dell'utente sulla sua chat, non ancora dichiarato concluso.

Riproduzione con `node tools/test-area-sidebar.cjs --chat --ref=ca87492`:
pagina locale senza account, contenitore interno e casella assoluta
sovrapposta ai messaggi. Il codice precedente riprende cinque volte la
fascia di 100 px della casella (500 righe viola) e torna a scroll 0 invece
di 640. Non è una riproduzione nella conversazione autenticata dell'utente.

Modifiche locali in corso:

- Area considera anche piccole barre assolute con campi di scrittura in
  fondo; il micro-scorrimento deve confermare che restino ancorate. La barra
  è esclusa dagli scatti del contenuto e ripresa una volta sola in fondo.
- Per questo percorso con campo di scrittura viene usata la composizione
  per coordinate, evitando il taglio cumulativo delle giunture del vecchio
  confronto fra immagini; controlli di copertura mantenuti.
- Il controller comune ripristina tutte le posizioni salvate prima della
  selezione Area, anche dopo successo. Rimosso l'azzeramento finale del suo
  scorrimento; Full Page non viene convertita a questa politica.

Il primo controllo dopo il riconoscimento della barra dava una sola casella
e scroll 640, ma 88 righe del contenuto non coincidevano: la vecchia
composizione sottraeva almeno un pixel anche fra scatti contigui. Il percorso
con campo di scrittura è stato quindi collegato alla composizione esatta,
senza ridurre le aspettative del confronto. Lo stile era inoltre confrontato
come stringa: attributo assente e vuoto sono stati resi equivalenti, senza
ignorare proprietà residue. La ripetizione al 100% è passata.

**Prime prove passate, prima dell'ultimo ritocco per il 125%:** Area normale
su chat locale, Multi pannello in scuro, Multi editor a 390 px, selezione
corta entro lo schermo (nessuna barra estranea), Stop Multi e chat con
scorrimento del documento. Casella una volta, posizioni ripristinate a 640,
nessuna differenza nelle righe del contenuto nei percorsi completati.
Passati anche zoom reale 110% e Area su documento normale da editor Multi
iniziando da scroll 640. Non sono prove sulla pagina ChatGPT dell'utente.

**125% non superato, due tentativi:** il primo viene rifiutato per copertura
incompleta; dopo arrotondamento iniziale e sovrapposizione di un pixel nel
solo percorso con campo di scrittura, il secondo produce una sola casella
di 125 px e ripristina scroll 640, ma il confronto rileva differenze su 50
righe di pixel. Non è ancora accertato se siano dovute alla composizione,
alla resa frazionaria o al confronto della prova. Nessuna aspettativa sui
pixel indebolita. Dopo il secondo tentativo i lavori si fermano per chiedere
indicazioni all'utente, come da regole; nessun terzo tentativo.

Suite Stop sul codice attuale: 75 passati, 0 falliti, 21 casi obsoleti
saltati. Aggiunti quattro casi per la diversa politica di ripristino Area/
Full, normali e Multi. Nel primo lancio i due nuovi casi Multi erano privi
della raccolta simulata; corretta la preparazione della prova, non il codice
di produzione, e suite ripetuta con successo. Il confronto dello stile
della casella considera equivalenti un attributo style assente e vuoto;
non ignora proprietà rimaste modificate.

**Prove ripetute sul codice corrente al 100%, passate:**

- `--chat`: PNG 1900×4169, casella una volta (100 righe), zero differenze
  nei colori del contenuto, scroll iniziale/finale 640.
- `--chat --multi --dark` e `--chat --multi --editor --mobile`, anche
  `--dark`: stesso risultato, PNG stretto 370×4169. I pezzi precedenti sono
  conservati. Immagini desktop e a 390 px aperte e controllate.
- `--chat --chat-short`: PNG 1900×250, nessuna casella aggiunta fuori dalla
  selezione, zero differenze e posizione conservata.
- `--chat --multi --stop`, `--chat --multi --editor --failure` e
  `--chat --multi --editor --composition-gap`: annullamento, errore di scatto
  e foto rimossa deliberatamente. Nessun nuovo file/pezzo, raccolta
  conservata, tutte le posizioni ripristinate e errore di copertura effettivo
  riportato, senza produrre un'immagine incompleta.
- `--growth=static --start-scrolled --multi`: Area sul documento da scroll
  640 torna a 640, contenuto selezionato senza differenze. Già passata la
  variante da editor.
- `--independent --multi --editor --start-scrolled`: Area a più colonne,
  PNG 1918×4118 e posizione principale ripristinata a 640.
- `--full --growth=static --start-scrolled --multi --editor` e
  `--full --independent --start-scrolled --multi`: Full Page termina in cima,
  con confronto immagine e ripristino degli stili passati.
- `--full --growth=static --start-scrolled --multi --stop`: Stop conserva
  invece la posizione iniziale 640, senza risultato incompleto.
- `--full --end-line --end-line-internal --multi --editor`: la riga mantiene
  la vista scelta e le colonne laterali, confronto pixel senza differenze.
- Suite Stop ripetuta: 75 passati, 0 falliti, 21 casi obsoleti saltati;
  sintassi dei quattro file JavaScript modificati e `git diff --check`
  passati. Sono prove con codice reale e API Chrome adattate in Edge
  isolato, non una prova della conversazione/account dell'utente.

**Precisazione sul ritorno di Full Page:** il primo nuovo controllo iniziato
da scroll 640 falliva perché quel percorso del codice precedente tornava a
`d.sy`, cioè alla posizione precedente, non in cima. Per rispettare la
richiesta esplicita dell'utente è stato corretto il solo ritorno finale di
Full Page normale e a più colonne. Riga, Stop ed errori mantengono la
posizione scelta/precedente. Entrambe le ripetizioni Full Page sopra sono
passate; il motore che acquisisce le immagini non è stato cambiato per
questa distinzione.

**Conferma manuale successiva del 18/10:** l'utente riferisce «funziona» con
una cattura ChatGPT al 100%; successivamente riferisce il funzionamento
anche al 125% e allega un'altra cattura. Nell'immagine ridimensionata
esaminata la casella compare una volta in fondo e non sono visibili testo
sovrapposto o ripetizioni evidenti. Non è una verifica dei singoli pixel né
un superamento del confronto automatico al 125%, che resta separatamente
aperto. La posizione finale non è stata confermata separatamente in chat;
le prove locali del ripristino sono quelle sopra.

**Salvataggio richiesto dall'utente:** codice, note delle impostazioni e
prove in `5ec508e`; documentazione in questo successivo commit. Lo ZIP 9.14
è stato aggiornato su richiesta: vedere il controllo del pacchetto sotto.
Nessun nuovo invio allo Store, nessuna nuova prova al 125% e nessuna
archiviazione complessiva dell'attività decisa dall'agente.

## Niente bollino NEW sull'icona — 18/10/2026

Richiesta esplicita dell'utente: nessun annuncio di novità sull'icona, sia
nell'estensione caricata dalla cartella locale sia nel pacchetto 9.14.
Rimosse l'attivazione all'aggiornamento e la riattivazione a fine sessione;
il vecchio stato `newsUnread` viene eliminato durante l'installazione/
aggiornamento e comunque ignorato quando il badge viene ricostruito.
Le novità restano consultabili volontariamente nelle impostazioni.

Il contatore dei pezzi Multi Snip resta; durante la cattura il bollino non
disturba Stop. Una vecchia scheda delle impostazioni che invia ancora il
messaggio di cancellazione non azzera il contatore Multi e non tocca Stop.

Prove esplicitamente autorizzate: `node --test tools/test-news-badge.cjs`,
8 passati, 0 falliti. Eseguiti i gestori reali di installazione, aggiornamento
e messaggi con API Chrome adattate: vecchio avviso presente, contatore 0/3,
sessione chiusa, vecchia scheda impostazioni e cattura attiva. Non è una
prova del disegno dell'icona nel profilo Chrome dell'utente. Suite Stop
ripetuta dopo la modifica: 75 passati, 0 falliti, 21 vecchi casi saltati.
Sintassi di `sw.js`, `settings.js`, nuovo test e `git diff --check` passati.
Codice, note e prove nel commit `5ec508e`.

## ZIP 9.14 aggiornato dopo il fix chat — 18/10/2026

Aggiornamento e confronto esplicitamente richiesti/autorizzati dall'utente.
Pacchetto: `full-page-screenshot-extension/9.14.zip`, versione 9.14,
26 file, **1.621.424 byte**. Tutti i file estratti in lettura confrontati
tramite SHA-256 con quelli della cartella attuale dell'estensione: identici.
Elenco dei file uguale alla 9.13, incluse tutte le immagini già presenti;
nessun file di prova o archivio ZIP annidato. Comprende anche `sw.js` e
`settings.js` con rimozione del bollino NEW e le correzioni Area/ritorno.

ZIP 9.13 confrontato prima e dopo, invariato. Il vecchio ZIP 9.14 del 03/10
è stato spostato senza sovrascriverlo in
`full-page-screenshot-extension/Versioni precedenti zip/9.14-2026-10-03-prima-fix-chat.zip`;
verificato identico alla copia precedente, quindi recuperabile. Il nuovo
ZIP è stato controllato prima di sostituire il percorso 9.14.zip.

SHA-256 nuovo ZIP 9.14: `19F32530734E623F08D3AA92A1331926CA687EE55337CBC21EE631115ADE5254`.
SHA-256 ZIP 9.13 invariato: `008478FCD5A2C7B13BAB13A287DD867A4C09F7B82F6BAC417692342776F69C8C`.
SHA-256 copia precedente 9.14: `E8B1A6DA5636ABB17DCC44B9C3C9D10A9F91A69C6ACD7AF3B1744AEAF7D278FE`.

I pacchetti restano locali e ignorati da Git. Nessuna pubblicazione della
9.14 sullo Store: il pacchetto è ancora provvisorio secondo la decisione
dell'utente e va rigenerato dopo eventuali ulteriori modifiche.

## Avvio della 9.14 e controllo del pacchetto — 03/10/2026

Su richiesta dell'utente, il manifest
passa a 9.14. Le note di `settings.js` elencano soltanto il fix della riga sui
contenitori interni e la gestione della vecchia riga dopo ricarica
dell'estensione. Nessuna nuova funzione, permesso o modifica alla descrizione
Store. Nessun invio della 9.14 allo Store.

**Salvataggio successivamente autorizzato — 03/10/2026:** codice,
prove locali, manifest e note della 9.14 nel commit `a4d8a52`. Archivio,
decisione sulla revisione 9.13 e queste note nel successivo commit
documentale; push richiesto dall'utente. Nessun nuovo test durante i commit.
Gli ZIP restano locali e ignorati da Git; nessuna pubblicazione della 9.14.

**Precisazione successiva dell'utente:** la 9.13 è ancora in revisione,
non già pubblicata. La 9.14 resta una versione in lavorazione: prima
aspettare l'approvazione della 9.13, raccogliendo eventuali bug da correggere
e novità concordate. L'intenzione è inviarla quando includerà anche qualcosa
di nuovo, dopo verifiche autorizzate e decisione finale dell'utente.
Lo ZIP attuale è provvisorio; non viene inviato né rigenerato per questa
sola annotazione. Nessuna nuova prova eseguita.

Creato `full-page-screenshot-extension/9.14.zip` come pacchetto di partenza:
26 file, 1.620.487 byte, stessi nomi di file della 9.13, presi dai sorgenti
attuali. Comprende tutte le risorse dell'estensione già presenti nella 9.13,
incluse le immagini. Non contiene altri ZIP, cartelle di lavoro, prove o
impostazioni personali dell'editor.

**Controllo esplicitamente autorizzato dall'utente e passato:** riapertura
dello ZIP, manifest 9.14, 26 file ciascuno identico al sorgente corrente
tramite confronto SHA-256; ZIP 9.13 identico prima e dopo. Nessuna nuova
prova di cattura durante il confezionamento: valgono le prove e la conferma
utente documentate sotto. Il pacchetto deve essere rigenerato se si
aggiungono altre modifiche prima della pubblicazione.

SHA-256 ZIP 9.13: `008478FCD5A2C7B13BAB13A287DD867A4C09F7B82F6BAC417692342776F69C8C`.
SHA-256 ZIP 9.14: `E8B1A6DA5636ABB17DCC44B9C3C9D10A9F91A69C6ACD7AF3B1744AEAF7D278FE`.

## Riga su pagine con scorrimento interno — 03/10/2026

**Chiusura confermata dall'utente il 03/10/2026:** ha riferito «Funziona»
e ha approvato esplicitamente di considerare risolto il problema della riga.
Non ha precisato quali delle tre pagine segnalate siano state riprovate.
Conferma del suo utilizzo, distinta dalle prove locali sotto. Voce archiviata
in `IDEE_FATTE.md`; nessun nuovo test durante questa archiviazione.

L'utente ha autorizzato la correzione e le prove. Nel risultato della console
fornito dall'utente il documento resta alto 828 px e fermo; scorre un DIV
interno alto 5010 px. Il precedente rifiuto del comando «fino a qui» era
quindi coerente con il limite del codice, non risolto ricaricando la pagina.

La riga ora conserva il riferimento al contenitore principale visibile.
Il motore Full Page comune acquisisce quel contenuto dall'inizio alla riga;
le altre colonne vengono prese dalla vista scelta e mantenute accanto al
fondo, senza scorrerle o ripeterle. Alla fine o allo Stop tornano tutte le
posizioni e gli stili iniziali. Full Page e Area senza riga mantengono i
percorsi precedenti. In caso di pagina cambiata o copertura incompleta viene
segnalato un errore, senza salvare un'immagine parziale.

Gestito anche il lancio sincrono di «Extension context invalidated» dopo una
ricarica dell'estensione: la vecchia riga viene rimossa, senza lasciare un
pulsante disabilitato o un errore non gestito. Non mantiene in vita una pagina
collegata alla vecchia estensione: dopo l'aggiornamento va ricaricata anche
la pagina.

Prove con `node tools/test-area-sidebar.cjs`, Edge isolato e codice reale
con API Chrome adattate, su pagina locale a tre colonne indipendenti:

- `--full --end-line --end-line-internal --end-line-button`: cattura normale
  dal pulsante vicino alla riga; PNG 1920×1750, ogni riga del contenuto e
  tutti i pixel delle colonne laterali corretti rispetto alla vista scelta.
- `--full --end-line --end-line-internal --multi --editor --zoom=110 --dark`:
  PNG 1920×1925, confronto senza differenze e pezzo precedente conservato.
- `--full --end-line --end-line-internal --end-line-sidebar --multi --editor
  --zoom=125`: riga piazzata dal lato della colonna laterale ma collegata al
  contenuto principale; PNG 1920×2188, confronto senza differenze.
- `--full --end-line --end-line-internal --mobile --end-line-drag
  --end-line-button --multi`: trascinamento e avvio reale col mouse a 390 px,
  PNG 390×1800, confronti senza differenze. Passata anche la cattura da editor
  a 390 px in modalità scura. Non sono prove su un dispositivo mobile.
- `--end-line-short --multi --end-line-button`, con i tre flag di base:
  taglio entro il primo schermo, PNG 1920×350, nessuna coda aggiunta.
- `--end-line-anchor --multi --editor`, con i tre flag di base: inserimento
  di 50 px sopra il punto scelto, ancoraggio verificato e PNG corretto.
- `--end-line-stale --end-line-button`, con i tre flag di base: messaggio
  Chrome simulato che lancia sincronicamente l'errore; vecchia riga rimossa,
  nuova riga e cattura funzionanti. Non è una ricarica dell'estensione
  installata nel profilo dell'utente.
- `--full --end-line --end-line-internal --multi --mobile --dark --stop`:
  annullamento durante gli scatti, nessun nuovo pezzo/file, precedente
  conservato, riga nuovamente disponibile e tutte le colonne ripristinate.
- `--failure --multi --editor`, con i tre flag di base: errore di scatto
  simulato, niente immagine incompleta, ripristino e raccolta conservati.
- `--full --end-line --end-line-internal --multi --editor --composition-gap`:
  ultimo scatto deliberatamente rimosso; errore di copertura effettivo
  riportato all'utente, nessun nuovo pezzo, ripristino passato.

I «tre flag di base» sopra sono `--full --end-line --end-line-internal`.
Su tutti i percorsi interni si controllano anche le tre posizioni di scroll,
gli stili originali, l'assenza dell'indicatore e della riga nell'immagine.
Anteprime chiare/scure, desktop/390 px e immagine finale aperte e controllate.

**Difetti trovati durante le prove:** al 125% il primo confronto ha mostrato
un pixel finale mancante per l'arrotondamento dello scorrimento. Corretto
solo il percorso riga/contenitore: misura del viewport visibile e ultimo
scroll arrotondato al pixel fisico superiore, con immagine sempre ritagliata
alla riga. Ripetizione al 125% e controlli al 110%/390 px passati. Il controllo
dello scatto omesso inizialmente cercava il vecchio testo dell'errore:
aspettativa aggiornata al messaggio preciso di copertura incompleta, senza
ignorare errori o differenze nei pixel. Passato alla ripetizione.

Regressioni locali passate: riga sul documento normale (`--full
--growth=static --end-line --end-line-button`), Full Page e Area da editor
Multi Snip (`--growth=static --multi --editor`, con/senza `--full`), Area
con colonne indipendenti (`--independent --multi --editor`) e Full Page
con colonne indipendenti (`--full --independent --multi --editor`). Suite
Stop: 71 passati, 0 falliti, 21 vecchi casi saltati. Sintassi dei cinque
file JavaScript modificati e `git diff --check` passati.

**Limite:** nessuna prova dentro gli account DeepSeek, AI Studio o Firebase,
nessun accesso a dati/account/database. Non certifica la gestione di liste
virtualizzate o delle geometrie specifiche di quei siti. La successiva
conferma dell'utente non dimostra una prova separata su tutte e tre le pagine.
Manifest, ZIP 9.13, Store, commit e push non modificati per questa correzione;
chiusura approvata dall'utente e archiviata in `IDEE_FATTE.md`.

## Popup AI Tarot: correzione confermata e limite della prova automatica — 03/10/2026

**Chiusura confermata dall'utente il 03/10/2026:** ha riferito che la cattura
funziona e ha approvato esplicitamente di considerare risolto il problema.
La conferma riguarda il suo utilizzo; non dimostra che abbia ripetuto il
controllo automatico a 390 px descritto sotto. Il limite di quel controllo
rimane documentato, senza presentarlo come un guasto visibile accertato.
Riepilogo in `IDEE_FATTE.md`. Nessun nuovo test durante questa archiviazione.

Sulla pagina pubblica `https://www.aitarot.pro/it/pricing`, premendo «Ottieni
Plus» senza account, si apre il popup di accesso segnalato dall'utente.
Nessuna registrazione, credenziale o procedura di pagamento è stata eseguita.
Le prove usano Edge isolato con codice di produzione/API Chrome adattate,
non l'estensione installata nel profilo dell'utente.

**Riproduzione con la prima correzione:** il popup è un dialog personalizzato
Radix, non un dialog nativo. L'overlay era nel top layer ma ereditava
`pointer-events: none` dal body: hit testing sul popup sottostante, nessun
rettangolo e attesa della selezione. Correzione aggiuntiva in `sw.js`: eventi
del puntatore abilitati esplicitamente solo sull'overlay, inserito nel dialog
personalizzato visibile in primo piano. La pagina dietro resta bloccata come
previsto dal sito e i clic della selezione non sono clic esterni al popup.

Prove desktop passate con `node tools/test-area-sidebar.cjs`:

- `--site=pricing`: selezione col mouse reale, PNG 449×459, immagine aperta
  e controllata; popup ancora aperto e vuoto, stile body invariato.
- `--site=pricing --multi`: aggiunta dal pannello senza scaricare un file.
- `--site=pricing --multi --editor --popup-inside`: drag iniziato dentro al
  popup; PNG 401×411 e pezzo precedente conservato.
- `--site=pricing --multi --stop`: Stop durante il primo scatto; nessun
  pezzo incompleto e pezzo precedente conservato.
- `--site=pricing --full --multi --editor`: Full Page ancora funzionante,
  PNG 1920×4847, sei scatti; ultime 128 righe confrontate senza differenze,
  popup e pagina ripristinati.
- `--modal=custom --multi --editor`, `--modal=custom --multi
  --escape-selection`: pagina locale con body non cliccabile e chiusura su
  clic esterno; cattura ed Escape passati, finestra/stili preservati.
- `--modal=dialog --multi --stop-selection`: finestra nativa ancora
  annullabile durante il drag, senza scatti e senza chiuderla.
- `--native-edge --multi --editor`: selezione normale con mouse reale fino
  al bordo destro, PNG 1869×4839 e ripristino passati.
- Suite Stop: 71 passati, 0 falliti, 21 vecchi casi saltati.

**Limite della prova automatica, non un guasto confermato:** `--site=pricing --mobile`
usa viewport stretto 390 px (non un dispositivo mobile). Il sito presenta
qui il login come pannello inferiore. Il primo tentativo falliva perché il
mouse di prova veniva rilasciato fuori viewport; il solo test è stato corretto
limitando le coordinate alla parte visibile. Il secondo disegna e completa la
selezione e arriva alla composizione PNG 387×492, ma fallisce il confronto
esatto dello stile body dopo il ripristino. Popup aperto e campi vuoti;
non è dimostrato se la differenza sia un danno alla pagina o una variazione
innocua del sito. Dopo due tentativi falliti non sono state fatte ulteriori
prove/correzioni su quel percorso: serve una decisione dell'utente per
approfondire. Non modificare il test per ignorare la differenza.

L'utente ha confermato il funzionamento nel proprio utilizzo e la chiusura
del problema. Correzione e prove salvate nel commit `c8bf007`, su richiesta
dell'utente; archivio aggiornato nel successivo commit documentale.
Manifest, ZIP e Store invariati. Nessun nuovo test durante questi salvataggi.

## Area sopra finestre della pagina — 02/10/2026

Segnalazione: nella finestra di creazione Firestore su Firebase non appare il
rettangolo Area e l'icona Stop rimane attiva; Full Page funziona. L'utente ha
autorizzato diagnosi, correzione e prove locali. **Nessun accesso all'account
Firebase, nessuna modifica al database, nessuna prova sulla pagina autenticata.**

Riproduzione precedente alla modifica, con il selettore di produzione e mouse
reale in Edge isolato: un `dialog.showModal()` riceve i clic al posto dell'overlay
aggiunto al body, `box.display` resta `none` e la selezione non si completa.
Questo dimostra il difetto con finestre native, non il tipo di finestra effettivo
usato dall'account Firebase dell'utente.

In `sw.js` il selettore viene inserito nella finestra nativa attiva, quando
presente, e mostrato come popover manuale non modale: supera i livelli della
pagina e gli antenati trasformati senza chiudere o modificare la finestra del
sito. Nessun nuovo motore: Area normale e Area Multi Snip usano lo stesso codice.
Rimozione, Stop e ripristino restano quelli comuni. Il pacchetto 9.12.zip non
viene modificato e non sono stati eseguiti commit/push.

Verifiche passate con `node tools/test-area-sidebar.cjs`:

- `--modal=dialog`, anche `--multi --editor`: trascinamento/rilascio reali,
  PNG 700×1680, finestra ancora aperta, stili e scroll ripristinati.
- `--modal=custom --multi`, `--modal=popover --multi --editor`: finestra con
  livello massimo e finestra nel top layer; selezione e cattura completate.
- `--modal=dialog --multi --stop`: annullamento durante gli scatti; nessun nuovo
  file/pezzo, pezzo precedente conservato.
- `--modal=dialog --multi --stop-selection`: annullamento durante il
  trascinamento; overlay rimosso prima di qualsiasi scatto.
- `--modal=dialog --escape-selection --multi --editor`: tasto Escape reale,
  richiesta di annullamento inoltrata dal ponte di prova; la finestra nativa
  del sito non viene chiusa. Non certifica il collegamento Chrome installato.
- `--modal=dialog --dark`, `--modal=dialog --mobile`: schema colori scuro e
  viewport stretto 390 px; cattura completata. Sono impostazioni del browser
  isolato, non prove su un dispositivo mobile o sul profilo dell'utente.
- Regressioni `--multi --editor` (Area), `--full --multi`,
  `--independent --multi`: menu e ripristino superati; colonne indipendenti
  ancora gestite dal motore dedicato. Nessuna modifica al motore Full Page.
- `node --test tools/test-capture-stop.cjs`: 71 passati, 0 falliti,
  21 vecchi casi saltati; `git diff --check` superato.

Il controllo del PNG locale verifica colori originali, assenza del velo e di
bande vuote, dimensioni selezionate. Una prima aspettativa di identità con
confini ideali falliva: la finestra nativa applicava il contorno di focus e il
compositore preesistente degli scroller interni arrotonda le giunture. Il
contorno è stato tolto solo nella pagina di prova, non nel codice di cattura;
il controllo dei colori non certifica l'allineamento perfetto di ogni giuntura.
I controlli pixel dei menu nelle regressioni restano invariati. Resta necessaria
la prova dell'utente su Firebase dopo ricaricamento dell'estensione e della
pagina. Non dichiarare la segnalazione chiusa senza conferma.

## Linea di fine Full Page: prove autorizzate del 23/09/2026

L'utente ha approvato esplicitamente le prove automatiche su Full Page, Multi Snip, Stop e ripristino. Il codice è ancora locale: le prove qui sotto usano la pagina nel browser isolato e le API Chrome adattate; **non** certificano il clic sull'estensione installata nel profilo dell'utente.

- `node --test tools/test-capture-stop.cjs`: 71 passati, 0 falliti, 21 vecchi casi già saltati. Sette casi nuovi coprono avvio da icona e pulsante vicino alla linea, normale e Multi Snip, Stop con conservazione della linea e dei pezzi precedenti, e rifiuto sicuro degli scroller interni.
- `node tools/test-area-sidebar.cjs --full --growth=static --end-line --end-line-button`: clic reale sul pulsante nel browser, PNG alto 1550 anziché 2200 px, linee/UI escluse dai fotogrammi, ripristino.
- Varianti `--end-line-drag --multi --dark`, `--end-line --multi --editor --mobile --dark`, `--end-line --stop --multi`, `--end-line-anchor`, `--end-line --zoom=110`: trascinamento fino a 1600 px, Multi da pannello e editor, Stop senza file, ancoraggio al contenuto che cresce e zoom 110% superati. Anteprime chiare/scure, desktop/mobile aperte e controllate.
- Regressioni senza linea: `--full`, `--multi` (Area), `--full --multi --editor` superate. Restano i percorsi comuni di cattura; nessun cambiamento al salvataggio Area o Visible.
- Prova aggiuntiva su MDN: `node tools/test-area-sidebar.cjs --full --site=mdn --end-line --end-line-mdn` (anche con `--multi` e `--multi --stop`). Il menu laterale è portato alla voce «position» prima di piazzare la linea; nell'immagine il menu conserva la posizione scelta al taglio, non invade la testata, e pagina e menu tornano come prima. Full Page e Area normali su MDN passano, così come Area sulla pagina locale. La prima prova Area su MDN ha incontrato un cambio d'altezza del sito durante il controllo; ripetuta con pagina stabile, è passata. `node --test tools/test-capture-stop.cjs`: 71 passati, 0 falliti, 21 saltati.
- Prova manuale dell'utente su Wikipedia «Museo del Louvre»: dopo la correzione il pannello «Aspetto» a destra appare nel punto visto quando è stata fissata la linea. La correzione del pannello destro non è stata ricontrollata con prove automatiche: l'utente ha scelto di eseguirle personalmente.

Limite dichiarato: il taglio alla linea vale per pagine con scorrimento del documento, anche con un menu laterale indipendente come MDN. Se scorrono soltanto contenitori interni, il comando non salva un risultato ambiguo; altri tipi di colonne indipendenti non sono ancora stati verificati. Full Page normale e Area restano disponibili. Commit e push conservano il prototipo sul ramo di lavoro: non costituiscono uno ZIP né una pubblicazione nello Store. L'idea resta aperta finché l'utente non decide di includerla.

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
