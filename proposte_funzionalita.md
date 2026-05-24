# Proposte di Funzionalità Avanzate - AntiGravity File Organizer

Questo documento racchiude l'analisi tecnica, l'impatto architetturale ed una bozza di implementazione per le **5 chicche enterprise** proposte per evolvere lo script di riorganizzazione file.

---

## 🧪 1. Modalità "Dry-Run" (`--dry-run`)

### Descrizione
Consente all'utente di simulare l'intero processo di scansione, analisi AI e smistamento senza toccare fisicamente alcun file o cartella su disco. 

### Vantaggio Tecnico & Senior Design
* **Sicurezza:** Permette di verificare il comportamento dell'AI (soprattutto le regole di classificazione ed auto-rinominazione delle fatture) senza rischiare spostamenti accidentali o cancellazioni di file utili.
* **Separazione delle Responsabilità (Clean Design):** Creiamo un layer astratto per le operazioni distruttive.

### Bozza di Implementazione
```javascript
const isDryRun = process.argv.includes('--dry-run');

// Funzioni wrapper che intercettano le modifiche fisiche
async function safeRename(source, dest) {
    if (isDryRun) {
        console.log(`\x1b[35m[DRY-RUN - SPOSTAMENTO]\x1b[0m Sposterei: "${path.basename(source)}" ──► "${path.relative(destpath, dest)}"`);
        return;
    }
    return fs.rename(source, dest);
}

async function safeUnlink(source) {
    if (isDryRun) {
        console.log(`\x1b[35m[DRY-RUN - ELIMINAZIONE]\x1b[0m Eliminerei il file duplicato: "${path.basename(source)}"`);
        return;
    }
    return fs.unlink(source);
}
```

---

## 🧬 2. Deduplica Intelligente tramite Hash (SHA-256)

### Descrizione
Identifica e rimuove i duplicati reali basandosi sull'impronta digitale del contenuto (hash SHA-256) anziché limitarsi a confrontare i nomi dei file.

### Vantaggio Tecnico & Senior Design
* **Ottimizzazione dello Spazio:** Impedisce di archiviare più volte lo stesso identico file scaricato con nomi diversi (es. `fattura.pdf`, `fattura(1).pdf`).
* **Integrità dei dati:** Se due file hanno lo stesso nome ma contenuto diverso, vengono entrambi conservati rinominando il secondo. Se hanno lo stesso contenuto, il duplicato sorgente viene eliminato in sicurezza.

### Bozza di Implementazione
```javascript
const crypto = require('crypto');

/**
 * Calcola l'hash SHA-256 di un file in modo asincrono ed efficiente in streaming.
 */
function calculateHash(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fsBasic.createReadStream(filePath);
        stream.on('data', data => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', err => reject(err));
    });
}
```

---

## 🛡️ 3. Filtro di Esclusione Smart (`.organizerignore`)

### Descrizione
Aggiunge il supporto per un file di configurazione `.organizerignore` posizionato nella radice del progetto, per definire file o cartelle che non devono mai essere esaminati o spostati dall'organizer.

### Vantaggio Tecnico & Senior Design
* **Resilienza:** Impedisce di toccare file temporanei di sistema (es. `desktop.ini`, `.DS_Store`), download parziali in corso (es. `.crdownload` di Chrome) o directory sensibili (es. `.git`, `node_modules`).
* **Flessibilità:** L'utente può escludere intere estensioni o pattern specifici.

### Bozza di Implementazione
```javascript
// Caricamento asincrono all'avvio
let ignorePatterns = [];

async function loadIgnoreList() {
    const ignorePath = path.join(__dirname, '.organizerignore');
    if (await exists(ignorePath)) {
        const content = await fs.readFile(ignorePath, 'utf-8');
        ignorePatterns = content.split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'));
    }
}

function shouldIgnore(file) {
    // Esegue una validazione tramite regex o minimatch sui pattern caricati
    return ignorePatterns.some(pattern => {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(file);
    });
}
```

---

## 🖼️ 4. Visione Artificiale per Immagini (Smart Image Classifier)

### Descrizione
Sfrutta modelli multimodali dotati di Visione Artificiale per classificare semanticamente le immagini analizzandone il contenuto reale.

### Vantaggio Tecnico & Senior Design
* **Classificazione Avanzata:** Distingue tra uno "Screenshot di codice", una "Foto di vacanze", una "Scansione di un documento" o un "Meme", smistandoli in sotto-cartelle mirate anziché in una generica cartella "Immagini".
* **Zero Dipendenze Pesanti:** La conversione dell'immagine in base64 avviene tramite codice nativo Node.js leggerissimo, inviando il payload direttamente all'API.

### Bozza di Implementazione
```javascript
/**
 * Converte un file locale in una stringa Base64 leggibile dalle API Vision.
 */
async function fileToBase64(filePath) {
    const buffer = await fs.readFile(filePath);
    return buffer.toString('base64');
}

// Estensione del corpo della chiamata in callAI per inviare messaggi multimodali
// usando ad esempio il modello: 'meta-llama/llama-3.2-11b-vision-instruct:free'
```

---

## 🔔 5. Notifiche Desktop Native in Background

### Descrizione
Invia notifiche visive e sonore di sistema (Windows / macOS / Linux) al completamento delle operazioni per informare l'utente dell'esito del lavoro, soprattutto quando lo script viene eseguito in background o tramite cronjob.

### Vantaggio Tecnico & Senior Design
* **Zero Dipendenze Esterne:** Evita pacchetti complessi come `node-notifier` richiamando direttamente utility native di sistema asincrone (`powershell` su Windows, `osascript` su macOS, `notify-send` su Linux).

### Bozza di Implementazione
```javascript
const { exec } = require('child_process');

function sendNotification(title, message) {
    if (process.platform === 'win32') {
        const psCommand = `[void] [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); $objNotification = New-Object System.Windows.Forms.NotifyIcon; $objNotification.Icon = [System.Drawing.SystemIcons]::Information; $objNotification.BalloonTipIcon = 'Info'; $objNotification.BalloonTipText = '${message}'; $objNotification.BalloonTipTitle = '${title}'; $objNotification.Visible = $True; $objNotification.ShowBalloonTip(5000)`;
        exec(`powershell -Command "${psCommand}"`);
    } else if (process.platform === 'darwin') {
        exec(`osascript -e 'display notification "${message}" with title "${title}"'`);
    }
}
```
