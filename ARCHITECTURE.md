# 🏛️ VOXLEGAL AI — FINAL MASTER SYSTEM ARCHITECTURE

## 1. Master System Architecture Diagram

```mermaid
graph TD
    %% Styling
    classDef client fill:#1e1b4b,stroke:#7c5cfc,stroke-width:2px,color:#fff;
    classDef ingest fill:#172554,stroke:#3b82f6,stroke-width:2px,color:#fff;
    classDef nlp fill:#042f2e,stroke:#14b8a6,stroke-width:2px,color:#fff;
    classDef vector fill:#312e81,stroke:#6366f1,stroke-width:2px,color:#fff;
    classDef rag fill:#451a03,stroke:#f59e0b,stroke-width:2px,color:#fff;
    classDef voice fill:#4c0519,stroke:#f43f5e,stroke-width:2px,color:#fff;

    subgraph CLIENT["1. Frontend Client Layer (React 19 + Vite)"]
        UI["🌐 Web UI Dashboard<br/>(Tabs: Summary, Voice Chat, Clause Explorer)"]:::client
        UploadWidget["📂 Drag & Drop Upload<br/>(PDF, Scanned PDF, Images)"]:::client
        VoiceIn["🎙️ Voice Input (Web Speech STT)<br/>Microphone Wave Recording"]:::voice
        VoiceOut["🔊 Voice Output (SpeechSynthesis TTS)<br/>Auto-Play Audio Response"]:::voice
    end

    subgraph INGESTION["2. Ingestion & Preprocessing Layer"]
        UploadAPI["API Endpoint: /process-document"]:::ingest
        FormatRouter{"File Type?"}:::ingest
        PyPDF["pypdf Digital Text Extractor"]:::ingest
        PDFium["pypdfium2 (200 DPI Page Renderer)"]:::ingest
        OCR["RapidOCR Engine (ONNX Runtime / PP-OCRv4)"]:::ingest
        Cleaner["cleaner.py<br/>• Normalization & Hyphen Fix<br/>• Control Char Stripping"]:::ingest
    end

    subgraph UNDERSTANDING["3. Legal Understanding & Segmentation Layer"]
        Segmenter["segmenter.py<br/>• Heading & Section Detection<br/>• Clause Numbering (e.g. 7.2)<br/>• Page Metadata Tracking"]:::nlp
        LegalBERT["clause_classifier.py<br/>⭐ Fine-Tuned LegalBERT<br/>(100 LEDGAR Clause Types)"]:::nlp
        Summarizer["Executive Summary Engine<br/>• Purpose & Parties<br/>• Conditions & Termination<br/>• Obligations & Penalties"]:::nlp
    end

    subgraph RETRIEVAL["4. Embedding & Vector Database Layer"]
        Embedder["SentenceTransformer<br/>('all-MiniLM-L6-v2' — 384 Dim Vectors)"]:::vector
        FAISS["Local FAISS Vector Index<br/>(IndexFlatIP — Cosine Similarity)"]:::vector
        VectorSearch["Semantic Search Engine<br/>(/search-clauses — Top-K Retrieval)"]:::vector
    end

    subgraph RAG_LAYER["5. RAG & Grounded Answering Layer"]
        AskAPI["API Endpoint: /ask-question"]:::rag
        ContextBuilder["Context Construction<br/>(Structured Legal Clauses + Metadata)"]:::rag
        GroundingGuard["Strict Grounding & Anti-Hallucination Guard"]:::rag
        Gemini["Google Gemini 2.5 Flash<br/>(Temperature: 0.1 for Factual Precision)"]:::rag
        EvidenceGen["Explainability & Citation Engine<br/>(Page #, Clause #, Section, Score)"]:::rag
    end

    %% Ingestion Flow
    UploadWidget -->|File Stream| UploadAPI
    UploadAPI --> FormatRouter
    FormatRouter -->|Digital PDF| PyPDF
    FormatRouter -->|Scanned PDF / Image| PDFium
    PDFium --> OCR
    PyPDF -->|Raw Text| Cleaner
    OCR -->|Extracted Text| Cleaner

    %% Understanding Flow
    Cleaner --> Segmenter
    Segmenter -->|Structured Clauses| LegalBERT
    LegalBERT --> Summarizer
    Summarizer -->|Executive Summary JSON| UI

    %% Indexing Flow
    LegalBERT -->|Clauses with Metadata| Embedder
    Embedder -->|384-d Dense Vectors| FAISS

    %% Question Answering Flow
    VoiceIn -->|Voice Query| UI
    UI -->|Natural Language Question| AskAPI
    AskAPI --> VectorSearch
    VectorSearch -->|Query Embedding| Embedder
    Embedder -->|Search Query Vector| FAISS
    FAISS -->|Top-K Relevant Clauses| ContextBuilder
    ContextBuilder --> GroundingGuard
    GroundingGuard --> Gemini
    Gemini --> EvidenceGen
    EvidenceGen -->|Grounded Answer + Citations| UI
    UI -->|Text to Speak| VoiceOut
```

---

## 2. Component Responsibility Matrix

| Layer | Technology | Primary Function | Research & Practical Value |
|---|---|---|---|
| **Frontend** | React 19, Vite, Vanilla CSS Design System | UI Dashboard, Multi-Tab Views, Voice Interface | User interaction & accessibility |
| **Ingestion** | `pypdf`, `pypdfium2`, `RapidOCR` | Dual-mode digital PDF and scanned image text extraction | Robust ingestion across all document formats |
| **Text Processing** | Custom `cleaner.py` & `segmenter.py` | Normalizes whitespace, fixes line wraps, detects clause structure | Preserves clause-level integrity and page traceability |
| **Legal Domain AI** | `nlpaueb/legal-bert-base-uncased` (LEDGAR) | Classifies clause categories (Termination, Confidentiality, etc.) | **Domain-Specific Adaptation (RQ2)** |
| **Embeddings** | `sentence-transformers/all-MiniLM-L6-v2` | Computes 384-dimensional dense vector embeddings (100% local) | Fast, local, free mathematical vectorization |
| **Vector DB** | `faiss-cpu` (`IndexFlatIP`) | Local in-memory Cosine Similarity index | Efficient semantic similarity matching |
| **RAG & Grounding** | `rag_engine.py` + Gemini 2.5 Flash | Constructs context, verifies factual grounding, generates answers | **Hallucination reduction & Explainability (RQ1, RQ3, RQ4)** |
| **Voice Layer** | Browser `SpeechRecognition` & `SpeechSynthesis` | Voice input STT and auto-speech playback TTS | **Voice-driven legal QA usability (RQ5)** |
