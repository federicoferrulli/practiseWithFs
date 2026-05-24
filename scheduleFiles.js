const os = require('os');
const path = require('path');
const fsBasic = require('fs');
const fs = require('fs/promises');

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
        
        // Elaborazione in parallelo altamente performante di tutti i file presenti nella cartella
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
    } catch (err) {
        console.error(`Errore durante la lettura della directory "${basepath}":`, err.message);
    }
}

/**
 * Gestisce l'elaborazione del singolo file o directory.
 * @param {string} file - Il nome del file o directory.
 * @param {import('fs').Stats} dataFile - Metadati del file.
 */
async function handleFile(file, dataFile) {
    const ext = path.extname(file);
    const basename = path.basename(file, ext);
    const sourcePath = path.join(basepath, file);

    switch (ext.toLowerCase()) {
        case '.ini':
            await deleteFile(sourcePath);
            break;
            
        default: {
            // Formattazione della data pulita e robusta (DDMMYYYY)
            const ctime = dataFile.ctime;
            const day = String(ctime.getDate()).padStart(2, '0');
            const month = String(ctime.getMonth() + 1).padStart(2, '0');
            const year = ctime.getFullYear();
            const timestampStr = `${day}${month}${year}`;

            // Rimozione del punto dall'estensione ed elaborazione della directory di destinazione
            const extname = ext.startsWith('.') ? ext.slice(1) : ext;
            const extDir = path.join(destpath, extname);
            
            // Rimozione degli spazi dal nome del file per consistenza
            const cleanBasename = basename.replace(/\s+/g, '');
            const formattedName = path.join(extDir, `${cleanBasename}_${timestampStr}${ext}`);

            // Assicura la presenza della cartella di destinazione (idempotente ed asincrono)
            await fs.mkdir(extDir, { recursive: true });

            if (!(await exists(formattedName))) {
                await moveFile(sourcePath, formattedName);
            } else {
                if (dataFile.isFile()) {
                    await deleteFile(sourcePath);
                } else {
                    // Gestione asincrona del merge delle directory
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
                    
                    // Rimuove la cartella sorgente ormai vuota
                    await fs.rmdir(sourcePath);
                }
            }
            break;
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
