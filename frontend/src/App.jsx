import { useState, useRef, useCallback, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./App.css";

const API = "http://127.0.0.1:8000";

/* ─────────────────────────────────────────────
   TOAST HELPER
───────────────────────────────────────────── */
function useToast() {
  const [toast, setToast] = useState({ msg: "", type: "info", show: false });
  const timerRef = useRef(null);

  const showToast = useCallback((msg, type = "info") => {
    clearTimeout(timerRef.current);
    setToast({ msg, type, show: true });
    timerRef.current = setTimeout(
      () => setToast((t) => ({ ...t, show: false })),
      3500,
    );
  }, []);

  return { toast, showToast };
}

export default function App() {
  // Navigation
  const [activeTab, setActiveTab] = useState("summary"); // 'summary' | 'chat' | 'clauses'

  // Document state
  const [docFile, setDocFile] = useState(null);
  const [docInfo, setDocInfo] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [dragover, setDragover] = useState(false);
  const [processingStep, setProcessingStep] = useState("");

  // Chat & Q&A state
  const [chatHistory, setChatHistory] = useState([]);
  const [inputQuestion, setInputQuestion] = useState("");
  const [asking, setAsking] = useState(false);

  // Clauses Explorer state
  const [clauseSearch, setClauseSearch] = useState("");
  const [clauseFilterSection, setClauseFilterSection] = useState("ALL");

  // Voice state
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);

  const recognitionRef = useRef(null);
  const fileInputRef = useRef(null);
  const chatBottomRef = useRef(null);
  const { toast, showToast } = useToast();

  /* ── Speech Synthesis (TTS) ── */
  const speakText = useCallback((text) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    // Clean markdown asterisks and parentheses for natural voice speech
    const cleanText = text
      .replace(/\*\*/g, "")
      .replace(/\*/g, "")
      .replace(/\(Note:.*?\)\.?/gs, "")
      .trim();

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = "en-US";
    utterance.rate = 1.0;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, []);

  const stopSpeaking = () => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    }
  };

  /* ── Speech Recognition (STT & Voice Commands) ── */
  useEffect(() => {
    const SpeechRec =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) return;

    const recog = new SpeechRec();
    recog.continuous = false;
    recog.interimResults = true;
    recog.lang = "en-US";

    recog.onresult = (e) => {
      const transcript = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join("");
      setInputQuestion(transcript);
    };

    recog.onend = () => {
      setListening(false);
    };

    recog.onerror = (e) => {
      setListening(false);
      showToast(`Mic error: ${e.error}`, "error");
    };

    recognitionRef.current = recog;
    return () => recog.abort();
  }, [showToast]);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      showToast(
        "Speech recognition is not supported in this browser. Please use Chrome/Edge.",
        "error",
      );
      return;
    }
    if (listening) {
      recognitionRef.current.stop();
    } else {
      stopSpeaking();
      setInputQuestion("");
      try {
        recognitionRef.current.start();
        setListening(true);
        showToast("Listening. Speak your question now.", "info");
      } catch (err) {
        setListening(false);
      }
    }
  };

  /* ── Scroll Chat to bottom ── */
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  /* ── File Selection ── */
  const handleFileChange = (file) => {
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["pdf", "png", "jpg", "jpeg"].includes(ext)) {
      showToast(
        "Please upload a PDF or document image (.png, .jpg, .jpeg).",
        "error",
      );
      return;
    }
    setDocFile(file);
    showToast(`Loaded: ${file.name}`, "info");
  };

  /* ── Process Document Pipeline ── */
  const processDocument = async () => {
    if (!docFile) {
      showToast("Please select a document first.", "error");
      return;
    }

    setProcessing(true);
    setDocInfo(null);
    setChatHistory([]);
    setProcessingStep("Uploading document...");

    try {
      const fd = new FormData();
      fd.append("file", docFile);

      setProcessingStep("Extracting text & running OCR...");
      const res = await fetch(`${API}/process-document`, {
        method: "POST",
        body: fd,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Document processing failed");
      }

      const data = await res.json();
      setDocInfo(data);
      setActiveTab("summary");
      showToast(
        `Indexed ${data.total_clauses} clauses successfully.`,
        "success",
      );

      // Initial greeting in chat
      if (data.summary) {
        const greeting = `I have analyzed **${data.filename}**. It is identified as a **${data.summary.document_type || "Legal Document"}** with ${data.total_clauses} indexed clauses. You can ask me any question about conditions, termination rules, or obligations by text or voice!`;
        setChatHistory([
          {
            sender: "assistant",
            text: greeting,
            is_grounded: true,
            evidence: [],
          },
        ]);
        if (autoSpeak) {
          speakText(greeting);
        }
      }
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setProcessing(false);
      setProcessingStep("");
    }
  };

  /* ── Ask Question (Text / Voice) ── */
  const askQuestion = async (customQuery = null) => {
    const q = (customQuery || inputQuestion).trim();
    if (!q) {
      showToast("Please enter or speak a question.", "error");
      return;
    }
    if (!docInfo) {
      showToast("Please upload and process a document first.", "error");
      return;
    }

    // Voice Command Handlers
    const lowerQ = q.toLowerCase();
    if (
      lowerQ.includes("summarize") ||
      lowerQ.includes("what is this document about")
    ) {
      setActiveTab("summary");
      if (docInfo.summary?.executive_summary) {
        const sumMsg = `This document is a ${docInfo.summary.document_type}. ${docInfo.summary.executive_summary}`;
        setChatHistory((prev) => [
          ...prev,
          { sender: "user", text: q },
          {
            sender: "assistant",
            text: sumMsg,
            is_grounded: true,
            evidence: [],
          },
        ]);
        if (autoSpeak) speakText(sumMsg);
      }
      setInputQuestion("");
      return;
    }

    if (lowerQ.includes("clear chat") || lowerQ.includes("reset chat")) {
      setChatHistory([]);
      setInputQuestion("");
      showToast("Chat cleared", "info");
      return;
    }

    // Append user message
    setChatHistory((prev) => [...prev, { sender: "user", text: q }]);
    setInputQuestion("");
    setAsking(true);
    stopSpeaking();

    try {
      const res = await fetch(`${API}/ask-question`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, top_k: 5 }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Query failed");
      }

      const data = await res.json();
      setChatHistory((prev) => [
        ...prev,
        {
          sender: "assistant",
          text: data.answer,
          is_grounded: data.is_grounded,
          evidence: data.evidence || [],
        },
      ]);

      if (autoSpeak && data.answer) {
        speakText(data.answer);
      }
    } catch (e) {
      showToast(e.message, "error");
      setChatHistory((prev) => [
        ...prev,
        {
          sender: "assistant",
          text: `An error occurred: ${e.message}`,
          is_grounded: false,
          evidence: [],
        },
      ]);
    } finally {
      setAsking(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      askQuestion();
    }
  };

  /* ── Filter clauses ── */
  const filteredClauses =
    docInfo?.clauses?.filter((c) => {
      const matchesSearch =
        !clauseSearch ||
        c.text.toLowerCase().includes(clauseSearch.toLowerCase()) ||
        c.clause.toLowerCase().includes(clauseSearch.toLowerCase()) ||
        c.section.toLowerCase().includes(clauseSearch.toLowerCase());

      const matchesSection =
        clauseFilterSection === "ALL" || c.section === clauseFilterSection;
      return matchesSearch && matchesSection;
    }) || [];

  const uniqueSections = [
    "ALL",
    ...Array.from(new Set(docInfo?.clauses?.map((c) => c.section) || [])),
  ];

  return (
    <div className="app-wrapper">
      {/* NAVBAR */}
      <nav className="navbar">
        <div className="navbar-brand">
          <div className="brand-icon" aria-hidden="true">
            VL
          </div>
          <div>
            <span className="brand-name">VoxLegal AI</span>
            <div className="brand-description">Legal document intelligence</div>
          </div>
        </div>

        <div className="navbar-actions">
          <button
            type="button"
            className={`toggle-switch ${autoSpeak ? "active" : ""}`}
            onClick={() => setAutoSpeak(!autoSpeak)}
            title="Automatically read answers aloud"
            aria-pressed={autoSpeak}
          >
            <span className="toggle-indicator" aria-hidden="true" />
            <span>Auto-read answers</span>
            <span className="toggle-state">{autoSpeak ? "On" : "Off"}</span>
          </button>

          {speaking && (
            <button className="btn btn-secondary" onClick={stopSpeaking}>
              Stop audio
            </button>
          )}
        </div>
      </nav>

      {/* HERO BANNER */}
      <div className="hero-compact">
        <div className="hero-text">
          <h1>Legal document review</h1>
          <p>
            Review key terms, explore clauses, and ask questions grounded in
            your document.
          </p>
        </div>
        <div className="disclaimer-pill">
          AI-assisted analysis · Not legal advice
        </div>
      </div>

      {/* MAIN LAYOUT */}
      <div className="dashboard-grid">
        {/* LEFT COLUMN: INGESTION & DOCUMENT INFO */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* UPLOAD CARD */}
          <div className="card">
            <div className="card-header">
              <div className="card-title-group">
                <div className="card-icon" aria-hidden="true">
                  01
                </div>
                <span className="card-title">Document</span>
              </div>
            </div>
            <div
              className="card-body"
              style={{ display: "flex", flexDirection: "column", gap: 14 }}
            >
              <div
                className={`upload-zone ${dragover ? "dragover" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragover(true);
                }}
                onDragLeave={() => setDragover(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragover(false);
                  handleFileChange(e.dataTransfer.files[0]);
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  onChange={(e) => handleFileChange(e.target.files[0])}
                />
                <span className="upload-icon" aria-hidden="true">
                  PDF
                </span>
                <p className="upload-label">
                  {docFile
                    ? "Choose a different file"
                    : "Choose a file or drop it here"}
                </p>
                <p className="upload-hint">
                  PDF, PNG, or JPG · One document at a time
                </p>
                {docFile && (
                  <div className="upload-filename">{docFile.name}</div>
                )}
              </div>

              <button
                className="btn btn-primary btn-full"
                onClick={processDocument}
                disabled={!docFile || processing}
              >
                {processing ? (
                  <>
                    <div className="spinner" />
                    <span>{processingStep || "Processing..."}</span>
                  </>
                ) : (
                  <span>
                    {docInfo ? "Reprocess document" : "Analyze document"}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* DOCUMENT STATS */}
          {docInfo && (
            <div className="card">
              <div className="card-header">
                <div className="card-title-group">
                  <div className="card-icon" aria-hidden="true">
                    02
                  </div>
                  <span className="card-title">Document index</span>
                </div>
              </div>
              <div className="card-body">
                <div className="stat-row">
                  <div className="stat-box">
                    <span className="stat-num">{docInfo.total_pages}</span>
                    <span className="stat-txt">Pages</span>
                  </div>
                  <div className="stat-box">
                    <span className="stat-num">{docInfo.total_clauses}</span>
                    <span className="stat-txt">Clauses</span>
                  </div>
                  <div className="stat-box">
                    <span className="stat-num">{docInfo.indexed_clauses}</span>
                    <span className="stat-txt">FAISS Vectors</span>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  <strong>{docInfo.filename}</strong>
                  <br />
                  🏷️ Type:{" "}
                  <span style={{ color: "var(--accent-2)" }}>
                    {docInfo.summary?.document_type || "Legal Document"}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: TABS (EXECUTIVE SUMMARY | VOICE CHAT | CLAUSES) */}
        <div>
          {/* TABS HEADER */}
          <div className="tabs-nav">
            <button
              className={`tab-btn ${activeTab === "summary" ? "active" : ""}`}
              onClick={() => setActiveTab("summary")}
            >
              <span>Summary</span>
            </button>
            <button
              className={`tab-btn ${activeTab === "chat" ? "active" : ""}`}
              onClick={() => setActiveTab("chat")}
            >
              <span>Ask a question</span>
              {chatHistory.length > 0 && (
                <span className="tab-badge">{chatHistory.length}</span>
              )}
            </button>
            <button
              className={`tab-btn ${activeTab === "clauses" ? "active" : ""}`}
              onClick={() => setActiveTab("clauses")}
            >
              <span>Clauses ({docInfo?.total_clauses || 0})</span>
            </button>
          </div>

          {/* TAB 1: EXECUTIVE SUMMARY */}
          {activeTab === "summary" && (
            <div className="card">
              <div className="card-header">
                <div className="card-title-group">
                  <div className="card-icon" aria-hidden="true">
                    03
                  </div>
                  <span className="card-title">Document overview</span>
                </div>
                {docInfo?.summary?.document_type && (
                  <span className="grounded-badge yes">
                    {docInfo.summary.document_type}
                  </span>
                )}
              </div>
              <div className="card-body">
                {docInfo?.summary ? (
                  <div className="summary-container">
                    {/* PURPOSE BANNER */}
                    <div className="doc-type-banner">
                      <div>
                        <div className="doc-type-title">
                          What this document covers
                        </div>
                        <div
                          style={{
                            fontSize: 14,
                            color: "var(--text-primary)",
                            marginTop: 6,
                            lineHeight: 1.65,
                          }}
                        >
                          {docInfo.summary.executive_summary}
                        </div>
                      </div>
                    </div>

                    {/* PARTIES */}
                    {docInfo.summary.parties_involved?.length > 0 && (
                      <div className="summary-card-block">
                        <div className="block-title">Parties involved</div>
                        <ul className="bullet-list">
                          {docInfo.summary.parties_involved.map((party, i) => (
                            <li key={i} className="bullet-item">
                              <strong>{party}</strong>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* KEY CONDITIONS */}
                    {docInfo.summary.key_conditions?.length > 0 && (
                      <div className="summary-card-block">
                        <div className="block-title">
                          Key conditions and provisions
                        </div>
                        <ul className="bullet-list">
                          {docInfo.summary.key_conditions.map((cond, i) => (
                            <li key={i} className="bullet-item">
                              {cond}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* TERMINATION & PENALTIES */}
                    {docInfo.summary.termination_and_penalties && (
                      <div className="highlight-box danger">
                        <div
                          style={{
                            fontWeight: 700,
                            marginBottom: 4,
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <span>
                            Termination, notice periods, and penalties
                          </span>
                        </div>
                        <div>{docInfo.summary.termination_and_penalties}</div>
                      </div>
                    )}

                    {/* GOVERNING LAW & DISPUTES */}
                    {docInfo.summary.governing_law_and_disputes && (
                      <div className="highlight-box amber">
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>
                          Governing law and dispute resolution
                        </div>
                        <div>{docInfo.summary.governing_law_and_disputes}</div>
                      </div>
                    )}

                    {/* IMPORTANT TAKEAWAYS */}
                    {docInfo.summary.important_takeaways?.length > 0 && (
                      <div className="summary-card-block">
                        <div className="block-title">Important takeaways</div>
                        <ul className="bullet-list">
                          {docInfo.summary.important_takeaways.map(
                            (point, i) => (
                              <li key={i} className="bullet-item">
                                {point}
                              </li>
                            ),
                          )}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "48px 16px",
                      color: "var(--text-muted)",
                    }}
                  >
                    <div className="empty-state-mark" aria-hidden="true">
                      DOC
                    </div>
                    <p>
                      Upload and process a document on the left to view the
                      automated Executive Summary &amp; Key Conditions.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: VOICE & CHAT ASSISTANT */}
          {activeTab === "chat" && (
            <div className="card">
              <div className="card-header">
                <div className="card-title-group">
                  <div className="card-icon" aria-hidden="true">
                    Q&amp;A
                  </div>
                  <span className="card-title">Document questions</span>
                </div>
                {chatHistory.length > 0 && (
                  <button
                    className="btn btn-audio-action"
                    onClick={() => setChatHistory([])}
                    style={{ margin: 0 }}
                  >
                    Clear conversation
                  </button>
                )}
              </div>

              <div className="chat-container">
                {/* CHAT HISTORY */}
                <div className="chat-history">
                  {chatHistory.length === 0 ? (
                    <div
                      style={{
                        textAlign: "center",
                        margin: "auto",
                        color: "var(--text-muted)",
                        maxWidth: 440,
                      }}
                    >
                      <div className="empty-state-mark" aria-hidden="true">
                        Q&amp;A
                      </div>
                      <h3
                        style={{
                          color: "var(--text-primary)",
                          marginBottom: 6,
                        }}
                      >
                        Ask about this document
                      </h3>
                      <p style={{ fontSize: 13, lineHeight: 1.6 }}>
                        Use your microphone or type below. Answers are strictly
                        grounded in your uploaded clauses with page citations.
                      </p>
                    </div>
                  ) : (
                    chatHistory.map((msg, idx) => (
                      <div key={idx} className={`chat-bubble ${msg.sender}`}>
                        <div className="bubble-meta">
                          <span>
                            {msg.sender === "user" ? "You" : "VoxLegal AI"}
                          </span>
                          {msg.sender === "assistant" && (
                            <span
                              className={`grounded-badge ${msg.is_grounded ? "yes" : "no"}`}
                            >
                              {msg.is_grounded
                                ? "Grounded in document"
                                : "Limited evidence"}
                            </span>
                          )}
                        </div>

                        {msg.sender === "assistant" ? (
                          <div className="assistant-answer">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {msg.text}
                            </ReactMarkdown>
                          </div>
                        ) : (
                          <div style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>
                            {msg.text}
                          </div>
                        )}

                        {/* Audio Replay for Assistant Message */}
                        {msg.sender === "assistant" && msg.text && (
                          <button
                            className="btn-audio-action"
                            onClick={() => speakText(msg.text)}
                          >
                            Read aloud
                          </button>
                        )}

                        {/* Evidence Citations */}
                        {msg.evidence && msg.evidence.length > 0 && (
                          <div
                            style={{
                              marginTop: 14,
                              paddingTop: 12,
                              borderTop: "1px solid var(--glass-border)",
                            }}
                          >
                            <div
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                textTransform: "uppercase",
                                color: "var(--accent-3)",
                                marginBottom: 8,
                              }}
                            >
                              Supporting evidence ({msg.evidence.length})
                            </div>
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 8,
                              }}
                            >
                              {msg.evidence.map((ev, i) => (
                                <div
                                  key={i}
                                  style={{
                                    background: "rgba(245,158,11,0.06)",
                                    border: "1px solid rgba(245,158,11,0.2)",
                                    borderRadius: 8,
                                    padding: "8px 12px",
                                    fontSize: 12,
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      gap: 8,
                                      marginBottom: 4,
                                      fontWeight: 600,
                                      color: "var(--accent-1)",
                                    }}
                                  >
                                    <span>Page {ev.page}</span>
                                    <span>Clause {ev.clause}</span>
                                    {ev.section && <span>{ev.section}</span>}
                                  </div>
                                  <div
                                    style={{
                                      color: "var(--text-secondary)",
                                      fontStyle: "italic",
                                    }}
                                  >
                                    "{ev.text}"
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                  <div ref={chatBottomRef} />
                </div>

                {/* QUICK SUGGESTIONS */}
                {docInfo && (
                  <div className="suggestion-pills">
                    <button
                      className="pill-btn"
                      onClick={() =>
                        askQuestion(
                          "What is the notice period for termination?",
                        )
                      }
                    >
                      Termination notice
                    </button>
                    <button
                      className="pill-btn"
                      onClick={() =>
                        askQuestion(
                          "What are the payment and compensation terms?",
                        )
                      }
                    >
                      Payment terms
                    </button>
                    <button
                      className="pill-btn"
                      onClick={() =>
                        askQuestion("What are the confidentiality obligations?")
                      }
                    >
                      Confidentiality
                    </button>
                    <button
                      className="pill-btn"
                      onClick={() =>
                        askQuestion(
                          "What is the governing law and jurisdiction?",
                        )
                      }
                    >
                      Governing law
                    </button>
                  </div>
                )}

                {/* INPUT BAR */}
                <div className="chat-input-bar">
                  <textarea
                    className="chat-textarea"
                    placeholder={
                      listening
                        ? "Listening... speak your question"
                        : "Ask any question about this document (or use voice)..."
                    }
                    value={inputQuestion}
                    onChange={(e) => setInputQuestion(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={asking}
                  />

                  {/* Microphone Button */}
                  <button
                    className={`mic-action-btn ${listening ? "recording" : ""}`}
                    onClick={toggleListening}
                    title={
                      listening
                        ? "Stop voice listening"
                        : "Click to speak voice question"
                    }
                  >
                    {listening ? "Stop" : "Voice"}
                  </button>

                  {/* Send Button */}
                  <button
                    className="btn btn-primary"
                    onClick={() => askQuestion()}
                    disabled={asking || !inputQuestion.trim()}
                  >
                    {asking ? <div className="spinner" /> : "Send"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: ALL CLAUSES / VECTOR EXPLORER */}
          {activeTab === "clauses" && (
            <div className="card">
              <div className="card-header">
                <div className="card-title-group">
                  <div className="card-icon" aria-hidden="true">
                    04
                  </div>
                  <span className="card-title">
                    Indexed clauses ({docInfo?.total_clauses || 0})
                  </span>
                </div>
              </div>
              <div className="card-body">
                {docInfo?.clauses && docInfo.clauses.length > 0 ? (
                  <div className="clauses-viewer">
                    {/* FILTER BAR */}
                    <div className="clauses-filter-bar">
                      <input
                        type="text"
                        className="clause-search-input"
                        placeholder="Search indexed clauses by keyword..."
                        value={clauseSearch}
                        onChange={(e) => setClauseSearch(e.target.value)}
                      />
                      <select
                        className="clause-search-input"
                        style={{ maxWidth: 220 }}
                        value={clauseFilterSection}
                        onChange={(e) => setClauseFilterSection(e.target.value)}
                      >
                        {uniqueSections.map((s, i) => (
                          <option key={i} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* CLAUSES LIST */}
                    <div className="clauses-grid">
                      {filteredClauses.map((c, idx) => (
                        <div
                          key={c.clause_id || idx}
                          className="clause-item-card"
                        >
                          <div className="clause-item-header">
                            <div
                              style={{
                                display: "flex",
                                gap: 8,
                                alignItems: "center",
                              }}
                            >
                              <span className="metadata-label">
                                Page {c.page}
                              </span>
                              <span className="metadata-label">
                                Clause {c.clause}
                              </span>
                              {c.section && (
                                <span className="metadata-section">
                                  {c.section}
                                </span>
                              )}
                            </div>

                            <button
                              className="btn-audio-action"
                              style={{
                                margin: 0,
                                padding: "2px 8px",
                                fontSize: 11,
                              }}
                              onClick={() => {
                                setActiveTab("chat");
                                askQuestion(
                                  `Explain the implications of this clause: "${c.text}"`,
                                );
                              }}
                            >
                              Ask about clause
                            </button>
                          </div>

                          <p className="clause-item-text">{c.text}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "48px 16px",
                      color: "var(--text-muted)",
                    }}
                  >
                    <div className="empty-state-mark" aria-hidden="true">
                      DOC
                    </div>
                    <p>
                      No document processed yet. Upload a document to explore
                      all segmented clauses.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* TOAST ALERT */}
      <div className={`toast ${toast.type} ${toast.show ? "show" : ""}`}>
        {toast.msg}
      </div>
    </div>
  );
}
