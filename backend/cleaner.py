import re

def clean_raw_text(text: str) -> str:
    """
    Cleans raw text extracted from PDFs or OCR.
    - Normalizes line breaks
    - Fixes hyphenated line breaks (e.g. 'termi-\\n nation' -> 'termination')
    - Removes non-printable characters while preserving legal symbols
    - Normalizes multi-whitespace while retaining paragraph structure
    """
    if not text:
        return ""

    # Replace non-breaking spaces and unicode whitespace variants
    text = text.replace("\xa0", " ").replace("\r\n", "\n").replace("\r", "\n")

    # Fix hyphenated words split across lines (e.g. "agree-\n ment" -> "agreement")
    text = re.sub(r'(\b[a-zA-Z]+)-\s*\n\s*([a-zA-Z]+\b)', r'\1\2', text)

    # Clean non-printable control characters except standard whitespace (\n, \t)
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', text)

    # Normalize multiple spaces per line (keep single space)
    lines = []
    for line in text.split('\n'):
        cleaned_line = re.sub(r'[ \t]+', ' ', line).strip()
        lines.append(cleaned_line)

    cleaned_text = '\n'.join(lines)

    # Collapse 3+ consecutive newlines into double newlines (paragraph boundary)
    cleaned_text = re.sub(r'\n{3,}', '\n\n', cleaned_text)

    return cleaned_text.strip()
