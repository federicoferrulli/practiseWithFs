#!/usr/bin/env node
const os = require('os');
const path = require('path');
const fsBasic = require('fs');
const fs = require('fs/promises');
const crypto = require('crypto');

// Carica le variabili dal file .env se presente (Zero-Dependency)
(() => {
    const envPath = path.join(__dirname, '.env');
    if (fsBasic.existsSync(envPath)) {
        try {
            const envContent = fsBasic.readFileSync(envPath, 'utf8');
            const lines = envContent.split(/\r?\n/);
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;

                const [key, ...valueParts] = trimmed.split('=');
                const value = valueParts.join('=').trim();
                const cleanKey = key.trim();

                // Rimuove eventuali virgolette singole o doppie dal valore
                let cleanValue = value;
                if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                    cleanValue = value.slice(1, -1);
                }

                if (!process.env[cleanKey]) {
                    process.env[cleanKey] = cleanValue;
                }
            }
        } catch (err) {
            console.warn(`\x1b[33m[ENV WARN]\x1b[0m Impossibile caricare il file .env: ${err.message}`);
        }
    }
})();

// Analizzatore degli argomenti da CLI e variabili d'ambiente
const useAI = process.argv.includes('--ai');
const isDryRun = process.argv.includes('--dry-run');
const apiKey = process.env.OPENROUTER_API_KEY;

if (isDryRun) {
    console.log('\n\x1b[35m[DRY-RUN]\x1b[0m Modalità SIMULAZIONE attiva. Nessuna modifica fisica verrà apportata su disco.\n');
}

if (useAI && !apiKey) {
    console.error('\n\x1b[31m[ERRORE AI]\x1b[0m Per utilizzare le funzionalità di Intelligenza Artificiale (--ai),');
    console.error('è necessario impostare la variabile d\'ambiente: \x1b[33mOPENROUTER_API_KEY\x1b[0m');
    console.error('\nEsempio di configurazione in Windows (PowerShell):');
    console.error('  $env:OPENROUTER_API_KEY="la_tua_api_key_qui"\n');
    process.exit(1);
}

// Risoluzione dei percorsi in modo multipiattaforma e indipendente dalla lingua
const homeDir = os.homedir();
const basepath = path.join(homeDir, 'Downloads');

// Gestione dinamica dei Documenti (italiano/inglese e Windows/Unix-like)
let destpath = path.join(homeDir, 'Documents');
if (process.platform === 'win32') {
    const documentsIt = path.join(homeDir, 'Documenti');
    if (fsBasic.existsSync(documentsIt)) {
        destpath = documentsIt;
    }
}


// Dizionario delle estensioni immagine supportate e relativi MIME types per l'analisi Vision
const IMAGE_MIME_TYPES = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp'
};

// Caricamento asincrono all'avvio del filtro di esclusione smart
let ignorePatterns = [];

/**
 * Carica e decodifica la lista dei pattern di esclusione da .organizerignore.
 * Il file viene cercato nella cartella sorgente da scansionare (Downloads).
 */
async function loadIgnoreList() {
    const ignorePath = path.join(basepath, '.organizerignore');
    if (await exists(ignorePath)) {
        try {
            const content = await fs.readFile(ignorePath, 'utf-8');
            ignorePatterns = content.split(/\r?\n/)
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#'));
            console.log(`\x1b[36m[IGNORE]\x1b[0m Caricati ${ignorePatterns.length} pattern di esclusione da .organizerignore.`);
        } catch (err) {
            console.warn(`\x1b[33m[IGNORE WARN]\x1b[0m Impossibile caricare il file .organizerignore: ${err.message}`);
        }
    } else {
        console.log(`\x1b[36m[IGNORE]\x1b[0m Nessun file .organizerignore trovato in "${basepath}". Scansione completa attiva.`);
    }
}

/**
 * Verifica se un file o directory deve essere ignorato basandosi sui pattern caricati da .organizerignore.
 * @param {string} file - Il nome del file o cartella.
 * @returns {boolean} - True se l'elemento deve essere escluso dalla scansione.
 */
function shouldIgnore(file) {
    const fileLower = file.toLowerCase();

    // Filtro di sicurezza predefinito per file di sistema sensibili o temporanei comuni
    const DEFAULT_SYSTEM_IGNORES = [
        'desktop.ini',
        'thumbs.db',
        '.ds_store'
    ];
    if (DEFAULT_SYSTEM_IGNORES.includes(fileLower)) {
        return true;
    }

    return ignorePatterns.some(pattern => {
        let pat = pattern;
        
        // Se il pattern termina con '/', indica una directory, ma supportiamo il matching semplice
        if (pat.endsWith('/')) {
            pat = pat.slice(0, -1);
        }

        // Conversione sicura da wildcard a regex: escape dei caratteri speciali tranne '*' e '?' per evitare RegExp Injection
        const escaped = pat.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        const globbed = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
        const regex = new RegExp('^' + globbed + '$', 'i'); // case-insensitive per Windows

        return regex.test(file);
    });
}

