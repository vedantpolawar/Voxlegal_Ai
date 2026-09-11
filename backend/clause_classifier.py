# ─────────────────────────────────────────────────────────────────────────────
# VoxLegal AI — Clause Classifier
# Loads the fine-tuned LegalBERT model and classifies clause types.
# Used in Phase 7 integration after fine-tuning is complete in Colab.
# ─────────────────────────────────────────────────────────────────────────────

import os
from typing import List, Dict, Any

# Try loading the fine-tuned model; fall back gracefully if not yet available.
_classifier = None
_MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "voxlegal_legalbert_ledgar")

def _load_classifier():
    """Lazy-load the fine-tuned LegalBERT classifier on first use."""
    global _classifier
    if _classifier is not None:
        return _classifier

    model_src = None

    # 1. Check for local downloaded model
    if os.path.isdir(_MODEL_PATH):
        model_src = _MODEL_PATH
        print(f"[Classifier] Loading fine-tuned LegalBERT from: {_MODEL_PATH}")

    # 2. Check for HuggingFace repo env variable
    elif os.getenv("LEGALBERT_HF_REPO"):
        model_src = os.getenv("LEGALBERT_HF_REPO")
        print(f"[Classifier] Loading from HuggingFace: {model_src}")

    if model_src is None:
        print("[Classifier] Fine-tuned model not found. Clause classification disabled.")
        print("             -> Run the Colab notebook first, then place the model in:")
        print(f"              {_MODEL_PATH}")
        return None

    try:
        import torch
        from transformers import pipeline
        device = 0 if torch.cuda.is_available() else -1
        _classifier = pipeline(
            "text-classification",
            model=model_src,
            tokenizer=model_src,
            device=device,
            top_k=3
        )
        print("[Classifier] Fine-tuned LegalBERT clause classifier loaded!")
        return _classifier
    except Exception as e:
        print(f"[Classifier] Failed to load model: {e}")
        return None


def classify_clause(text: str) -> Dict[str, Any]:
    """
    Classify a single legal clause.

    Returns:
        {
            "predicted_type": "Termination",
            "confidence": 0.94,
            "top_3": [{"label": "Termination", "score": 0.94}, ...]
        }
    """
    clf = _load_classifier()
    if clf is None:
        return {"predicted_type": "Unknown", "confidence": 0.0, "top_3": []}

    try:
        # Truncate to 512 chars (model max)
        result = clf(text[:512])[0]
        return {
            "predicted_type": result[0]["label"],
            "confidence": round(result[0]["score"], 4),
            "top_3": [{"label": r["label"], "score": round(r["score"], 4)} for r in result]
        }
    except Exception as e:
        return {"predicted_type": "Unknown", "confidence": 0.0, "top_3": []}


def classify_clauses_batch(clauses: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Classify a batch of legal clause objects.
    Adds 'clause_type', 'clause_type_confidence' fields to each clause.
    """
    clf = _load_classifier()
    if clf is None:
        for c in clauses:
            c["clause_type"] = "Unknown"
            c["clause_type_confidence"] = 0.0
        return clauses

    texts = [c.get("text", "")[:512] for c in clauses]
    try:
        results = clf(texts)
        for clause, result in zip(clauses, results):
            top = result[0]
            clause["clause_type"] = top["label"]
            clause["clause_type_confidence"] = round(top["score"], 4)
    except Exception as e:
        for c in clauses:
            c["clause_type"] = "Unknown"
            c["clause_type_confidence"] = 0.0
    return clauses
