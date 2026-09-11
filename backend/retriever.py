import os
import faiss
import numpy as np
from typing import List, Dict, Any
from sentence_transformers import SentenceTransformer

# Load Sentence Transformer embedding model
# all-MiniLM-L6-v2 outputs 384-dimensional dense vectors
EMBEDDING_MODEL_NAME = "all-MiniLM-L6-v2"
embedding_model = SentenceTransformer(EMBEDDING_MODEL_NAME)
VECTOR_DIMENSION = 384

class LegalVectorStore:
    def __init__(self):
        # IndexFlatIP (Inner Product) with L2 normalized vectors = Cosine Similarity
        self.index = faiss.IndexFlatIP(VECTOR_DIMENSION)
        self.clauses_metadata: List[Dict[str, Any]] = []

    def _normalize_vectors(self, vectors: np.ndarray) -> np.ndarray:
        """L2-normalize vectors for Cosine Similarity."""
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return vectors / norms

    def index_document_clauses(self, clauses: List[Dict[str, Any]]) -> int:
        """
        Generates embeddings for each legal clause and indexes them in FAISS.
        """
        if not clauses:
            return 0

        # Reset index and metadata for active document
        self.index = faiss.IndexFlatIP(VECTOR_DIMENSION)
        self.clauses_metadata = clauses

        # Extract text strings for embedding
        texts = [clause["text"] for clause in clauses]

        # Generate embeddings
        embeddings = embedding_model.encode(texts, convert_to_numpy=True)
        normalized_embeddings = self._normalize_vectors(embeddings.astype("float32"))

        # Add to FAISS index
        self.index.add(normalized_embeddings)
        return self.index.ntotal

    def search_similar_clauses(self, query: str, top_k: int = 3) -> List[Dict[str, Any]]:
        """
        Converts query to vector and retrieves top-k relevant legal clauses with scores.
        """
        if self.index.ntotal == 0:
            return []

        # Encode query
        query_embedding = embedding_model.encode([query], convert_to_numpy=True)
        normalized_query = self._normalize_vectors(query_embedding.astype("float32"))

        # Perform FAISS search
        scores, indices = self.index.search(normalized_query, k=min(top_k, self.index.ntotal))

        results = []
        for score, idx in zip(scores[0], indices[0]):
            if idx >= 0 and idx < len(self.clauses_metadata):
                clause_data = dict(self.clauses_metadata[idx])
                clause_data["similarity_score"] = float(score)
                results.append(clause_data)

        return results

# Global Vector Store Instance for backend session
vector_store = LegalVectorStore()