/**
 * Converte un file locale in una stringa Base64 leggibile dalle API Vision.
 * @param {string} filePath - Il percorso completo del file.
 * @returns {Promise<string>} - Contenuto codificato in Base64.
 */
async function fileToBase64(filePath) {
    const buffer = await fs.readFile(filePath);
    return buffer.toString('base64');
}

// Registro in memoria degli hash SHA-256 dei file spostati per rilevare i duplicati in questa sessione
const processedHashes = new Set();

/**
 * Calcola l'hash SHA-256 di un file in modo asincrono ed efficiente in streaming.
 * @param {string} filePath - Il percorso completo del file.
 * @returns {Promise<string>} - L'impronta digitale SHA-256 in formato esadecimale.
 */
function calculateSHA256(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fsBasic.createReadStream(filePath);
        stream.on('data', data => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', err => reject(err));
    });
}

/**
 * Crea una directory ricorsivamente. Se è in dry-run, simula la creazione.
 * @param {string} targetDir - Percorso completo della directory.
 */
async function safeMkdir(targetDir) {
    if (isDryRun) {
        const relDir = path.relative(destpath, targetDir) || targetDir;
        console.log(`\x1b[35m[DRY-RUN - CARTELA]\x1b[0m Creerei la cartella: "${relDir}"`);
        return;
    }
    return fs.mkdir(targetDir, { recursive: true });
}

/**
 * Sposta un file o una directory. Se è in dry-run, simula l'operazione.
 * @param {string} source - Percorso sorgente.
 * @param {string} dest - Percorso destinazione.
 */
async function safeMove(source, dest) {
    if (isDryRun) {
        console.log(`\x1b[35m[DRY-RUN - SPOSTAMENTO]\x1b[0m Sposterei: "${path.basename(source)}" ──► "${path.relative(destpath, dest)}"`);
        return;
    }
    return fs.rename(source, dest);
}

/**
 * Elimina un file. Se è in dry-run, simula l'operazione.
 * @param {string} source - Percorso del file da eliminare.
 * @param {string} reason - Causa dell'eliminazione (es. duplicato).
 */
async function safeDelete(source, reason = 'pulizia') {
    if (isDryRun) {
        console.log(`\x1b[35m[DRY-RUN - ELIMINAZIONE]\x1b[0m Eliminerei il file (${reason}): "${path.basename(source)}"`);
        return;
    }
    return fs.unlink(source);
}

/**
 * Scrive un file sidecar. Se è in dry-run, simula l'operazione.
 * @param {string} filePath - Percorso del file.
 * @param {string} content - Contenuto del file.
 */
async function safeWriteFile(filePath, content) {
    if (isDryRun) {
        console.log(`\x1b[35m[DRY-RUN - METADATI]\x1b[0m Scriverei il file metadati sidecar: "${path.basename(filePath)}"`);
        return;
    }
    return fs.writeFile(filePath, content, 'utf-8');
}

/**
 * Aggiunge righe a un file (es. catalogo centralizzato). Se è in dry-run, simula l'operazione.
 * @param {string} filePath - Percorso del file.
 * @param {string} content - Contenuto da appendere.
 */
async function safeAppendFile(filePath, content) {
    if (isDryRun) {
        console.log(`\x1b[35m[DRY-RUN - INDICE]\x1b[0m Registrerei l'operazione nell'indice centralizzato: "${path.basename(filePath)}"`);
        return;
    }
    return fs.appendFile(filePath, content, 'utf-8');
}

