from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pathlib import Path
import shutil
import numpy as np
from PIL import Image
from pypdf import PdfReader
import pypdfium2 as pdfium
from rapidocr_onnxruntime import RapidOCR

from cleaner import clean_raw_text
from segmenter import segment_legal_document
from retriever import vector_store
from rag_engine import generate_grounded_answer, generate_document_summary
from clause_classifier import classify_clauses_batch

app = FastAPI(title="VoxLegal AI")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

# Initialize RapidOCR Engine
ocr_engine = RapidOCR()

class SearchQuery(BaseModel):
    query: str
    top_k: int = 5

class QuestionRequest(BaseModel):
    question: str
    top_k: int = 5

def extract_text_from_image(image: Image.Image) -> str:
    """Extract text from a PIL Image using RapidOCR."""
    img_np = np.array(image.convert("RGB"))
    result, _ = ocr_engine(img_np)
    if not result:
        return ""
    lines = [line[1] for line in result if line and len(line) > 1]
    return "\n".join(lines)

@app.get("/")
def root():
    return {
        "message": "VoxLegal AI backend is running"
    }

@app.post("/upload")
async def upload_document(file: UploadFile = File(...)):
    file_path = UPLOAD_DIR / file.filename
    with file_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return {
        "message": "Document uploaded successfully",
        "filename": file.filename
    }

@app.post("/extract-text")
async def extract_text(file: UploadFile = File(...)):
    filename = file.filename
    file_extension = Path(filename).suffix.lower()

    file_path = UPLOAD_DIR / filename
    with file_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    pages = []

    # Case 1: Image files (.png, .jpg, .jpeg)
    if file_extension in [".png", ".jpg", ".jpeg"]:
        try:
            image = Image.open(file_path)
            extracted_text = extract_text_from_image(image)
            pages.append({
                "page": 1,
                "text": extracted_text,
                "extraction_method": "ocr"
            })
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to process image: {str(e)}")

    # Case 2: PDF files (.pdf)
    elif file_extension == ".pdf":
        try:
            reader = PdfReader(file_path)
            pdfium_doc = pdfium.PdfDocument(file_path)

            for page_index, page in enumerate(reader.pages):
                page_number = page_index + 1
                text = (page.extract_text() or "").strip()
                method = "pypdf"

                # Fallback to OCR if page has no readable digital text
                if len(text) < 10:
                    pdfium_page = pdfium_doc[page_index]
                    pil_image = pdfium_page.render(scale=200 / 72).to_pil()
                    text = extract_text_from_image(pil_image)
                    method = "ocr"

                pages.append({
                    "page": page_number,
                    "text": text,
                    "extraction_method": method
                })

        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to process PDF: {str(e)}")

    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format '{file_extension}'. Please upload a PDF or Image (.png, .jpg, .jpeg)."
        )

    return {
        "filename": filename,
        "total_pages": len(pages),
        "pages": pages
    }

@app.post("/process-document")
async def process_document(file: UploadFile = File(...)):
    """
    Full Document Ingestion Pipeline:
    1. Extract text (PDF / OCR)
    2. Clean and normalize text
    3. Track pages and sections
    4. Segment into legal clauses with rich metadata
    5. Classify clauses (LegalBERT)
    6. Generate sentence embeddings & index in FAISS vector store
    7. Generate Executive Document Summary & Key Conditions
    """
    raw_extraction = await extract_text(file)
    filename = raw_extraction["filename"]
    pages = raw_extraction["pages"]

    # Generate document_id from filename
    document_id = Path(filename).stem.lower().replace(" ", "_")

    # Segment document into legal clauses with metadata
    clauses = segment_legal_document(pages, document_id)

    # Classify clauses if model is available
    clauses = classify_clauses_batch(clauses)

    # Index clauses in local FAISS vector store
    indexed_count = vector_store.index_document_clauses(clauses)

    # Generate Executive Summary & Key Conditions
    summary = generate_document_summary(clauses)

    return {
        "filename": filename,
        "document_id": document_id,
        "total_pages": len(pages),
        "total_clauses": len(clauses),
        "indexed_clauses": indexed_count,
        "summary": summary,
        "clauses": clauses
    }

@app.post("/search-clauses")
def search_clauses(payload: SearchQuery):
    """
    Semantic Retrieval Endpoint:
    Receives user query, generates query embedding, and searches FAISS
    for top relevant legal clauses.
    """
    if not payload.query.strip():
        raise HTTPException(status_code=400, detail="Search query cannot be empty.")

    results = vector_store.search_similar_clauses(payload.query, top_k=payload.top_k)
    return {
        "query": payload.query,
        "results_count": len(results),
        "retrieved_clauses": results
    }

@app.post("/ask-question")
def ask_question(payload: QuestionRequest):
    """
    RAG Answering & Explainability Endpoint:
    1. Retrieves top relevant clauses from uploaded document via FAISS.
    2. Constructs document context.
    3. Generates document-grounded answer via Gemini (no hallucinations).
    4. Returns answer + page/clause evidence citations.
    """
    if not payload.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    retrieved_clauses = vector_store.search_similar_clauses(payload.question, top_k=payload.top_k)
    result = generate_grounded_answer(payload.question, retrieved_clauses)
    return result

@app.get("/all-clauses")
def get_all_clauses():
    """Retrieve all indexed clauses in current document."""
    return {
        "total_clauses": len(vector_store.clauses_metadata),
        "clauses": vector_store.clauses_metadata
    }