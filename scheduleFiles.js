const os = require('os');
const path = require('path');
const fsBasic = require('fs');
const fs = require('fs/promises');

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
const apiKey = process.env.OPENROUTER_API_KEY;

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

const SYSTEM_PROMPT = `Sei un assistente AI specializzato nell'organizzazione intelligente di file e directory.
Il tuo compito è analizzare i metadati e il testo parziale estratto da un file o una directory e restituire un oggetto JSON che definisca la sua classificazione e organizzazione ottimale.

Devi restituire ESCLUSIVAMENTE un oggetto JSON valido con i seguenti campi (non aggiungere codice markdown o testo di contorno prima o dopo il JSON):
{
  "classification": "invoice" | "project" | "standard",
  "destinationSubdir": "nome_sottocartella_consigliata",
  "suggestedName": "nome_file_rinominato_se_fattura_o_null",
  "summary": "riassunto di esattamente 3 righe del documento o progetto",
  "tags": ["tag1", "tag2", "tag3"]
}

Regole di Classificazione ed Organizzazione:
1. "invoice" (Fatture e Ricevute):
   - Se il testo descrive una fattura, ricevuta, scontrino o pagamento, imposta "classification": "invoice".
   - Estrai il fornitore/mittente (Fornitore), l'importo totale (Totale) e la data nel formato YYYY-MM-DD.
   - Crea un nome file standardizzato nel campo "suggestedName" come: "YYYY-MM-DD_Fornitore_Totale" (mantieni l'estensione originale in minuscolo, es. ".pdf"). Rimuovi spazi o caratteri speciali non sicuri dal nome.
   - Esempio: "2026-05-15_Amazon_45.99.pdf".
   - La "destinationSubdir" consigliata deve essere "Fatture" o simile.

2. "project" (Progetti di Sviluppo):
   - Se l'elemento analizzato è una directory di sviluppo software (es. contiene package.json, files .py, index.html, ecc.), imposta "classification": "project".
   - Riconosci la tecnologia prevalente (es. React, Vue, Python, Node, Go, Rust, Java).
   - Imposta la "destinationSubdir" come "Progetti-React", "Script-Python", "Progetti-Rust" o simili.
   - Imposta "suggestedName": null (i progetti mantengono il loro nome originale).

3. "standard" (Altri documenti, media o file gerais):
   - Per tutto il resto, analizza il contenuto semantico ed imposta "classification": "standard".
   - Scegli una "destinationSubdir" adatta al contesto reale, ad esempio "Documenti-Personali", "Lavoro", "Studio", "Media/Immagini", "Design", ecc. (Invece di usare le estensioni, usa l'argomento trattato nel testo!).
   - Imposta "suggestedName": null (mantieni il nome originale).

4. "summary" e "tags":
   - "summary": Genera un abstract chiaro di esattamente 3 righe che riassuma l'argomento del file o del progetto.
   - "tags": Genera da 3 a 5 tag dinamici rilevanti basati sui temi trattati (es. in un log di errore, includi il tipo di eccezione riscontrata).`;

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
    let model = currentModel || process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
    
    // Lista di modelli gratuiti di fallback altamente stabili su OpenRouter
    const FALLBACK_MODELS = [
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
                console.warn(`\x1b[33m[AI FALLBACK]\x1b[0m Il modello "${model}" ha restituito errore di quota (${response.status}). Tento il modello gratuito alternativo "${nextFallback}"...`);
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
        await fs.appendFile(indexPath, block, 'utf-8');
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
        await fs.writeFile(sidecarPath, content, 'utf-8');
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

        if (useAI) {
            // In modalità AI elaboriamo i file in sequenza per evitare di intasare le API gratuite
            // con richieste concorrenti ravvicinate, limitando drasticamente gli errori HTTP 429.
            for (const file of files) {
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
                files.map(async (file) => {
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
 * Gestisce l'elaborazione del singolo file o directory (con AI o ordinamento standard).
 * @param {string} file - Il nome del file o directory.
 * @param {import('fs').Stats} dataFile - Metadati del file.
 */
async function handleFile(file, dataFile) {
    const ext = path.extname(file);
    const basename = path.basename(file, ext);
    const sourcePath = path.join(basepath, file);

    let processedWithAI = false;

    if (useAI) {
        try {
            console.log(`[AI] Analisi semantica in corso per "${file}"...`);
            const previewText = await extractText(sourcePath, dataFile, ext);

            const prompt = `Elemento da analizzare:
- Nome: "${file}"
- Tipo: ${dataFile.isDirectory() ? 'Directory' : 'File'}
- Dimensione: ${dataFile.size} byte

Anteprima contenuto / metadati:
---
${previewText}
---`;

            const aiResponse = await callAI(prompt, SYSTEM_PROMPT);
            const res = JSON.parse(aiResponse);

            // Risoluzione cartella e nome finale consigliati dall'AI
            const targetSubdir = res.destinationSubdir || (ext.startsWith('.') ? ext.slice(1) : 'Documenti');
            const extDir = path.join(destpath, targetSubdir);

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
            await fs.mkdir(extDir, { recursive: true });

            if (!(await exists(finalPath))) {
                await moveFile(sourcePath, finalPath);
            } else {
                if (dataFile.isFile()) {
                    await deleteFile(sourcePath);
                } else {
                    // Gestione asincrona del merge delle directory
                    const dir = await fs.opendir(sourcePath);
                    for await (const entry of dir) {
                        const entrySourcePath = path.join(sourcePath, entry.name);
                        const entryDestPath = path.join(finalPath, entry.name);

                        if (!(await exists(entryDestPath))) {
                            await fs.rename(entrySourcePath, entryDestPath);
                        } else {
                            if (entry.isFile()) {
                                await fs.unlink(entrySourcePath);
                            } else {
                                await fs.rm(entrySourcePath, { recursive: true, force: true });
                            }
                        }
                    }
                    await fs.rmdir(sourcePath);
                }
            }

            // Scrittura catalogo centralizzato e file sidecar dei metadati
            await writeToIndex(file, finalPath, res.classification, res.summary, res.tags);
            await createSidecarMetadata(finalPath, res.summary, res.tags);

            console.log(`\x1b[32m[AI OK]\x1b[0m "${file}" spostato e indicizzato in "${targetSubdir}" come "${finalName}".`);
            processedWithAI = true;
        } catch (err) {
            console.warn(`\x1b[33m[AI WARN]\x1b[0m Errore AI per "${file}" (${err.message}). Fallback a ordinamento standard.`);
        }
    }

    if (!processedWithAI) {
        // Ordinamento standard basato sull'estensione (Fallback)
        switch (ext.toLowerCase()) {
            case '.ini':
                await deleteFile(sourcePath);
                break;

            default: {
                const ctime = dataFile.ctime;
                const day = String(ctime.getDate()).padStart(2, '0');
                const month = String(ctime.getMonth() + 1).padStart(2, '0');
                const year = ctime.getFullYear();
                const timestampStr = `${day}${month}${year}`;

                const extname = ext.startsWith('.') ? ext.slice(1) : ext;
                const extDir = path.join(destpath, extname);

                const cleanBasename = basename.replace(/\s+/g, '');
                const formattedName = path.join(extDir, `${cleanBasename}_${timestampStr}${ext}`);

                await fs.mkdir(extDir, { recursive: true });

                if (!(await exists(formattedName))) {
                    await moveFile(sourcePath, formattedName);
                } else {
                    if (dataFile.isFile()) {
                        await deleteFile(sourcePath);
                    } else {
                        const dir = await fs.opendir(sourcePath);
                        for await (const entry of dir) {
                            const entrySourcePath = path.join(sourcePath, entry.name);
                            const entryDestPath = path.join(formattedName, entry.name);

                            if (!(await exists(entryDestPath))) {
                                await fs.rename(entrySourcePath, entryDestPath);
                            } else {
                                if (entry.isFile()) {
                                    await fs.unlink(entrySourcePath);
                                } else {
                                    await fs.rm(entrySourcePath, { recursive: true, force: true });
                                }
                            }
                        }
                        await fs.rmdir(sourcePath);
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
    return fs.rename(source, dest);
}

/**
 * Elimina un file.
 * @param {string} source - Percorso del file da eliminare.
 */
async function deleteFile(source) {
    return fs.unlink(source);
}

// Avvio del programma misurando accuratamente le performance
(async () => {
    try {
        console.time('Tempo totale di esecuzione');
        await main();
        console.timeEnd('Tempo totale di esecuzione');
    } catch (e) {
        console.error('Errore critico durante l\'esecuzione:', e);
        process.exit(1);
    }
})();