const SYSTEM_PROMPT = `Sei un assistente AI specializzato nell'organizzazione intelligente di file e directory.
Il tuo compito è analizzare i metadati, il testo estratto o le immagini fornite, e restituire un oggetto JSON che definisca la classificazione e organizzazione ottimale dell'elemento.

Devi restituire ESCLUSIVAMENTE un oggetto JSON valido con i seguenti campi (non aggiungere codice markdown o testo di contorno prima o dopo il JSON):
{
  "classification": "invoice" | "project" | "standard",
  "destinationSubdir": "nome_sottocartella_consigliata",
  "suggestedName": "nome_file_rinominato_se_fattura_o_null",
  "summary": "riassunto di esattamente 3 righe del documento, dell'immagine o del progetto",
  "tags": ["tag1", "tag2", "tag3"]
}

Regole di Classificazione ed Organizzazione:
1. "invoice" (Fatture e Ricevute):
   - Se l'elemento analizzato descrive una fattura, ricevuta, scontrino o pagamento, imposta "classification": "invoice".
   - Estrai il fornitore/mittente (Fornitore), l'importo totale (Totale) e la data nel formato YYYY-MM-DD.
   - Crea un nome file standardizzato nel campo "suggestedName" come: "YYYY-MM-DD_Fornitore_Totale" (mantieni l'estensione originale in minuscolo, es. ".pdf"). Rimuovi spazi o caratteri speciali non sicuri dal nome.
   - Esempio: "2026-05-15_Amazon_45.99.pdf".
   - La "destinationSubdir" consigliata deve essere "Fatture" o simile.

2. "project" (Progetti di Sviluppo):
   - Se l'elemento analizzato è una directory di sviluppo software (es. contiene package.json, files .py, index.html, ecc.), imposta "classification": "project".
   - Riconosci la tecnologia prevalente (es. React, Vue, Python, Node, Go, Rust, Java).
   - Imposta la "destinationSubdir" come "Progetti-React", "Script-Python", "Progetti-Rust" o simili.
   - Imposta "suggestedName": null (i progetti mantengono il loro nome originale).

3. "standard" (Altri documenti, media o file generali):
   - Per tutto il resto (incluso le immagini, foto o screenshot), analizza il contenuto semantico ed imposta "classification": "standard".
   - Se l'elemento analizzato è un'immagine, usa la visione artificiale per determinarne la natura e assegnare una "destinationSubdir" specifica ed elegante:
     * Se è uno screenshot di codice sorgente, terminali o sviluppo, usa: "Screenshot-Codice".
     * Se è una foto personale, di paesaggi, viaggi, ritratti o scatti reali, usa: "Foto-Personali".
     * Se è una scansione o una foto di un documento scritto, un modulo o una ricevuta (non propriamente catalogata come invoice), usa: "Documenti-Scansionati".
     * Se è un meme, un'immagine divertente, ironica o di intrattenimento con scritte, usa: "Meme".
     * Per screenshot generici di sistemi operativi o app generiche, usa: "Screenshot-Generici".
     * Per illustrazioni, grafiche o sfondi, usa: "Media/Grafica" o "Media/Sfondi".
   - Per i file che non sono immagini, scegli una "destinationSubdir" adatta al contesto reale basandoti sul tema (es. "Documenti-Lavoro", "Studio", "Finanze", "Media/Video" ecc.) anziché basarti solo sull'estensione.
   - Imposta "suggestedName": null (mantieni il nome originale).

4. "summary" e "tags":
   - "summary": Genera un abstract chiaro di esattamente 3 righe che riassuma l'argomento dell'elemento analizzato (nel caso delle immagini, descrivi accuratamente il contenuto visivo in 3 righe).
   - "tags": Genera da 3 a 5 tag dinamici rilevanti basati sui temi e sul contenuto rilevato.`;

/**
 * Esegue una chiamata API a OpenRouter con tentativi automatici in caso di rate limiting (HTTP 429).
 * @param {string} prompt - Il prompt da inviare al modello.
 * @param {string} systemPrompt - Istruzioni di sistema per il modello.
 * @param {number} retries - Numero massimo di tentativi rimanenti.
 * @param {number} delay - Ritardo iniziale in millisecondi.
 * @returns {Promise<string>} - La risposta testuale dell'AI.
 */
/**
 * Esegue una chiamata API a OpenRouter con tentativi automatici in caso di rate limiting (HTTP 429) o fallimenti di quota (HTTP 402).
 * @param {string} prompt - Il prompt da inviare al modello.
 * @param {string} systemPrompt - Istruzioni di sistema per il modello.
 * @param {number} retries - Numero massimo di tentativi rimanenti.
 * @param {number} delay - Ritardo iniziale in millisecondi.
 * @param {string} currentModel - Il modello corrente da utilizzare.
 * @returns {Promise<string>} - La risposta testuale dell'AI.
 */
