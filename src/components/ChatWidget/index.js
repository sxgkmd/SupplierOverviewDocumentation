import React, { useState, useRef, useEffect } from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import styles from './styles.module.css';

const BASE_URL = 'https://sxgkmd.github.io/SupplierOverviewDocumentation';

function MessageBubble({ message }) {
  const isUser = message.role === 'user';
  return (
    <div className={`${styles.message} ${isUser ? styles.messageUser : styles.messageAssistant}`}>
      <div className={styles.messageBubble}>
        <p className={styles.messageText}>{message.content}</p>
        {!isUser && message.sources && message.sources.length > 0 && (
          <div className={styles.sources}>
            <span className={styles.sourcesLabel}>Kilder:</span>
            {message.sources.map((src, i) => (
              <a
                key={i}
                href={`${BASE_URL}${src.url}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.sourceLink}
              >
                {src.title}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className={`${styles.message} ${styles.messageAssistant}`}>
      <div className={styles.messageBubble}>
        <div className={styles.typingDots}>
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}

export default function ChatWidget() {
  const { siteConfig } = useDocusaurusContext();
  const apiUrl = siteConfig.customFields?.chatApiUrl;

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: 'Hej! Jeg kan hjælpe dig med spørgsmål om KMD Supplier Overview. Hvad vil du gerne vide?',
      sources: [],
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  async function sendMessage() {
    const question = input.trim();
    if (!question || isLoading) return;

    setMessages((prev) => [...prev, { role: 'user', content: question }]);
    setInput('');
    setIsLoading(true);

    try {
      if (!apiUrl) {
        throw new Error('Chat API URL er ikke konfigureret.');
      }

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.answer || 'Intet svar modtaget.',
          sources: data.sources || [],
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Beklager, der opstod en fejl. Prøv igen om lidt.',
          sources: [],
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className={styles.widgetContainer}>
      {isOpen && (
        <div className={styles.chatDialog} role="dialog" aria-label="AI Assistent">
          <div className={styles.chatHeader}>
            <div className={styles.chatHeaderInfo}>
              <div className={styles.chatHeaderAvatar}>AI</div>
              <div>
                <div className={styles.chatHeaderTitle}>KMD Supplier Overview</div>
                <div className={styles.chatHeaderSubtitle}>AI Assistent</div>
              </div>
            </div>
            <button
              className={styles.closeButton}
              onClick={() => setIsOpen(false)}
              aria-label="Luk chat"
            >
              ✕
            </button>
          </div>

          <div className={styles.messagesContainer}>
            {messages.map((msg, i) => (
              <MessageBubble key={i} message={msg} />
            ))}
            {isLoading && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>

          <div className={styles.inputArea}>
            <textarea
              ref={inputRef}
              className={styles.input}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Stil et spørgsmål om systemet..."
              rows={1}
              disabled={isLoading}
            />
            <button
              className={styles.sendButton}
              onClick={sendMessage}
              disabled={!input.trim() || isLoading}
              aria-label="Send besked"
            >
              ➤
            </button>
          </div>
        </div>
      )}

      <button
        className={`${styles.chatBubble} ${isOpen ? styles.chatBubbleOpen : ''}`}
        onClick={() => setIsOpen((v) => !v)}
        aria-label={isOpen ? 'Luk AI assistent' : 'Åbn AI assistent'}
      >
        {isOpen ? '✕' : '💬'}
      </button>
    </div>
  );
}
