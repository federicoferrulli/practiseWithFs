# ⚡ AntiGravity File Organizer

Un organizzatore di file intelligente, sicuro e multimodale scritto in Node.js. Utilizza modelli LLM e di Visione Artificiale per catalogare, ordinare e smistare file e directory in modo semantico.

---

## 🚀 Caratteristiche Enterprise

1. **🧠 Classificazione Semantica AI & Visione Multimodale (`--ai`)**:
   * Rileva e cataloga documenti di testo, cartelle di sviluppo software, installer ed immagini.
   * Utilizza la **Visione Artificiale** (multimodale) per analizzare il contenuto visivo reale di foto, screenshot, meme e documenti scansionati, smistandoli in cartelle specifiche (`Screenshot-Codice`, `Foto-Personali`, `Meme`, `Documenti-Scansionati`).
2. **🧪 Modalità "Dry-Run" (`--dry-run`)**:
   * Simula l'intero processo di scansione, classificazione AI e pianificazione senza toccare o modificare alcun file su disco, stampando a console le azioni con un formato a colori ANSI premium.
3. **🧬 Deduplica Intelligente SHA-256**:
   * Calcola l'hash univoco del contenuto in streaming asincrono efficiente per identificare duplicati reali (anche se rinominati), eliminandoli in sicurezza.
   * Gestisce i conflitti di nome: se due file si chiamano allo stesso modo ma hanno contenuto diverso, li conserva entrambi rinominando il sorgente con un suffisso univoco (`_conf_<timestamp>`).
4. **🛡️ Filtro di Esclusione Smart (`.organizerignore`)**:
   * Supporta un file di esclusione case-insensitive con pattern wildcard (es. `*.tmp`, `node_modules/`, `bozza_*`) posizionato nella tua cartella sorgente. Filtra gli elementi a monte per massimizzare le performance.

---

## 📦 Installazione ed Uso come Comando CLI

Puoi registrare lo script a livello di sistema per eseguirlo direttamente digitando il comando globale `organizer` o `antigravity-organizer` da qualsiasi terminale!

### 1. Registrazione Globale (Link)
Apri il terminale all'interno della cartella di questo progetto ed esegui:
```bash
npm link
```
*Questo comando registrerà i comandi `organizer` e `antigravity-organizer` nel tuo sistema collegandoli direttamente al file di sviluppo.*

### 2. Esecuzione dei Comandi CLI

* **Scansione ed Ordinamento standard (Locale per Estensioni)**:
  ```bash
  organizer
  ```

* **Ordinamento Intelligente con Intelligenza Artificiale**:
  ```bash
  organizer --ai
  ```

* **Simulazione in Sicurezza (Dry-Run)**:
  ```bash
  organizer --ai --dry-run
  ```

### 3. Configurazione
* Rinomina il file `.env.example` in `.env` e inserisci la tua chiave API `OPENROUTER_API_KEY`.
* Copia `.organizerignore.example` nella cartella `Downloads` e rinominalo in `.organizerignore` per definire i tuoi filtri di esclusione.
