# AGENTS.md

## Architecture

- **Backend**: Python FastAPI on `127.0.0.1:51234` (`python-backend/main.py`)
- **Frontend**: Electron app (`electron-frontend/main.js`)
- Electron polls backend every 500ms for OCR results via `/api/latest-result`
- IPC bridge: `preload.js` exposes `electronAPI` to renderer

## Key Files

```
python-backend/
  main.py              # FastAPI server, OCR dispatch, shortcut setup
  config_manager.py    # Reads/writes config.json
  history_manager.py   # Reads/writes history.json
  ocr_service.py       # SiliconFlow API calls
  paddleocr_service.py # PaddleOCR async API (submit job → poll → fetch JSONL)
  shortcut_handler.py  # pynput global shortcut + screencapture wrapper

electron-frontend/
  main.js              # Electron main process, IPC handlers, polling loop
  preload.js           # contextBridge API exposure
  icon.png             # App icon for window and tray
  renderer/app.js      # UI logic, page switching, markdown rendering
  renderer/index.html  # Three pages: main, history, settings

assets/
  icon.png             # App icon for README display
```

## Commands

```bash
# Start both (from repo root)
./start.sh

# Start separately
cd python-backend && source ../venv/bin/activate && python main.py
cd electron-frontend && npm start

# Install deps
cd python-backend && pip install -r requirements.txt
cd electron-frontend && npm install
```

## Data Files (gitignored)

- `config.json` — API keys, provider choice, shortcut, preferences
- `history.json` — OCR result history
- `config.example.json` — template committed to repo

## OCR Providers

- **SiliconFlow**: OpenAI-compatible chat completions API, image as base64 in message content
- **PaddleOCR**: Async job API at `https://paddleocr.aistudio-app.com/api/v2/ocr/jobs`, token auth is `bearer {token}` (not `token`), polls until `state=done`, then fetches JSONL result URL

## Conventions

- Python uses `asyncio.new_event_loop()` inside sync shortcut callback (not `asyncio.run`)
- Frontend pages are shown/hidden via `.active` class, not routing
- Markdown rendering uses `marked` + `katex` with custom inline/block LaTeX extensions
- Copy always copies raw markdown text, never rendered HTML
- `config.json` and `history.json` are in `.gitignore` — never commit secrets
- Do NOT push to remote after every change — only push when explicitly asked
