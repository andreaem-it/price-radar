# PriceRadar

Piattaforma self-hosted per monitoraggio prezzi ecommerce. Architettura orientata a resilienza, throughput e costi minimi. L'AI locale (Ollama) è usata **solo** per matching prodotti, anomaly detection e riparazione selettori — mai per scraping diretto.

> **Guida implementazione passo-passo:** vedi [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)

## Stack

| Componente | Tecnologia |
|---|---|
| Runtime | Node.js 20+, TypeScript |
| Monorepo | pnpm workspaces |
| API | Fastify |
| Code | BullMQ + Redis |
| Scraping | Playwright (browser per job) |
| Database | SQLite + Drizzle ORM |
| AI fallback | Ollama (HTTP diretto) |
| MCP | @modelcontextprotocol/sdk (stdio) |

## Struttura monorepo

```
apps/
  api-service/        REST API + health checks
  scheduler-service/  Pianificazione job di scraping
  scraper-worker/     Worker BullMQ + Playwright
  ai-worker/          Worker AI (matching, anomaly, selector repair)
  mcp-service/        MCP server con tools esposti

packages/
  types/              Tipi condivisi
  shared/             Config, logger, Redis, code
  db/                 Schema Drizzle + client SQLite
  scraper-core/       Registry plugin scraper + runner
  ai-core/            Client Ollama + logica AI
```

### Flusso dati

```
scheduler-service → Redis (BullMQ) → scraper-worker → SQLite
                                              ↓
                                    ai-worker (solo se necessario)
```

## Prerequisiti (Ubuntu 24.04 / Proxmox VM)

```bash
# Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# pnpm
corepack enable
corepack prepare pnpm@latest --activate

# Redis
sudo apt-get install -y redis-server
sudo systemctl enable --now redis-server

# Ollama
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.2

# Dipendenze Playwright (Chromium)
sudo npx playwright install-deps chromium
```

## Installazione

```bash
git clone <repo-url> price-radar
cd price-radar

cp env.example .env

pnpm install

# Build packages
pnpm build

# Install browser Playwright
pnpm exec playwright install chromium
```

## Database

Le migrazioni vengono applicate automaticamente all'avvio dei servizi.

```bash
# Manuale (opzionale)
pnpm db:migrate
pnpm db:studio
```

## Avvio servizi

Apri terminali separati (o usa un process manager come systemd):

```bash
# 1. API REST
pnpm dev:api
# → http://localhost:3000

# 2. Scheduler
pnpm dev:scheduler

# 3. Scraper worker
pnpm dev:scraper

# 4. AI worker
pnpm dev:ai

# 5. MCP server (stdio, per Cursor/Claude Desktop)
pnpm dev:mcp
```

Avvio parallelo di tutti i servizi in dev:

```bash
pnpm dev
```

## API principali

| Metodo | Endpoint | Descrizione |
|---|---|---|
| GET | `/health` | Stato servizi (DB, Redis) |
| GET | `/api/retailers` | Retailer abilitati |
| GET | `/api/products` | Lista prodotti tracciati |
| POST | `/api/products` | Aggiunge prodotto + enqueue scrape |
| GET | `/api/products/:id` | Dettaglio prodotto + storico prezzi |
| GET | `/api/products/:id/price` | Ultimo prezzo |
| GET | `/api/jobs` | Job di scraping |

### Esempio: aggiungere un prodotto

```bash
curl -X POST http://localhost:3000/api/products \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Apple iPhone 15 128GB",
    "url": "https://www.amazon.it/dp/B0CHX1WGLX",
    "retailerSlug": "amazon",
    "externalId": "B0CHX1WGLX"
  }'
```

## Scraper plugin

Ogni retailer è un plugin in `packages/scraper-core/src/scrapers/`:

```
scrapers/
  amazon/
  unieuro/
  mediaworld/
```

Ogni plugin implementa:

- `search()` — ricerca prodotti
- `extract()` — estrazione da URL prodotto
- `normalize()` — normalizzazione dati
- `validate()` — validazione output

**Regole scraping:**

- Un browser/context Playwright **per job** (mai condiviso globalmente)
- Chiusura garantita in `finally`
- Screenshot + HTML salvati su failure in `data/screenshots` e `data/html-failures`
- Retry con backoff esponenziale via BullMQ
- Rilevamento anti-bot con log strutturato

## MCP tools

Il servizio `mcp-service` espone via stdio:

| Tool | Funzione |
|---|---|
| `getProductPrice` | Ultimo prezzo da DB |
| `matchProducts` | Matching prodotti (AI + euristica) |
| `detectAnomaly` | Rilevamento anomalie prezzo |
| `repairSelector` | Suggerimento selettore CSS |

Configurazione Cursor (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "price-radar": {
      "command": "pnpm",
      "args": ["--filter", "@price-radar/mcp-service", "dev"],
      "cwd": "/path/to/price-radar"
    }
  }
}
```

## Script utili

```bash
pnpm build          # Build di tutti i package
pnpm typecheck      # Typecheck globale
pnpm lint           # ESLint
pnpm format         # Prettier
pnpm dev            # Dev parallelo
```

## Modello dati

| Tabella | Scopo |
|---|---|
| `retailers` | Ecommerce configurati |
| `products` | Prodotti tracciati |
| `product_prices` | Storico prezzi |
| `scrape_jobs` | Job di scraping |
| `price_anomalies` | Anomalie rilevate |

## Logging

Logger JSON strutturato su stdout. I failure di scraping vengono persistiti in:

- `data/logs/scrape-failures.jsonl`
- `data/screenshots/` — screenshot errori
- `data/html-failures/` — HTML pagine fallite

## Produzione su Proxmox

Architettura consigliata: **2 VM**.

| VM | Servizi |
|----|---------|
| `priceradar-control` | API, scheduler, AI worker, MCP, Redis, SQLite, Ollama |
| `priceradar-scraper` | scraper-worker + Playwright |

Dettagli completi: [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)

File env dedicati: `env.vm1.example`, `env.vm2.example`

Setup singola VM (`env.example`) valido solo per **sviluppo locale**.

## Licenza

Proprietario — uso interno.
