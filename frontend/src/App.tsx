import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import './App.css'

type Role = 'user' | 'assistant'

interface ProductRow {
  productName: string
  sku: string
  category: string
  price: number
  quantity: number
  variant?: string
  reorderLevel?: number
}

interface ChatMessage {
  id: string
  role: Role
  content: string
  products?: ProductRow[]
  time: string
  error?: boolean
}

interface ChatResponse {
  sessionId?: string
  response?: string
  error?: string
  products?: ProductRow[]
}

const suggestions = [
  { icon: 'chart', text: 'Show all low-stock products.', tone: 'amber' },
  { icon: 'box', text: 'Show out-of-stock products.', tone: 'rose' },
  { icon: 'search', text: 'Search for LAP-001.', tone: 'blue' },
  { icon: 'refresh', text: 'Update LAP-001 stock to 25.', tone: 'violet' },
  { icon: 'plus', text: 'Add a new product.', tone: 'green' },
]

function Icon({
  name,
  size = 20,
}: {
  name: string
  size?: number
}) {
  const paths: Record<string, React.ReactNode> = {
    sparkles: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z" /><path d="m5 3 .7 1.8L7.5 5.5l-1.8.7L5 8l-.7-1.8L2.5 5.5l1.8-.7L5 3Z" /></>,
    chart: <><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-5 5" /><path d="M15 9h4v4" /></>,
    box: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 8 9 5 9-5" /><path d="M3 8v9l9 5 9-5V8" /><path d="M12 13v9" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>,
    refresh: <><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M5.6 9a7 7 0 0 1 11.6-2L20 12M4 12l2.8 5a7 7 0 0 0 11.6-2" /></>,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    arrow: <><path d="M7 17 17 7" /><path d="M7 7h10v10" /></>,
    send: <><path d="m22 2-7 20-4-9-9-4 20-7Z" /><path d="M22 2 11 13" /></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
    close: <><path d="m18 6-12 12M6 6l12 12" /></>,
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
  }

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name] ?? paths.sparkles}
    </svg>
  )
}

function currentTime() {
  return new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).format(new Date())
}

function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index}>{part.slice(1, -1)}</code>
    }
    return part
  })
}

