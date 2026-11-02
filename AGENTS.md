# Timbro progetto

PROJECT_ID: `FULL_PAGE_SCREENSHOT_EXTENSION`
PROJECT_ROOT: `C:\Progetti\full-page-screenshot`
AMBITO: estensione Chrome Full Page Screenshot, catture, Multi Snip, editor, manifest e Chrome Web Store.

Prima di agire, confronta richiesta e contesto con questo timbro. Se riguardano chiaramente AI Simulator, Mistral, partite, pronostici o `G:\AI_Simulator_vault`, fermati e avvisa che è aperto il progetto sbagliato. Non cambiare progetto senza conferma esplicita. Non bloccare richieste generiche o ambigue.

## Pacchetti ZIP — decisione definitiva del 02/11/2026

- Nella cartella `full-page-screenshot-extension/` resta soltanto lo ZIP della versione in lavorazione, nominato in modo esplicito: attualmente `9.15 in lavorazione.zip`. Il manifest mantiene il numero valido `9.15`, senza il suffisso.
- `Versioni pubblicate/` contiene soltanto i pacchetti completi pubblicati, un solo ZIP per versione, nominato `9.xx.zip`. Attualmente comprende le versioni presenti dalla 9.8 alla 9.14. Questo è il nome scelto dall'utente al posto di `Versioni precedenti zip/`.
- Questa regola sostituisce la precedente proposta di lasciare fuori gli ultimi tre ZIP: 9.13 e 9.14 sono ora nell'archivio; fuori c'è soltanto 9.15 in lavorazione.
- Non creare o conservare copie intermedie con date o suffissi, né nell'archivio né in altre cartelle di backup non richieste. Aggiornare lo stesso ZIP in lavorazione. Un file temporaneo per confezionare e verificare il nuovo ZIP è ammesso soltanto durante l'operazione: a fine lavoro non deve restare una seconda copia.
- Dopo la pubblicazione confermata, il pacchetto completo diventa una versione pubblicata da conservare nell'archivio; l'avvio della versione successiva resta subordinato alla richiesta dell'utente. Non dedurre la pubblicazione dal solo numero o dall'esistenza dello ZIP.
- Gli ZIP restano locali e ignorati da Git; codice, documentazione e immagini approvate si salvano nel repository. Aggiornamento ZIP, commit/push e pubblicazione sono azioni distinte: eseguire solo quelle autorizzate.

## Catture e Multi Snip — decisione del 20/09/2026

Ogni modifica o correzione alla cattura deve valere anche quando la stessa modalità viene usata per aggiungere un pezzo in Multi Snip. Riutilizzare i motori comuni di Full Page, Area e Visible Only; non creare copie della logica che possano divergere.

Nelle verifiche autorizzate includere anche Multi Snip, sia dal pannello sulla pagina sia dall'editor quando pertinente. Distinguere sempre i percorsi realmente provati da quelli soltanto controllati nel codice. Lo Stop annulla soltanto il pezzo in corso: conserva sessione, pezzi precedenti e cestino, ripristina la pagina e non salva risultati incompleti.

L'icona Stop scelta dall'utente compare durante Full Page e Area, sia normali sia come pezzi Multi Snip. Visible Only mantiene l'icona normale: ricliccarla durante quella cattura non deve fermarla né avviare lavori sovrapposti. Resta disponibile Esc per annullare.

L'ultima richiesta ripristina il piccolo pannellino bianco sulla pagina, in alto a destra: percentuale e barra semplice, senza acqua, anche in Multi Snip. L'utente accetta che venga nascosto durante ogni scatto e quindi possa lampeggiare. Niente percentuale nella linguetta, bollino sull'icona, colonna laterale o finestra separata. L'icona Stop resta libera e ferma con un solo clic; i clic altrove non annullano. Al termine o allo Stop il pannellino viene rimosso e sull'icona torna il conteggio dei pezzi Multi Snip, il badge NEW oppure nessun testo.

Il pulsante rosso «■ STOP» dentro il riquadro è stato rifiutato dall'utente: non va aggiunto. L'annullamento rimane sull'icona dell'estensione e su Esc; il riquadro non intercetta i clic o i tasti usati per la selezione Area.