async function callAI(prompt, systemPrompt, retries = 3, delay = 2000, currentModel = null) {
    const isMultimodal = Array.isArray(prompt);
    let model = currentModel || process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
    
    // Elenco di modelli noti che supportano la visione per verificare la compatibilità del modello corrente
    const VISION_MODELS = [
        'google/gemini-2.5-flash',
        'meta-llama/llama-3.2-11b-vision-instruct:free',
        'qwen/qwen-2-vl-7b-instruct:free',
        'google/gemini-2.5-pro',
        'openai/gpt-4o-mini',
        'meta-llama/llama-3.2-90b-vision-instruct'
    ];
    
    // Se la richiesta contiene un'immagine (multimodale) ed il modello corrente non supporta la visione,
    // forziamo temporaneamente l'uso del modello multimodale predefinito di Node.js
    if (isMultimodal && !VISION_MODELS.some(v => model.toLowerCase().includes(v.toLowerCase()))) {
        console.log(`\x1b[36m[AI-VISION]\x1b[0m Il modello "${model}" potrebbe non supportare la visione. Forzo il modello multimodale di default: "google/gemini-2.5-flash".`);
        model = 'google/gemini-2.5-flash';
    }

    // Lista di modelli gratuiti di fallback altamente stabili su OpenRouter differenziati in base al tipo di richiesta
    const FALLBACK_MODELS = isMultimodal ? [
        'meta-llama/llama-3.2-11b-vision-instruct:free',
        'qwen/qwen-2-vl-7b-instruct:free',
        'google/gemini-2.5-flash'
    ] : [
        'meta-llama/llama-3-8b-instruct:free',
        'qwen/qwen-2-7b-instruct:free',
        'mistralai/mistral-7b-instruct:free'
    ];

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.1,
                response_format: { type: 'json_object' }
            })
        });

        // Gestione del rate limiting (429) o errori temporanei del server (503/502)
        if (response.status === 429 || response.status === 503 || response.status === 502) {
            if (retries > 0) {
                console.warn(`\x1b[33m[AI RETRY]\x1b[0m Ricevuto stato ${response.status} per il modello ${model}. Nuovo tentativo tra ${(delay / 1000).toFixed(1)}s... (Tentativi rimasti: ${retries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return callAI(prompt, systemPrompt, retries - 1, delay * 2, model);
            }
        }

        // Gestione degli errori di quota esaurita del provider (HTTP 402)
        if (response.status === 402 || response.status === 403) {
            const nextFallback = FALLBACK_MODELS.find(f => f !== model);
            if (nextFallback) {
                console.warn(`\x1b[33m[AI FALLBACK]\x1b[0m Il modello "${model}" ha restituito errore di quota o autorizzazione (${response.status}). Tento il modello alternativo "${nextFallback}"...`);
                return callAI(prompt, systemPrompt, 3, 2000, nextFallback);
            }
        }

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenRouter API error (status ${response.status}): ${errorText}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    } catch (err) {
        if (retries > 0 && (err.message.includes('fetch') || err.message.includes('network') || err.message.includes('timeout'))) {
            console.warn(`\x1b[33m[AI RETRY]\x1b[0m Errore di rete. Nuovo tentativo tra ${(delay / 1000).toFixed(1)}s... (Tentativi rimasti: ${retries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return callAI(prompt, systemPrompt, retries - 1, delay * 2, model);
        }
        
        // Se si verifica un errore di quota generico lanciato da OpenRouter (402) o catturato nell'eccezione
        if (err.message.includes('402') || err.message.includes('quota') || err.message.includes('credits')) {
            const nextFallback = FALLBACK_MODELS.find(f => f !== model);
            if (nextFallback) {
                console.warn(`\x1b[33m[AI FALLBACK]\x1b[0m Errore quota rilevato. Provo modello alternativo "${nextFallback}"...`);
                return callAI(prompt, systemPrompt, 3, 2000, nextFallback);
            }
        }
        throw err;
    }
}

/**
 * Estrae un'anteprima testuale da un file, una directory o un file binario in modo asincrono.
 * @param {string} filePath - Il percorso completo dell'elemento.
 * @param {import('fs').Stats} stats - I metadati dell'elemento.
 * @param {string} ext - L'estensione del file.
 * @returns {Promise<string>} - Testo estratto o sommario degli elementi per le directory.
 */
async function extractText(filePath, stats, ext) {
    try {
        if (stats.isDirectory()) {
            const files = await fs.readdir(filePath);
            let extraInfo = '';
            const keyFiles = ['package.json', 'requirements.txt', 'cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'index.html', 'App.js', 'main.py'];
            for (const keyFile of keyFiles) {
                if (files.map(f => f.toLowerCase()).includes(keyFile.toLowerCase())) {
                    try {
                        const content = await fs.readFile(path.join(filePath, keyFile), 'utf-8');
                        extraInfo += `\n[Contenuto di ${keyFile}]:\n${content.slice(0, 1000)}`;
                    } catch { }
                }
            }
            return `[Directory] Contiene i seguenti file/cartelle: ${files.join(', ')}.${extraInfo}`;
        }

        const textExtensions = ['.txt', '.md', '.json', '.js', '.ts', '.py', '.html', '.css', '.csv', '.xml', '.yaml', '.yml', '.log', '.ini', '.sh', '.bat'];
        if (textExtensions.includes(ext.toLowerCase())) {
            const content = await fs.readFile(filePath, 'utf-8');
            return content.slice(0, 3000); // 3k caratteri sono ideali e leggeri per file di testo
        }

        // Evita di caricare e leggere in memoria file eseguibili o installer (spesso molto pesanti),
        // che produrrebbero solo rumore binario inutile per l'AI.
        const executableExtensions = ['.exe', '.msi', '.dmg', '.pkg', '.apk', '.app', '.deb', '.rpm'];
        if (executableExtensions.includes(ext.toLowerCase())) {
            return `[File Eseguibile / Installer: ${ext}] Questo è un installer o un pacchetto eseguibile di un'applicazione. Non contiene testo leggibile. Esegui la classificazione semantica basandoti esclusivamente sul nome del file e sull'estensione.`;
        }

        // Estrazione euristica e pulita di stringhe ASCII da file binari (PDF, Word, ecc.)
        const buffer = await fs.readFile(filePath);
        let asciiText = '';
        for (let i = 0; i < Math.min(buffer.length, 12000); i++) {
            const charCode = buffer[i];
            // Estrae solo caratteri alfanumerici e punteggiatura comune per evitare rumore binario
            if (
                (charCode >= 48 && charCode <= 57) || // Numeri
                (charCode >= 65 && charCode <= 90) || // Lettere Maiuscole
                (charCode >= 97 && charCode <= 122) || // Lettere Minuscole
                charCode === 32 || charCode === 45 || charCode === 46 || charCode === 44 || charCode === 95 || charCode === 47 // Spazio, -, ., ,, _, /
            ) {
                asciiText += String.fromCharCode(charCode);
            } else {
                asciiText += ' ';
            }
        }

        // Dividiamo in parole e teniamo solo quelle significative (lunghezza >= 3 o numeri coerenti) per eliminare lettere orfane
        const cleanWords = asciiText
            .split(/\s+/)
            .filter(word => word.length >= 3 || (word.length >= 2 && /^[0-9]+$/.test(word)));

        const processedText = cleanWords.join(' ').slice(0, 1500); // 1.5k caratteri sono leggerissimi ed economici (circa 300 token)
        return `[File Binario: ${ext}] Testo ed elementi ASCII significativi estratti:\n${processedText}`;
    } catch (err) {
        return `[Errore Lettura Contenuto]: ${err.message}`;
    }
}

/**
 * Registra in modo thread-safe le informazioni sull'elemento spostato nel catalogo centralizzato.
 * @param {string} originalName - Nome originale del file.
 * @param {string} finalPath - Percorso completo finale.
 * @param {string} classification - Tipo di classificazione.
 * @param {string} summary - Riassunto di 3 righe dell'elemento.
 * @param {string[]} tags - Lista di tag associati.
 */
async function writeToIndex(originalName, finalPath, classification, summary, tags) {
    try {
        const indexPath = path.join(destpath, 'indice_documenti.txt');
        const relativeFinalPath = path.relative(destpath, finalPath);
        const dateStr = new Date().toLocaleString('it-IT');

        const block = `
================================================================================
ELEMENTO CATALOGATO IL: ${dateStr}
--------------------------------------------------------------------------------
Nome Originale:  ${originalName}
Percorso Finale: ${relativeFinalPath}
Categoria:       ${classification.toUpperCase()}
Tag:             ${tags.join(', ')}
--------------------------------------------------------------------------------
Riassunto (Abstract):
${summary}
================================================================================
`;
        await safeAppendFile(indexPath, block, 'utf-8');
    } catch (err) {
        console.error(`[ERRORE INDICE] Impossibile scrivere sull'indice: ${err.message}`);
    }
}

/**
 * Crea un file di metadati sidecar per il file organizzato.
 * @param {string} finalPath - Percorso completo finale del file spostato.
 * @param {string} summary - Riassunto di 3 righe.
 * @param {string[]} tags - Lista di tag.
 */
async function createSidecarMetadata(finalPath, summary, tags) {
    try {
        const ext = path.extname(finalPath);
        const dir = path.dirname(finalPath);
        const base = path.basename(finalPath, ext);

        // Evitiamo di creare file sidecar per i file di metadati stessi o cartelle speciali
        if (base.endsWith('_meta') || base === 'indice_documenti') return;

        const sidecarPath = path.join(dir, `${base}_meta.txt`);

        const content = `METADATI E TAGGING AUTOMATICO
----------------------------
File di riferimento: ${path.basename(finalPath)}
Tag associati:       ${tags.join(', ')}

Riassunto (Abstract):
${summary}
`;
        await safeWriteFile(sidecarPath, content, 'utf-8');
    } catch (err) {
        console.error(`[ERRORE METADATI] Impossibile creare il file sidecar: ${err.message}`);
    }
}

/**
 * Verifica in modo asincrono se un file o directory esiste.
 * @param {string} targetPath - Il percorso da verificare.
 * @returns {Promise<boolean>} - True se esiste, altrimenti False.
 */
async function exists(targetPath) {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Funzione principale asincrona per la scansione ed elaborazione dei file.
 */
async function main() {
    try {
        const files = await fs.readdir(basepath);

        // Filtra i file escludendo quelli ignorati da .organizerignore o file di sistema predefiniti
        const activeFiles = files.filter(file => {
            if (shouldIgnore(file)) {
                console.log(`\x1b[35m[IGNORE MATCH]\x1b[0m Saltato elemento escluso: "${file}"`);
                return false;
            }
            return true;
        });

        if (useAI) {
            // In modalità AI elaboriamo i file in sequenza per evitare di intasare le API gratuite
            // con richieste concorrenti ravvicinate, limitando drasticamente gli errori HTTP 429.
            for (const file of activeFiles) {
                const sourcePath = path.join(basepath, file);
                try {
                    const stats = await fs.stat(sourcePath);
                    await handleFile(file, stats);
                } catch (err) {
                    console.error(`Errore nell'elaborazione del file "${file}":`, err.message);
                }
            }
        } else {
            // In modalità standard (locale I/O) elaboriamo in parallelo per le massime prestazioni
            await Promise.all(
                activeFiles.map(async (file) => {
                    const sourcePath = path.join(basepath, file);
                    try {
                        const stats = await fs.stat(sourcePath);
                        await handleFile(file, stats);
                    } catch (err) {
                        console.error(`Errore nell'elaborazione del file "${file}":`, err.message);
                    }
                })
            );
        }
    } catch (err) {
        console.error(`Errore durante la lettura della directory "${basepath}":`, err.message);
    }
}

/**
 * Pulisce una risposta stringa dell'AI per garantire che contenga solo JSON valido,
 * rimuovendo eventuali tag markdown (come ```json ... ```) restituiti dai modelli.
 * @param {string} rawText - La risposta grezza ricevuta dall'AI.
 * @returns {string} - Testo JSON ripulito pronto per essere parsato.
 */
function cleanJsonResponse(rawText) {
    let cleanText = rawText.trim();
    if (cleanText.startsWith('```')) {
        const matches = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (matches && matches[1]) {
            cleanText = matches[1].trim();
        }
    }
    return cleanText;
}

/**
 * Gestisce l'elaborazione del singolo file o directory (con AI o ordinamento standard).
 * @param {string} file - Il nome del file o directory.
 * @param {import('fs').Stats} dataFile - Metadati del file.
 */
/**
 * Gestisce l'elaborazione del singolo file o directory (con AI o ordinamento standard).
 * @param {string} file - Il nome del file o directory.
 * @param {import('fs').Stats} dataFile - Metadati del file.
 */
async function handleFile(file, dataFile) {
    // Evita di spostare o alterare file di sistema, file nascosti, lo script stesso o file del repository
    const IGNORED_SYSTEM_FILES = [
        'schedulefiles.js', 
        '.env', 
        '.env.example', 
        '.gitignore', 
        '.git', 
        'proposte_funzionalita.md',
        'indice_documenti.txt',
        'task.md',
        'implementation_plan.md',
        'walkthrough.md',
        '.organizerignore'
    ];
    
    if (IGNORED_SYSTEM_FILES.includes(file.toLowerCase()) || file.startsWith('.') || shouldIgnore(file)) {
        return;
    }

    const ext = path.extname(file);
    const basename = path.basename(file, ext);
    const sourcePath = path.join(basepath, file);

    // 1. Calcolo dell'hash SHA-256 ed identificazione duplicati reali di sessione (solo per file)
    let fileHash = null;
    if (dataFile.isFile()) {
        try {
            fileHash = await calculateSHA256(sourcePath);
            if (processedHashes.has(fileHash)) {
                console.log(`\x1b[34m[DEDUPLICA]\x1b[0m Rilevato duplicato reale in sessione: "${file}" (SHA-256: ${fileHash.slice(0, 8)}...). Rimosso in sicurezza.`);
                await safeDelete(sourcePath, 'duplicato reale di sessione');
                return;
            }
            // Aggiunge l'hash al registro di sessione per i prossimi file
            processedHashes.add(fileHash);
        } catch (hashErr) {
            console.warn(`\x1b[33m[HASH WARN]\x1b[0m Impossibile calcolare l'hash per "${file}": ${hashErr.message}`);
        }
    }

    let processedWithAI = false;

    if (useAI) {
        try {
            const isImage = Object.keys(IMAGE_MIME_TYPES).includes(ext.toLowerCase());
            let prompt;

            if (isImage) {
                try {
                    console.log(`[AI-VISION] Caricamento immagine "${file}" in base64 per analisi multimodale...`);
                    const base64Data = await fileToBase64(sourcePath);
                    const mimeType = IMAGE_MIME_TYPES[ext.toLowerCase()];
                    const imageUrl = `data:${mimeType};base64,${base64Data}`;
                    
                    prompt = [
                        {
                            type: 'text',
                            text: `Analizza questa immagine. Elemento da analizzare:
- Nome: "${file}"
- Tipo: File Immagine
- Dimensione: ${dataFile.size} byte`
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: imageUrl
                            }
                        }
                    ];
                } catch (readErr) {
                    console.warn(`\x1b[33m[AI-VISION WARN]\x1b[0m Impossibile convertire l'immagine in Base64: ${readErr.message}. Fallback ad analisi testuale.`);
                    const previewText = await extractText(sourcePath, dataFile, ext);
                    prompt = `Elemento da analizzare:
- Nome: "${file}"
- Tipo: File Immagine (Fallback testuale)
- Dimensione: ${dataFile.size} byte

Anteprima contenuto:
---
${previewText}
---`;
                }
            } else {
                console.log(`[AI] Analisi semantica in corso per "${file}"...`);
                const previewText = await extractText(sourcePath, dataFile, ext);
                
                prompt = `Elemento da analizzare:
- Nome: "${file}"
- Tipo: ${dataFile.isDirectory() ? 'Directory' : 'File'}
- Dimensione: ${dataFile.size} byte

Anteprima contenuto / metadati:
---
${previewText}
---`;
            }
            
            const aiResponse = await callAI(prompt, SYSTEM_PROMPT);
            const cleanedResponse = cleanJsonResponse(aiResponse);
            const res = JSON.parse(cleanedResponse);
            
            // Risoluzione cartella e nome finale consigliati dall'AI
            const targetSubdir = res.destinationSubdir || (ext.startsWith('.') ? ext.slice(1) : 'Documenti');
            const extDir = path.join(destpath, targetSubdir);
            
            // Sicurezza: Prevenzione del Path Traversal
            const resolvedDestPath = path.resolve(extDir);
            const resolvedRootPath = path.resolve(destpath);
            if (!resolvedDestPath.startsWith(resolvedRootPath)) {
                throw new Error(`Rilevato tentativo di Path Traversal nel percorso suggerito dall'AI: "${targetSubdir}"`);
            }
            
            let finalName = file;
            if (res.classification === 'invoice' && res.suggestedName) {
                let sug = res.suggestedName;
                if (!sug.toLowerCase().endsWith(ext.toLowerCase())) {
                    sug += ext;
                }
                finalName = sug;
            } else {
                finalName = file.replace(/\s+/g, '');
            }
            
            const finalPath = path.join(extDir, finalName);
            await safeMkdir(extDir);

            // Gestione dei conflitti di nome a destinazione
            if (!(await exists(finalPath))) {
                await safeMove(sourcePath, finalPath);
                await writeToIndex(file, finalPath, res.classification, res.summary, res.tags);
                await createSidecarMetadata(finalPath, res.summary, res.tags);
                console.log(`\x1b[32m[AI OK]\x1b[0m "${file}" spostato e indicizzato in "${targetSubdir}" come "${finalName}".`);
            } else {
                if (dataFile.isFile()) {
                    let destHash = null;
                    try {
                        destHash = await calculateSHA256(finalPath);
                    } catch {}

                    if (destHash === fileHash) {
                        console.log(`\x1b[34m[DEDUPLICA]\x1b[0m Il file "${file}" è già archiviato in destinazione. Rimuovo il duplicato sorgente.`);
                        await safeDelete(sourcePath, 'gia archiviato a destinazione');
                    } else {
                        // Conflitto di nome ma contenuto diverso -> Rinomina univoca
                        const timestamp = Date.now();
                        const baseNameNoExt = path.basename(finalName, ext);
                        const uniqueName = `${baseNameNoExt}_conf_${timestamp}${ext}`;
                        const uniquePath = path.join(extDir, uniqueName);
                        console.log(`\x1b[33m[CONFLITTO]\x1b[0m Rilevato stesso nome ma contenuto diverso per "${finalName}". Rinominato in "${uniqueName}"`);
                        await safeMove(sourcePath, uniquePath);
                        await writeToIndex(file, uniquePath, res.classification, res.summary, res.tags);
                        await createSidecarMetadata(uniquePath, res.summary, res.tags);
                    }
                } else {
                    // Gestione asincrona del merge delle directory con cattura errori
                    const dir = await fs.opendir(sourcePath);
                    try {
                        for await (const entry of dir) {
                            const entrySourcePath = path.join(sourcePath, entry.name);
                            const entryDestPath = path.join(finalPath, entry.name);

                            if (!(await exists(entryDestPath))) {
                                await safeMove(entrySourcePath, entryDestPath);
                            } else {
                                if (entry.isFile()) {
                                    let entrySourceHash = null;
                                    let entryDestHash = null;
                                    try {
                                        entrySourceHash = await calculateSHA256(entrySourcePath);
                                        entryDestHash = await calculateSHA256(entryDestPath);
                                    } catch {}

                                    if (entrySourceHash === entryDestHash) {
                                        await safeDelete(entrySourcePath, 'duplicato in merge');
                                    } else {
                                        // Rinomina per conflitto di nome nella directory
                                        const entryExt = path.extname(entry.name);
                                        const entryBase = path.basename(entry.name, entryExt);
                                        const entryUniqueName = `${entryBase}_conf_${Date.now()}${entryExt}`;
                                        await safeMove(entrySourcePath, path.join(finalPath, entryUniqueName));
                                    }
                                } else {
                                    if (isDryRun) {
                                        console.log(`\x1b[35m[DRY-RUN - MERGE]\x1b[0m Rimuoverei cartella duplicata interna: "${entry.name}"`);
                                    } else {
                                        await fs.rm(entrySourcePath, { recursive: true, force: true });
                                    }
                                }
                            }
                        }
                        if (isDryRun) {
                            console.log(`\x1b[35m[DRY-RUN - MERGE]\x1b[0m Rimuoverei la cartella sorgente vuota: "${file}"`);
                        } else {
                            await fs.rmdir(sourcePath);
                        }
                    } catch (mergeErr) {
                        console.warn(`\x1b[33m[WARN MERGE]\x1b[0m Errore durante il merge della cartella "${file}": ${mergeErr.message}`);
                    }
                }
            }
            processedWithAI = true;
        } catch (err) {
            console.warn(`\x1b[33m[AI WARN]\x1b[0m Errore AI per "${file}" (${err.message}). Fallback a ordinamento standard.`);
        }
    }

    if (!processedWithAI) {
        // Ordinamento standard basato sull'estensione (Fallback o default)
        switch (ext.toLowerCase()) {
            case '.ini':
                await safeDelete(sourcePath, 'file di sistema .ini inutile');
                break;
                
            default: {
                const ctime = dataFile.ctime;
                const day = String(ctime.getDate()).padStart(2, '0');
                const month = String(ctime.getMonth() + 1).padStart(2, '0');
                const year = ctime.getFullYear();
                const timestampStr = `${day}${month}${year}`;

                const extname = ext.startsWith('.') ? ext.slice(1) : ext;
                const extDir = path.join(destpath, extname);
                
                // Sicurezza: Prevenzione del Path Traversal
                const resolvedDestPath = path.resolve(extDir);
                const resolvedRootPath = path.resolve(destpath);
                if (!resolvedDestPath.startsWith(resolvedRootPath)) {
                    console.error(`\x1b[31m[ERRORE PERCORSO]\x1b[0m Tentativo di Path Traversal bloccato sull'estensione: "${extname}"`);
                    break;
                }

                const cleanBasename = basename.replace(/\s+/g, '');
                const formattedName = path.join(extDir, `${cleanBasename}_${timestampStr}${ext}`);

                await safeMkdir(extDir);

                if (!(await exists(formattedName))) {
                    await safeMove(sourcePath, formattedName);
                    console.log(`\x1b[32m[STANDARD OK]\x1b[0m "${file}" spostato in "${extname}" come "${path.basename(formattedName)}".`);
                } else {
                    if (dataFile.isFile()) {
                        let destHash = null;
                        try {
                            destHash = await calculateSHA256(formattedName);
                        } catch {}

                        if (destHash === fileHash) {
                            console.log(`\x1b[34m[DEDUPLICA]\x1b[0m Il file "${file}" è già archiviato in destinazione. Rimuovo il duplicato sorgente.`);
                            await safeDelete(sourcePath, 'gia archiviato standard');
                        } else {
                            // Conflitto di nome con contenuto diverso -> Rinomina
                            const uniqueName = `${cleanBasename}_${timestampStr}_conf_${Date.now()}${ext}`;
                            const uniquePath = path.join(extDir, uniqueName);
                            console.log(`\x1b[33m[CONFLITTO]\x1b[0m Rilevato stesso nome ma contenuto diverso per "${path.basename(formattedName)}". Rinominato in "${uniqueName}"`);
                            await safeMove(sourcePath, uniquePath);
                        }
                    } else {
                        const dir = await fs.opendir(sourcePath);
                        try {
                            for await (const entry of dir) {
                                const entrySourcePath = path.join(sourcePath, entry.name);
                                const entryDestPath = path.join(formattedName, entry.name);

                                if (!(await exists(entryDestPath))) {
                                    await safeMove(entrySourcePath, entryDestPath);
                                } else {
                                    if (entry.isFile()) {
                                        let entrySourceHash = null;
                                        let entryDestHash = null;
                                        try {
                                            entrySourceHash = await calculateSHA256(entrySourcePath);
                                            entryDestHash = await calculateSHA256(entryDestPath);
                                        } catch {}

                                        if (entrySourceHash === entryDestHash) {
                                            await safeDelete(entrySourcePath, 'duplicato in merge standard');
                                        } else {
                                            const entryExt = path.extname(entry.name);
                                            const entryBase = path.basename(entry.name, entryExt);
                                            const entryUniqueName = `${entryBase}_conf_${Date.now()}${entryExt}`;
                                            await safeMove(entrySourcePath, path.join(formattedName, entryUniqueName));
                                        }
                                    } else {
                                        if (isDryRun) {
                                            console.log(`\x1b[35m[DRY-RUN - MERGE]\x1b[0m Rimuoverei cartella duplicata interna standard: "${entry.name}"`);
                                        } else {
                                            await fs.rm(entrySourcePath, { recursive: true, force: true });
                                        }
                                    }
                                }
                            }
                            if (isDryRun) {
                                console.log(`\x1b[35m[DRY-RUN - MERGE]\x1b[0m Rimuoverei la cartella sorgente vuota standard: "${file}"`);
                            } else {
                                await fs.rmdir(sourcePath);
                            }
                        } catch (mergeErr) {
                            console.warn(`\x1b[33m[WARN MERGE]\x1b[0m Errore durante il merge standard della cartella "${file}": ${mergeErr.message}`);
                        }
                    }
                }
                break;
            }
        }
    }
}

/**
 * Sposta un file o una directory.
 * @param {string} source - Percorso sorgente.
 * @param {string} dest - Percorso destinazione.
 */
async function moveFile(source, dest) {
    return safeMove(source, dest);
}

/**
 * Elimina un file.
 * @param {string} source - Percorso del file da eliminare.
 */
async function deleteFile(source) {
    return safeDelete(source);
}

// Avvio del programma misurando accuratamente le performance
(async () => {
    try {
        console.time('Tempo totale di esecuzione');
        await loadIgnoreList(); // Caricamento asincrono del file .organizerignore all'avvio
        await main();
        console.timeEnd('Tempo totale di esecuzione');
    } catch (e) {
        console.error('Errore critico durante l\'esecuzione:', e);
        process.exit(1);
    }
})();
