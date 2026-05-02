# Business Architect AI
### Value Chain & Capability Mapper — FastAPI + React + Ollama (llama3.2)

A full-stack, **100% local** consulting-grade tool. Python FastAPI handles all AI logic and file parsing; React renders the results.

```
Browser (React :3000)  →  FastAPI (Python :8000)  →  Ollama (llama3.2 :11434)
```

---

## 🚀 Quick Start (3 terminals)

### Terminal 1 — Ollama
```bash
ollama pull llama3.2        # one-time ~2GB download
ollama serve                # keep running on :11434
```

### Terminal 2 — Python Backend
```bash
cd business-architect

# Create virtual environment
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# Install dependencies
pip install -r backend/requirements.txt

# Start FastAPI
uvicorn backend.main:app --reload --port 8000
```

Backend runs at http://localhost:8000
Swagger docs at http://localhost:8000/docs

### Terminal 3 — React Frontend
```bash
cd business-architect
npm install
npm run dev
# → Open http://localhost:3000
```

---

## 🧪 Run Tests

**Python backend tests:**
```bash
cd business-architect
source venv/bin/activate
pytest backend/tests/ -v
```

**Frontend JS tests:**
```bash
npm test
```

---

## 📁 Project Structure

```
business-architect/
│
├── backend/                     ← Python FastAPI
│   ├── main.py                  ← App entry point
│   ├── config.py                ← Settings (env vars)
│   ├── requirements.txt
│   ├── .env.example
│   ├── models/
│   │   └── schemas.py           ← Pydantic request/response models
│   ├── routers/
│   │   └── api.py               ← GET /api/health, POST /api/generate
│   ├── services/
│   │   ├── ollama_service.py    ← Prompt builder + Ollama API call + JSON extraction
│   │   └── file_service.py      ← PDF/PPTX/DOCX/CSV/JSON text extraction
│   └── tests/
│       └── test_backend.py      ← pytest test suite
│
├── src/                         ← React Frontend
│   ├── main.jsx
│   ├── App.jsx                  ← Full UI (form, status, results, exports)
│   ├── aiEngine.js              ← Calls FastAPI backend (not Ollama directly)
│   ├── exportUtils.js           ← JSON/Markdown/CSV download
│   ├── fileReader.js            ← File size util (extraction done server-side)
│   └── styles.css
│
├── sample-files/                ← Test inputs
│   ├── hdfc-bank-profile.txt
│   ├── zomato-profile.json
│   └── infosys-profile.csv
│
├── tests/
│   └── run-tests.mjs            ← Frontend JS tests (32 tests)
│
├── index.html
├── vite.config.js               ← Proxies /api → :8000
└── package.json
```

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Service info |
| GET | `/api/health` | Ollama status + available models |
| GET | `/api/models` | List local Ollama models |
| POST | `/api/generate` | Generate from JSON body |
| POST | `/api/generate/upload` | Generate with file upload (multipart) |

Full interactive docs: **http://localhost:8000/docs**

---

## ⚙️ Configuration

```bash
cp backend/.env.example backend/.env
```

```env
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
OLLAMA_TEMPERATURE=0.2
OLLAMA_NUM_PREDICT=4096
CORS_ORIGINS=["http://localhost:3000"]
```

---

## ⚠️ Troubleshooting

| Error | Fix |
|-------|-----|
| `Cannot reach Ollama` | Run `ollama serve` in a terminal |
| `Model not found` | Run `ollama pull llama3.2` |
| `Cannot reach backend` | Run `uvicorn backend.main:app --reload --port 8000` |
| Slow (~60s) | Use `OLLAMA_MODEL=llama3.2:1b` in `.env` |
| Port conflict | Change port in `uvicorn` command + `vite.config.js` proxy |

