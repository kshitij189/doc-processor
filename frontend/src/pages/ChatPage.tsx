import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Send, MessageCircle, User, FileText, ChevronDown, ChevronUp,
  Loader2, Info, Search, FileSignature
} from 'lucide-react';
import { fetchDocuments, streamChatMessage, fetchRAGStatus } from '../api/client';
import type { ChatMessage, ChatSource, Document, RAGStatus } from '../types';

// Convert raw logit scores (unbounded) to a 0-100% boundary using the sigmoid function
const formatLogitAsPercentage = (logit: number): string => {
  const sigmoid = 1 / (1 + Math.exp(-logit));
  return (sigmoid * 100).toFixed(1);
};

const ChatPage: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [ragStatus, setRagStatus] = useState<RAGStatus | null>(null);
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const [showDocSelector, setShowDocSelector] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetchDocuments({ status: 'completed', page_size: 100 }).then((res) => {
      setDocuments(res.documents);
    });
    fetchRAGStatus().then(setRagStatus).catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const toggleSource = (msgId: string) => {
    setExpandedSources(prev => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  };

  const handleSend = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const question = input.trim();
    setInput('');
    setIsLoading(true);

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: question,
      timestamp: new Date(),
    };

    const assistantMsgId = `assistant-${Date.now()}`;
    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      sources: [],
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);

    const controller = streamChatMessage(
      question,
      selectedDocIds.length > 0 ? selectedDocIds : undefined,
      {
        onToken: (token) => {
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantMsgId
                ? { ...m, content: m.content + token }
                : m
            )
          );
        },
        onSources: (sources, pipelineInfo) => {
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantMsgId
                ? { ...m, sources: sources as ChatSource[], pipeline_info: pipelineInfo }
                : m
            )
          );
        },
        onDone: () => {
          setIsLoading(false);
        },
        onError: (error) => {
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantMsgId
                ? { ...m, content: `Error: ${error}` }
                : m
            )
          );
          setIsLoading(false);
        },
      }
    );

    abortRef.current = controller;
  }, [input, isLoading, selectedDocIds]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getDocName = (docId: string) => {
    const doc = documents.find(d => d.id === docId);
    return doc?.filename || docId.slice(0, 8);
  };

  return (
    <div className="chat-page">
      {/* Header */}
      <div className="chat-header">
        <div className="chat-header-left">
          <div className="chat-logo">
            <MessageCircle size={24} />
            <h1>Document Chat</h1>
          </div>
          <p className="chat-subtitle">Ask questions about your uploaded documents</p>
        </div>

        <div className="chat-header-right">
          {ragStatus && (
            <div className="rag-stats">
              <span className="stat-pill">
                <FileSignature size={14} />
                {ragStatus.collections} docs
              </span>
              <span className="stat-pill">
                <Info size={14} />
                {ragStatus.total_chunks} chunks
              </span>
              <span className={`stat-pill ${ragStatus.api_key_configured ? 'active' : 'inactive'}`}>
                <Info size={14} />
                {ragStatus.api_key_configured ? 'Ready' : 'No API Key'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Document Selector */}
      <div className="doc-selector-bar">
        <button
          className="doc-selector-toggle"
          onClick={() => setShowDocSelector(!showDocSelector)}
        >
          <FileText size={16} />
          {selectedDocIds.length === 0
            ? 'Search all documents'
            : `Searching ${selectedDocIds.length} document${selectedDocIds.length > 1 ? 's' : ''}`}
          {showDocSelector ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        {showDocSelector && (
          <div className="doc-selector-dropdown">
            {documents.length === 0 ? (
              <p className="no-docs">No processed documents yet. <Link to="/upload">Upload one</Link></p>
            ) : (
              <>
                <button
                  className="doc-option select-all"
                  onClick={() => setSelectedDocIds([])}
                >
                  <Search size={14} />
                  Search all documents
                  {selectedDocIds.length === 0 && <span className="check">✓</span>}
                </button>
                {documents.map((doc) => (
                  <button
                    key={doc.id}
                    className={`doc-option ${selectedDocIds.includes(doc.id) ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedDocIds(prev =>
                        prev.includes(doc.id)
                          ? prev.filter(id => id !== doc.id)
                          : [...prev, doc.id]
                      );
                    }}
                  >
                    <FileText size={14} />
                    <span className="doc-name">{doc.filename}</span>
                    <span className="doc-type">{doc.file_type}</span>
                    {selectedDocIds.includes(doc.id) && <span className="check">✓</span>}
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="empty-icon">
              <MessageCircle size={48} />
            </div>
            <h2>Ask anything about your documents</h2>
            <p>I'll search through your uploaded documents using advanced retrieval to find the best answer.</p>
            <div className="pipeline-features">
              <div className="feature">
                <Search size={18} />
                <span>Hybrid Search</span>
                <small>Semantic + BM25</small>
              </div>
              <div className="feature">
                <FileSignature size={18} />
                <span>Re-Ranking</span>
                <small>Cross-encoder</small>
              </div>
              <div className="feature">
                <Info size={18} />
                <span>Assistant</span>
                <small>Streaming</small>
              </div>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`chat-message ${msg.role}`}>
            <div className="message-avatar">
              {msg.role === 'user' ? <User size={18} /> : <MessageCircle size={18} />}
            </div>
            <div className="message-content">
              <div className="message-text">
                {msg.content || (msg.role === 'assistant' && isLoading && (
                  <span className="typing-indicator">
                    <span></span><span></span><span></span>
                  </span>
                ))}
              </div>

              {/* Source Citations */}
              {msg.sources && msg.sources.length > 0 && (
                <div className="message-sources">
                  <button
                    className="sources-toggle"
                    onClick={() => toggleSource(msg.id)}
                  >
                    <FileText size={14} />
                    {msg.sources.length} source{msg.sources.length > 1 ? 's' : ''} used
                    {expandedSources.has(msg.id) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>

                  {expandedSources.has(msg.id) && (
                    <div className="sources-list">
                      {msg.sources.map((src, i) => (
                        <div key={i} className="source-card">
                          <div className="source-header">
                            <span className="source-badge">Source {i + 1}</span>
                            <span className="source-score">
                              Relevance: {formatLogitAsPercentage(src.score)}%
                            </span>
                            {src.document_id && (
                              <Link to={`/documents/${src.document_id}`} className="source-doc-link">
                                {getDocName(src.document_id)}
                              </Link>
                            )}
                          </div>
                          <p className="source-text">{src.text}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Pipeline Info */}
                  {msg.pipeline_info && (
                    <div className="pipeline-info">
                      {msg.pipeline_info.queries && (
                        <span>Queries: {msg.pipeline_info.queries.length}</span>
                      )}
                      {msg.pipeline_info.candidates_found !== undefined && (
                        <span>Candidates: {msg.pipeline_info.candidates_found}</span>
                      )}
                      {msg.pipeline_info.reranked_to !== undefined && (
                        <span>Re-ranked to: {msg.pipeline_info.reranked_to}</span>
                      )}
                      {msg.pipeline_info.cached && (
                        <span className="cached-badge">⚡ Cached</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="chat-input-area">
        <div className="chat-input-wrapper">
          <textarea
            className="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about your documents..."
            rows={1}
            disabled={isLoading}
          />
          <button
            className="chat-send-btn"
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
          >
            {isLoading ? <Loader2 size={20} className="spin" /> : <Send size={20} />}
          </button>
        </div>
        <p className="chat-disclaimer">
          AI answers are generated from your document content using RAG pipeline
        </p>
      </div>
    </div>
  );
};

export default ChatPage;
