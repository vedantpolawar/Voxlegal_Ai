import os
from typing import List, Dict, Any
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

SYSTEM_GROUNDING_PROMPT = """
You are VoxLegal AI, an expert AI assistant specialized in evidence-grounded legal document analysis.

YOUR MISSION:
Answer the user's question accurately, clearly, and ONLY using the provided legal document context.

RULES:
1. Ground your answer strictly in the provided legal clauses.
2. Explain the legal conditions, rights, obligations, and consequences in simple, understandable terms.
3. ALWAYS cite the exact Page Number(s) and Clause Number(s) where the evidence was found.
4. If the provided context DOES NOT contain sufficient information to answer the question, state exactly:
   "I could not find sufficient information about this in the uploaded document."
5. Do NOT invent legal clauses, numbers, or assumptions not present in the text.
6. Note that this analysis is for informational purposes only and does not constitute formal legal advice.
"""

SUMMARY_PROMPT = """
You are VoxLegal AI, an expert legal document analyst.
Analyze the following clauses from an uploaded legal document and provide a structured Executive Summary.

FORMAT YOUR RESPONSE AS JSON with the following structure:
{
  "document_type": "e.g., Employment Agreement, Non-Disclosure Agreement, Commercial Lease, etc.",
  "executive_summary": "2-3 sentences explaining what this document is about and its main purpose.",
  "parties_involved": ["Party 1 description", "Party 2 description"],
  "key_conditions": [
    "Important condition 1 (with clause/page ref if available)",
    "Important condition 2 (with clause/page ref if available)"
  ],
  "core_obligations": [
    "Key obligation 1",
    "Key obligation 2"
  ],
  "termination_and_penalties": "Summary of termination rules, notice periods, and penalties.",
  "governing_law_and_disputes": "Governing jurisdiction and dispute resolution mechanism.",
  "important_takeaways": [
    "Crucial point 1",
    "Crucial point 2"
  ]
}

Return ONLY valid JSON.
"""

def construct_rag_context(retrieved_clauses: List[Dict[str, Any]]) -> str:
    """Format retrieved legal clauses into structured context for the LLM."""
    if not retrieved_clauses:
        return "No relevant legal clauses retrieved."

    context_parts = []
    for idx, clause in enumerate(retrieved_clauses, start=1):
        context_parts.append(
            f"[CLAUSE {idx}]\n"
            f"Page: {clause.get('page', 'N/A')}\n"
            f"Clause Number: {clause.get('clause', 'N/A')}\n"
            f"Section: {clause.get('section', 'General')}\n"
            f"Text: \"{clause.get('text', '')}\"\n"
        )
    return "\n".join(context_parts)

def generate_grounded_answer(query: str, retrieved_clauses: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    RAG Pipeline with Grounding & Anti-Hallucination:
    1. Passes top retrieved clauses to Gemini LLM with strict grounding prompt.
    2. Returns clear explanation + page/clause citations.
    """
    if not retrieved_clauses:
        return {
            "query": query,
            "answer": "I could not find sufficient information about this in the uploaded document.",
            "is_grounded": False,
            "evidence": []
        }

    context = construct_rag_context(retrieved_clauses)
    api_key = os.getenv("GEMINI_API_KEY")

    answer_text = ""
    is_grounded = True

    if api_key:
        try:
            client = genai.Client(api_key=api_key)
            prompt = f"{SYSTEM_GROUNDING_PROMPT}\n\nLEGAL DOCUMENT CONTEXT:\n{context}\n\nUSER QUESTION: {query}"
            
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=0.1
                )
            )
            answer_text = response.text.strip()
            
            if "could not find sufficient information" in answer_text.lower():
                is_grounded = False
        except Exception as e:
            print(f"[RAG Engine] Gemini API call error: {e}")
            evidence_summaries = [
                f"Page {c.get('page')}, Clause {c.get('clause')} ({c.get('section')}): \"{c.get('text')}\""
                for c in retrieved_clauses[:3]
            ]
            answer_text = "According to the uploaded document:\n\n" + "\n\n".join(evidence_summaries)
    else:
        evidence_summaries = [
            f"Page {c.get('page')}, Clause {c.get('clause')} ({c.get('section')}): \"{c.get('text')}\""
            for c in retrieved_clauses[:3]
        ]
        answer_text = "According to the uploaded document:\n\n" + "\n\n".join(evidence_summaries)

    evidence_list = []
    for c in retrieved_clauses:
        evidence_list.append({
            "clause_id": c.get("clause_id"),
            "page": c.get("page"),
            "clause": c.get("clause"),
            "section": c.get("section"),
            "text": c.get("text"),
            "similarity_score": c.get("similarity_score", 0.0)
        })

    return {
        "query": query,
        "answer": answer_text,
        "is_grounded": is_grounded,
        "evidence": evidence_list
    }

def generate_document_summary(clauses: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Generates an automated Executive Summary of what the document is about,
    key conditions, obligations, termination rules, and important things.
    """
    if not clauses:
        return {
            "document_type": "Unknown",
            "executive_summary": "No readable content found in the document.",
            "parties_involved": [],
            "key_conditions": [],
            "core_obligations": [],
            "termination_and_penalties": "Not specified",
            "governing_law_and_disputes": "Not specified",
            "important_takeaways": []
        }

    # Aggregate text sample from first several clauses
    sample_text = "\n\n".join([f"[{c.get('section', '')} | Clause {c.get('clause', '')}]: {c.get('text', '')}" for c in clauses[:25]])
    api_key = os.getenv("GEMINI_API_KEY")

    if api_key:
        try:
            import json
            client = genai.Client(api_key=api_key)
            prompt = f"{SUMMARY_PROMPT}\n\nDOCUMENT CLAUSES:\n{sample_text[:12000]}"
            
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.1
                )
            )
            parsed = json.loads(response.text)
            return parsed
        except Exception as e:
            print(f"[RAG Engine] Document summary generation error: {e}")

    # Fallback heuristic summary
    sections_found = list(set([c.get("section", "General") for c in clauses if c.get("section") and c.get("section") != "General"]))
    return {
        "document_type": "Legal Agreement / Contract",
        "executive_summary": f"Legal document comprising {len(clauses)} segmented clauses across sections such as {', '.join(sections_found[:5]) if sections_found else 'standard provisions'}.",
        "parties_involved": ["Parties identified in preamble clauses"],
        "key_conditions": [f"Governed by provisions in: {s}" for s in sections_found[:4]],
        "core_obligations": ["Defined within the respective contractual clauses"],
        "termination_and_penalties": "Refer to termination and penalty sections in the clause inspector.",
        "governing_law_and_disputes": "Refer to governing law clauses.",
        "important_takeaways": [
            f"Document contains {len(clauses)} indexed clauses in FAISS.",
            "Ask specific voice or text questions to analyze any clause."
        ]
    }
