import re
from typing import List, Dict, Any
from cleaner import clean_raw_text

# Regex patterns for legal section titles and clause numbers
SECTION_HEADER_REGEX = re.compile(
    r'^(?:SECTION|ARTICLE|CHAPTER|PART|TITLE)\s+([0-9IVXLCDM]+[:\.\-]?\s*.*)$|^([A-Z0-9\s\.\-]{3,60})$',
    re.IGNORECASE
)

CLAUSE_NUMBER_REGEX = re.compile(
    r'^(?:CLAUSE|SECTION|PARAGRAPH)?\s*(\d+[\.\d+]*|\([a-z0-9]+\))\s*[\.\:\-]?\s*',
    re.IGNORECASE
)

def segment_legal_document(pages: List[Dict[str, Any]], document_id: str) -> List[Dict[str, Any]]:
    """
    Segments a legal document into structured, clause-level chunks with metadata.
    Preserves page numbers, clause numbers, and section titles for explainability.
    """
    clauses = []
    current_section = "General"
    chunk_counter = 1

    for page_data in pages:
        page_num = page_data.get("page", 1)
        raw_text = page_data.get("text", "")
        source_type = page_data.get("extraction_method", "pypdf")

        cleaned_text = clean_raw_text(raw_text)
        if not cleaned_text:
            continue

        # Split into logical blocks/paragraphs
        blocks = [b.strip() for b in cleaned_text.split("\n\n") if b.strip()]

        for block in blocks:
            lines = [l.strip() for l in block.split("\n") if l.strip()]
            if not lines:
                continue

            first_line = lines[0]

            # 1. Check if first line is a Section/Article Header
            header_match = SECTION_HEADER_REGEX.match(first_line)
            if header_match and len(lines) == 1:
                current_section = first_line
                continue

            # 2. Check if the block starts with a clause number (e.g., "7.2 Termination Notice...")
            clause_num = f"Chunk-{chunk_counter}"
            clause_match = CLAUSE_NUMBER_REGEX.match(first_line)
            if clause_match:
                extracted_num = clause_match.group(1).strip()
                if len(extracted_num) > 0:
                    clause_num = extracted_num

            # 3. Create structured metadata chunk
            clause_obj = {
                "clause_id": f"{document_id}_p{page_num}_c{clause_num.replace('.', '_')}_{chunk_counter}",
                "document_id": document_id,
                "page": page_num,
                "clause": clause_num,
                "section": current_section,
                "text": block,
                "source_type": source_type
            }

            clauses.append(clause_obj)
            chunk_counter += 1

    return clauses
