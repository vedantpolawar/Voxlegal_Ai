# 🚀 How to Run VoxLegal AI (Complete Guide)

## Prerequisites
* Python 3.10+ (Installed in backend venv)
* Node.js 18+ / npm (For frontend)

---

## 1. Quick Start (Terminal Commands)

Open **two separate terminal windows**:

### Terminal 1: Start FastAPI Backend
```powershell
cd C:\D_drive\voxlegal-ai\backend
.\venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```
* Backend will be live at: `http://127.0.0.1:8000`
* Interactive Swagger API docs: `http://127.0.0.1:8000/docs`

---

### Terminal 2: Start Vite React Frontend
```powershell
cd C:\D_drive\voxlegal-ai\frontend
npm run dev
```
* Web Dashboard will open at: `http://localhost:5173`

---

## 2. Using the Application

1. Open **`http://localhost:5173`** in Google Chrome or Microsoft Edge (for full Web Speech voice support).
2. **Ingest Document**:
   * Drag & drop a PDF (digital or scanned) or an image (`.png`, `.jpg`, `.jpeg`).
   * Click **"🚀 Process & Index Document"**.
3. **Inspect Document Intelligence**:
   * **Tab 1 — Executive Summary**: Read the automatically generated document purpose, key conditions, parties, termination terms, and red flags.
   * **Tab 2 — Voice & Chat Assistant**: Ask questions using voice (click the microphone button) or type questions. The system answers and speaks the response aloud with supporting evidence citations.
   * **Tab 3 — All Clauses**: Explore all segmented clauses stored in the FAISS vector database.
