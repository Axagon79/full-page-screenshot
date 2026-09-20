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

Il bug della recensione sulle colonne laterali tagliate o ripetute rimane aperto. Le modifiche preliminari già presenti per gli elementi sticky alti sono conservate, non dichiarate una correzione verificata.