function MessageText({ content }: { content: string }) {
  const lines = content.split('\n')
  return (
    <div className="message-copy">
      {lines.map((line, index) => {
        const trimmed = line.trim()
        if (!trimmed) return <div className="message-spacer" key={index} />
        const bullet = trimmed.match(/^[-*]\s+(.+)/)
        const numbered = trimmed.match(/^\d+[.)]\s+(.+)/)
        if (bullet || numbered) {
          return (
            <div className="message-list-line" key={index}>
              <span className="list-marker">{numbered ? `${trimmed.match(/^\d+/)?.[0]}.` : '•'}</span>
              <span>{renderInline((bullet ?? numbered)?.[1] ?? trimmed)}</span>
            </div>
          )
        }
        return <p key={index}>{renderInline(trimmed.replace(/^#{1,4}\s+/, ''))}</p>
      })}
    </div>
  )
}

function ProductTable({ products }: { products: ProductRow[] }) {
  return (
    <div className="product-table-wrap">
      <table className="product-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>SKU</th>
            <th>Category</th>
            <th>Price</th>
            <th>Stock</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={`${product.sku}-${product.productName}`}>
              <td>
                <span className="table-product-name">{product.productName}</span>
                {product.variant && <span className="table-variant">{product.variant}</span>}
              </td>
              <td><code>{product.sku}</code></td>
              <td>{product.category}</td>
              <td>{new Intl.NumberFormat(undefined, { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(product.price)}</td>
              <td>
                <span className={`stock-pill ${product.quantity === 0 ? 'stock-empty' : product.reorderLevel !== undefined && product.quantity <= product.reorderLevel ? 'stock-low' : 'stock-ok'}`}>
                  {product.quantity} units
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string>()
  const [apiError, setApiError] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const conversationRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const conversation = conversationRef.current
    if (conversation) conversation.scrollTo({ top: conversation.scrollHeight, behavior: 'smooth' })
  }, [messages, isLoading])

  async function sendMessage(value = draft) {
    const message = value.trim()
    if (!message || isLoading) return

    setApiError('')
    setDraft('')
    setSidebarOpen(false)
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: 'user', content: message, time: currentTime() },
    ])
    setIsLoading(true)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, ...(sessionId ? { sessionId } : {}) }),
      })
      const data = (await response.json()) as ChatResponse
      if (!response.ok) {
        throw new Error(data.error || `The assistant could not respond (HTTP ${response.status}).`)
      }
      if (typeof data.response !== 'string' || !data.response.trim()) {
        throw new Error('The assistant returned an empty response. Please try again.')
      }
      if (data.sessionId) setSessionId(data.sessionId)
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data.response ?? '',
          ...(Array.isArray(data.products) ? { products: data.products } : {}),
          time: currentTime(),
        },
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Something went wrong. Please try again.'
      setApiError(message)
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `I couldn’t reach the inventory assistant. ${message}`,
          time: currentTime(),
          error: true,
        },
      ])
    } finally {
      setIsLoading(false)
      inputRef.current?.focus()
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void sendMessage()
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendMessage()
    }
  }

  function startNewChat() {
    setMessages([])
    setSessionId(undefined)
    setApiError('')
    setDraft('')
    setSidebarOpen(false)
    inputRef.current?.focus()
  }

  const isEmpty = messages.length === 0

  return (
    <div className="app-shell">
      {sidebarOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-mark"><Icon name="box" size={22} /></div>
          <div>
            <span className="brand-title">Stockwise</span>
            <span className="brand-caption">INVENTORY PLATFORM</span>
          </div>
          <button className="mobile-close icon-button" aria-label="Close menu" onClick={() => setSidebarOpen(false)}><Icon name="close" /></button>
        </div>

        <button className="new-chat-button" onClick={startNewChat}>
          <Icon name="plus" size={18} />
          <span>New conversation</span>
          <span className="shortcut">⌘ K</span>
        </button>

        <div className="sidebar-section">
          <div className="section-label">GET STARTED</div>
          <div className="prompt-list">
            {suggestions.map((prompt) => (
              <button
                className="prompt-button"
                key={prompt.text}
                onClick={() => void sendMessage(prompt.text)}
                disabled={isLoading}
              >
                <span className={`prompt-icon prompt-${prompt.tone}`}><Icon name={prompt.icon} size={16} /></span>
                <span>{prompt.text}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-bottom">
          <div className="connection-card">
            <span className="connection-dot" />
            <span><strong>Inventory connected</strong><small>Live data · MCP enabled</small></span>
            <Icon name="arrow" size={15} />
          </div>
          <div className="sidebar-footer">
            <div className="avatar">IA</div>
            <div className="profile-copy"><strong>Inventory Assistant</strong><span>AI workspace</span></div>
            <button className="icon-button footer-menu" aria-label="More options"><span>···</span></button>
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu icon-button" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}><Icon name="menu" /></button>
            <div className="breadcrumb"><span>Workspace</span><Icon name="chevron" size={15} /><strong>Inventory AI Assistant</strong></div>
          </div>
          <div className="topbar-right">
            <div className="online-indicator"><span className="connection-dot" /> All systems operational</div>
            <span className="topbar-divider" />
            <button className="help-button" title="AI-powered inventory support"><Icon name="shield" size={17} /><span>Secure assistant</span></button>
          </div>
        </header>

        <div className={`conversation ${isEmpty ? 'conversation-empty' : ''}`} ref={conversationRef}>
          {isEmpty ? (
            <section className="welcome">
              <div className="welcome-eyebrow"><span className="eyebrow-line" /> YOUR INVENTORY, IN CONVERSATION <span className="eyebrow-line" /></div>
              <div className="welcome-emblem"><div className="emblem-glow" /><Icon name="sparkles" size={32} /></div>
              <h1>Inventory AI Assistant</h1>
              <p className="welcome-description">A clearer view of your inventory starts here.<br className="desktop-break" /> Ask a question or tell me what you need to do.</p>
              <div className="welcome-cards">
                <button onClick={() => void sendMessage('Show all low-stock products.')} className="welcome-card">
                  <span className="card-icon card-amber"><Icon name="chart" size={18} /></span>
                  <span><strong>Monitor stock</strong><small>Find items that need attention</small></span>
                  <Icon name="arrow" size={16} />
                </button>
                <button onClick={() => void sendMessage('Search for LAP-001.')} className="welcome-card">
                  <span className="card-icon card-blue"><Icon name="search" size={18} /></span>
                  <span><strong>Find a product</strong><small>Look up products by name or SKU</small></span>
                  <Icon name="arrow" size={16} />
                </button>
                <button onClick={() => void sendMessage('Add a new product.')} className="welcome-card">
                  <span className="card-icon card-green"><Icon name="plus" size={18} /></span>
                  <span><strong>Manage catalog</strong><small>Add or update your inventory</small></span>
                  <Icon name="arrow" size={16} />
                </button>
              </div>
              <div className="starter-hint"><Icon name="sparkles" size={14} /> Try one of the suggested prompts in the sidebar</div>
            </section>
          ) : (
            <section className="message-list" aria-live="polite">
              <div className="conversation-date"><span /> TODAY <span /></div>
              {messages.map((message) => (
                <article className={`message-row message-${message.role}`} key={message.id}>
                  {message.role === 'assistant' && <div className="message-avatar"><Icon name="sparkles" size={16} /></div>}
                  <div className="message-content">
                    <div className="message-meta">
                      <strong>{message.role === 'assistant' ? 'Inventory AI' : 'You'}</strong>
                      <span>{message.time}</span>
                      {message.error && <span className="error-tag">Connection issue</span>}
                    </div>
                    <div className={`message-bubble ${message.role === 'user' ? 'user-bubble' : 'assistant-bubble'} ${message.error ? 'error-bubble' : ''}`}>
                      <MessageText content={message.content} />
                      {message.products && message.products.length > 0 && <ProductTable products={message.products} />}
                    </div>
                  </div>
                  {message.role === 'user' && <div className="user-avatar">Y</div>}
                </article>
              ))}
              {isLoading && (
                <article className="message-row message-assistant">
                  <div className="message-avatar"><Icon name="sparkles" size={16} /></div>
                  <div className="message-content">
                    <div className="message-meta"><strong>Inventory AI</strong><span>Thinking</span></div>
                    <div className="typing-bubble" aria-label="Assistant is thinking"><span /><span /><span /></div>
                  </div>
                </article>
              )}
            </section>
          )}
        </div>

        <footer className="composer-area">
          {apiError && <div className="inline-error" role="status"><span>!</span>{apiError}<button onClick={() => setApiError('')} aria-label="Dismiss error"><Icon name="close" size={15} /></button></div>}
          <form className="composer" onSubmit={onSubmit}>
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Ask about your inventory..."
              aria-label="Message Inventory AI Assistant"
              rows={1}
              maxLength={4000}
              disabled={isLoading}
            />
            <div className="composer-controls">
              <span className="composer-hint"><Icon name="sparkles" size={14} /> AI can make mistakes. Verify important changes.</span>
              <div className="send-controls">
                <span className="enter-hint">↵ to send</span>
                <button type="submit" className="send-button" disabled={!draft.trim() || isLoading} aria-label="Send message">
                  {isLoading ? <span className="send-spinner" /> : <Icon name="send" size={17} />}
                  <span>Send</span>
                </button>
              </div>
            </div>
          </form>
          <div className="footer-note"><Icon name="shield" size={13} /> Connected to your inventory database securely</div>
        </footer>
      </main>
    </div>
  )
}

export default App
