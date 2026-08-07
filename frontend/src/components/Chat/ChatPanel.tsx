import { useState, useRef, useEffect } from 'react';
import type { ChatMessage, ChatResponseData } from '../../types';
import { api } from '../../hooks/useApi';
import { getRiskColor } from '../../utils/riskColors';
import { getConfidenceStyle } from '../../utils/confidenceBadge';

interface ChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onRouteSelect?: (route: any) => void;
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 py-2 px-3">
      <span className="typing-dot w-2 h-2 rounded-full bg-blue-400 inline-block" />
      <span className="typing-dot w-2 h-2 rounded-full bg-blue-400 inline-block" />
      <span className="typing-dot w-2 h-2 rounded-full bg-blue-400 inline-block" />
    </div>
  );
}

function VerdictDetails({ data }: { data: ChatResponseData }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-2">
      {/* Hotspots referenced */}
      {data.hotspots_referenced && data.hotspots_referenced.length > 0 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 mt-2 transition-colors"
        >
          {expanded ? '▼' : '▶'} {data.hotspots_referenced.length} hotspot(s) considered
          {data.method && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-slate-500 ml-2">
              via {data.method}
            </span>
          )}
        </button>
      )}

      {expanded && data.hotspots_referenced && (
        <div className="mt-2 space-y-1.5 animate-fade-in">
          {data.hotspots_referenced.map((h: any, i: number) => {
            const conf = getConfidenceStyle(h.data_confidence || '');
            const riskColor = getRiskColor(h.risk_level || 'low');
            return (
              <div
                key={i}
                className="text-xs px-2.5 py-1.5 rounded-lg"
                style={{ background: 'rgba(30, 41, 59, 0.6)', border: `1px solid ${riskColor}33` }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium" style={{ color: riskColor }}>
                    {h.name || 'Unknown'}
                  </span>
                  <span className={`confidence-badge ${conf.className}`} style={{ fontSize: 9 }}>
                    {conf.icon} {conf.shortLabel}
                  </span>
                </div>
                {h.time_window && (
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    ⏰ {formatTime(h.time_window.starts_at)} – {formatTime(h.time_window.clears_by)}
                  </div>
                )}
              </div>
            );
          })}

          {data.route_analysis && (
            <div className="text-[10px] text-amber-400/70 mt-1 px-1 italic">
              ⚠ {data.route_analysis.routing_method === 'straight_line_corridor'
                ? 'Straight-line corridor analysis — not turn-by-turn routing'
                : data.route_analysis.disclaimer}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ChatPanel({ isOpen, onClose, onRouteSelect }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Hi! I\'m FloodCast Gurugram. Ask me about flood risk at any location or along a route.\n\nTry: "Is IFFCO Chowk risky right now?" or "Is it safe from Sector 49 to Cyber City?"',
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const response = await api.chat(trimmed);
      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: response.verdict,
        timestamp: new Date(),
        data: response,
      };
      setMessages(prev => [...prev, assistantMsg]);
      
      if (response.route_analysis && onRouteSelect) {
        onRouteSelect(response.route_analysis);
      }
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: '⚠ Unable to reach the server. The backend may be cold-starting — try again in 30 seconds.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Mobile overlay */}
      <div className="fixed inset-0 bg-black/60 z-40 md:hidden" style={{ backdropFilter: 'blur(8px)' }} onClick={onClose} />

      <div className="
        fixed md:absolute z-50 md:z-10
        bottom-4 left-4 right-4 h-[70vh]
        md:right-3 md:left-auto md:top-3 md:bottom-3 md:h-auto md:w-[360px]
        sidebar rounded-2xl flex flex-col overflow-hidden shadow-2xl
      ">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0" style={{ borderColor: 'var(--border-default)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <span className="text-sm">💬</span>
            </div>
            <div>
              <h2 className="text-xs font-bold text-white">Route AI</h2>
              <p className="text-[10px] text-zinc-500">Ask about routes & risks</p>
            </div>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer">
            ✕
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : 'bg-zinc-800 text-zinc-200 rounded-bl-sm border border-zinc-700/50 leading-relaxed'
              }`}>
                <div className="whitespace-pre-wrap font-medium">{msg.content}</div>
                {msg.data && <VerdictDetails data={msg.data} />}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-zinc-800 rounded-2xl rounded-bl-sm border border-zinc-700/50 px-2">
                <TypingIndicator />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-3 border-t shrink-0" style={{ borderColor: 'var(--border-default)' }}>
          <div className="flex gap-2">
            <input ref={inputRef} type="text" value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Ask: 'is Sector 50 safe?'…"
              disabled={loading}
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 disabled:opacity-50" />
            <button onClick={handleSend} disabled={loading || !input.trim()}
              className="w-9 h-9 flex items-center justify-center bg-blue-600 hover:bg-blue-500 disabled:opacity-30 text-white rounded-lg text-sm font-bold transition-colors shrink-0 cursor-pointer">
              →
            </button>
          </div>
          <p className="text-[10px] text-zinc-600 text-center mt-2 mono">Try: "from Sector 49 to Sector 14"</p>
        </div>
      </div>
    </>
  );
}
