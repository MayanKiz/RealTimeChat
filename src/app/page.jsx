"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, Copy, LogOut, MessageCircle, Search, Send, Sparkles, UserRound, X } from "lucide-react";

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
const time = (value) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function ChatPage() {
  const [user, setUser] = useState(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [contactCode, setContactCode] = useState("");
  const [chats, setChats] = useState([]);
  const [chatId, setChatId] = useState("");
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [copyDone, setCopyDone] = useState(false);
  const cursorRef = useRef(null);
  const bottomRef = useRef(null);
  const userId = user?.id;
  const activeChat = chats.find((chat) => chat.id === chatId);

  const enterFullscreen = () => {
    if (document.fullscreenElement) return;
    document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const loadChats = useCallback(async () => {
    if (!userId) return;
    const data = await api("/api/chats");
    setChats(data.chats);
    if (!chatId && data.chats[0]) setChatId(data.chats[0].id);
  }, [userId, chatId]);

  useEffect(() => { api("/api/auth/session").then((data) => setUser(data.user)).catch(() => {}); }, []);
  useEffect(() => { if (userId) loadChats(); }, [userId, loadChats]);

  useEffect(() => {
    if (!userId || !chatId) { setMessages([]); return; }
    let stopped = false;
    cursorRef.current = null;
    setMessages([]);
    const poll = async () => {
      try {
        const query = cursorRef.current ? `?cursor=${cursorRef.current}` : "";
        const data = await api(`/api/chats/${chatId}/messages${query}`);
        if (!stopped) {
          setMessages((current) => {
            const seen = new Set(current.map((item) => item.id));
            return [...current, ...data.messages.filter((item) => !seen.has(item.id))];
          });
          cursorRef.current = data.nextCursor || cursorRef.current;
        }
      } catch (error) { if (!stopped) setNotice(error.message); }
    };
    poll();
    const timer = setInterval(poll, 2200);
    return () => { stopped = true; clearInterval(timer); };
  }, [userId, chatId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  const enter = async (event) => {
    event.preventDefault();
    setBusy(true); setNotice(""); enterFullscreen();
    try { const data = await api("/api/auth/code", { method: "POST", body: JSON.stringify({ name, code }) }); setUser(data.user); }
    catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  };

  const startChat = async (event) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(contactCode)) return setNotice("Enter a 6-digit code.");
    setBusy(true); setNotice("");
    try { const data = await api("/api/chats", { method: "POST", body: JSON.stringify({ code: contactCode }) }); setContactCode(""); await loadChats(); setChatId(data.chat.id); }
    catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  };

  const sendMessage = async (event) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !chatId || busy) return;
    setBusy(true);
    try { const data = await api(`/api/chats/${chatId}/messages`, { method: "POST", body: JSON.stringify({ body }) }); setMessages((current) => [...current, data.message]); setDraft(""); cursorRef.current = data.message.id; }
    catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  };

  const logout = async () => { await api("/api/auth/logout", { method: "POST" }); setUser(null); setChats([]); setChatId(""); };
  const copyCode = () => { navigator.clipboard?.writeText(user?.contact_code || ""); setCopyDone(true); setTimeout(() => setCopyDone(false), 1400); };

  if (!user) return <main className="liquid-app"><Ambient /><section className="entry-card glass-card" onPointerDown={enterFullscreen}><div className="logo-orb"><MessageCircle size={28} /></div><p className="kicker">NAAZZ / SIMPLE CHAT</p><h1>Talk without<br /><em>the noise.</em></h1><p className="entry-copy">Write your name and a six-digit code. That is all you need to enter.</p><form onSubmit={enter} className="entry-form"><label>Your name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Mayank" maxLength={40} required autoFocus /></label><label>Your 6-digit code<input inputMode="numeric" pattern="[0-9]{6}" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" maxLength={6} required /></label><button className="primary-button" disabled={busy}>{busy ? "Opening…" : "Enter chat"}<ArrowUpRight size={17} /></button></form>{notice && <Notice text={notice} clear={() => setNotice("")} />}<p className="quiet-note"><Sparkles size={14} /> First click opens fullscreen chat</p></section></main>;

  return <main className="liquid-app"><Ambient /><div className="chat-shell glass-card"><aside className="chat-sidebar"><div className="sidebar-brand"><div className="mini-orb"><MessageCircle size={18} /></div><div><p className="kicker">NAAZZ / CHAT</p><strong>Messages</strong></div><button className="icon-button" onClick={logout} title="Sign out"><LogOut size={16} /></button></div><form className="new-chat" onSubmit={startChat}><input inputMode="numeric" value={contactCode} onChange={(event) => setContactCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="Enter 6-digit code" maxLength={6} aria-label="Contact code" /><button type="submit" disabled={busy || contactCode.length !== 6} title="Start chat"><Search size={17} /></button></form><div className="your-code"><span>Your code</span><button onClick={copyCode}>{copyDone ? <Check size={14} /> : <Copy size={14} />} {user.contact_code}</button></div><div className="chat-list">{chats.map((chat) => <button key={chat.id} className={`chat-preview ${chat.id === chatId ? "selected" : ""}`} onClick={() => setChatId(chat.id)}><div className="contact-avatar">{(chat.contact_name || "?").slice(0, 1).toUpperCase()}</div><div><strong>{chat.contact_name || "Contact"}</strong><small>{chat.contact_code}</small></div><span className="status-dot" /></button>)}{!chats.length && <div className="empty-list"><UserRound size={21} /><span>Start a chat with<br />someone's 6-digit code.</span></div>}</div><div className="profile"><div className="contact-avatar">{(user.display_name || "?").slice(0, 1).toUpperCase()}</div><div><strong>{user.display_name}</strong><small>Available to chat</small></div></div></aside><section className="conversation"><header className="conversation-head">{activeChat ? <><div className="contact-avatar large">{(activeChat.contact_name || "?").slice(0, 1).toUpperCase()}</div><div><h2>{activeChat.contact_name}</h2><p><span className="status-dot" /> Code {activeChat.contact_code}</p></div></> : <div><h2>Choose a chat</h2><p>Use a six-digit code to connect</p></div>}</header><div className="message-feed">{!activeChat && <div className="welcome"><div className="welcome-orb"><Sparkles size={24} /></div><h3>Your space for real conversations.</h3><p>Enter a friend's six-digit code to begin.</p></div>}{activeChat && !messages.length && <div className="welcome"><div className="welcome-orb"><MessageCircle size={24} /></div><h3>Say hello to {activeChat.contact_name}.</h3><p>Your first message is waiting.</p></div>}{messages.map((message) => <div key={message.id} className={`message-row ${message.user_id === userId ? "mine" : "theirs"}`}><div className="message-bubble"><p>{message.body}</p><span>{message.user_id === userId ? "You" : activeChat?.contact_name} · {time(message.created_at)}</span></div></div>)}<div ref={bottomRef} /></div>{notice && <Notice text={notice} clear={() => setNotice("")} />}<form className="composer" onSubmit={sendMessage}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} disabled={!activeChat} placeholder={activeChat ? "Write a message…" : "Choose a chat first"} rows={1} maxLength={4000} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(event); } }} /><button className="send-button" type="submit" disabled={!draft.trim() || !activeChat || busy}><Send size={18} /></button></form></section></div></main>;
}
function Notice({ text, clear }) { return <div className="notice-bar">{text}<button onClick={clear} aria-label="Dismiss"><X size={14} /></button></div>; }
function Ambient() { return <div className="ambient" aria-hidden="true"><div className="ambient-shape shape-a" /><div className="ambient-shape shape-b" /><div className="ambient-shape shape-c" /><div className="ambient-grain" /></div>; }
