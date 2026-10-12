"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "../lib/supabase";
import { createLocalIdentity, decryptForRecipient, encryptForRecipients, fingerprintPublicKey, loadLocalIdentity } from "../lib/e2ee";
import { ArrowDownLeft, ArrowUpRight, Check, Copy, LogOut, MessageCircle, Plus, Send, ShieldCheck, Sparkles, Users, X } from "lucide-react";

const shortId = (value = "") => value.length > 15 ? value.slice(0, 8) + "…" + value.slice(-5) : value;
const time = (value) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function ChatPage() {
  const [supabase] = useState(() => getSupabase());
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [rooms, setRooms] = useState([]);
  const [roomId, setRoomId] = useState("");
  const [roomTitle, setRoomTitle] = useState("");
  const [joinId, setJoinId] = useState("");
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [liveDrafts, setLiveDrafts] = useState({});
  const [typingUsers, setTypingUsers] = useState({});
  const [shareDraft, setShareDraft] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copyDone, setCopyDone] = useState(false);
  const [identity, setIdentity] = useState(null);
  const [keyStatus, setKeyStatus] = useState("loading");
  const [roomCrypto, setRoomCrypto] = useState(null);
  const [showKeyInfo, setShowKeyInfo] = useState(false);
  const [fingerprints, setFingerprints] = useState({});
  const bottomRef = useRef(null);
  const channelRef = useRef(null);
  const draftTimer = useRef(null);
  const draftClearTimer = useRef(null);
  const lastBroadcast = useRef("");
  const roomIdRef = useRef("");
  const userId = session?.user?.id;

  const loadRooms = useCallback(async (userIdValue) => {
    if (!supabase || !userIdValue) return;
    const { data, error } = await supabase
      .from("conversation_members")
      .select("conversation_id, conversations(id, title, created_at)")
      .eq("user_id", userIdValue);
    if (error) { setNotice(error.message); return; }
    const list = (data || []).map((row) => row.conversations).filter(Boolean);
    setRooms(list);
    if (!roomIdRef.current && list[0]) {
      setRoomId(list[0].id);
      roomIdRef.current = list[0].id;
    }
  }, [supabase]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.user) loadRooms(nextSession.user.id);
      else { setRooms([]); setRoomId(""); roomIdRef.current = ""; }
    });
    return () => listener.subscription.unsubscribe();
  }, [supabase, loadRooms]);

  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);

  useEffect(() => {
    if (!supabase || !userId) { setIdentity(null); setKeyStatus("loading"); return; }
    let cancelled = false;
    setIdentity(null);
    setKeyStatus("loading");
    (async () => {
      const localIdentity = await loadLocalIdentity(userId);
      const { data: remote, error } = await supabase.from("user_keys").select("public_key").eq("user_id", userId).maybeSingle();
      if (error) throw error;
      let current = localIdentity;
      if (localIdentity) {
        if (remote && (remote.public_key?.x !== localIdentity.publicKeyJwk.x || remote.public_key?.y !== localIdentity.publicKeyJwk.y)) {
          throw new Error("This device's private key does not match the account's published key. To protect old messages, the key was not replaced. Restore the original device key to continue.");
        }
        if (!remote) {
          const { error: publishError } = await supabase.from("user_keys").insert({ user_id: userId, public_key: localIdentity.publicKeyJwk });
          if (publishError) throw publishError;
        }
      } else if (remote) {
        throw new Error("This account already has an encryption key on another device. Key recovery or a secure device-transfer flow is needed. This device will not overwrite it.");
      } else {
        current = await createLocalIdentity(userId);
        const { error: publishError } = await supabase.from("user_keys").insert({ user_id: userId, public_key: current.publicKeyJwk });
        if (publishError) throw publishError;
      }
      if (!cancelled) { setIdentity(current); setKeyStatus("ready"); }
    })().catch((error) => {
      if (!cancelled) { setKeyStatus("error"); setNotice("Encryption setup failed: " + (error?.message || "Unknown error")); }
    });
    return () => { cancelled = true; };
  }, [supabase, userId]);

  useEffect(() => {
    if (!supabase || !userId) return;
    loadRooms(userId);
  }, [supabase, userId, loadRooms]);

  useEffect(() => {
    if (!supabase || !userId || !roomId || keyStatus !== "ready" || !identity) { setRoomCrypto(null); return; }
    let cancelled = false;
    (async () => {
      const { data: members, error: memberError } = await supabase.from("conversation_members").select("user_id").eq("conversation_id", roomId);
      if (memberError) throw memberError;
      const memberIds = [...new Set((members || []).map((row) => row.user_id))];
      if (!memberIds.includes(userId)) throw new Error("You are not a member of this conversation.");
      const { data: keys, error: keysError } = await supabase.from("user_keys").select("user_id, public_key").in("user_id", memberIds);
      if (keysError) throw keysError;
      const publicKeys = Object.fromEntries((keys || []).map((row) => [row.user_id, row.public_key]));
      if (memberIds.some((id) => !publicKeys[id])) throw new Error("A participant has not set up an encryption key yet. Ask them to sign in and open the chat.");
      if (!cancelled) setRoomCrypto({ roomId, memberIds, publicKeys });
    })().catch((error) => {
      if (!cancelled) { setRoomCrypto(null); setNotice("Conversation encryption unavailable: " + (error?.message || "Unknown error")); }
    });
    return () => { cancelled = true; };
  }, [supabase, userId, roomId, identity, keyStatus]);

  useEffect(() => {
    let cancelled = false;
    if (!roomCrypto) { setFingerprints({}); return; }
    Promise.all(Object.entries(roomCrypto.publicKeys).map(async ([id, key]) => [id, await fingerprintPublicKey(key)]))
      .then((entries) => { if (!cancelled) setFingerprints(Object.fromEntries(entries)); })
      .catch(() => { if (!cancelled) setFingerprints({}); });
    return () => { cancelled = true; };
  }, [roomCrypto]);

  const broadcastDraft = useCallback(async (text) => {
    const channel = channelRef.current;
    if (!channel || !userId) return;
    if (!shareDraft || !text.trim()) {
      channel.send({ type: "broadcast", event: "draft-clear", payload: { userId } });
      channel.send({ type: "broadcast", event: "typing", payload: { userId, active: false } });
      return;
    }
    if (!identity || !roomCrypto || roomCrypto.roomId !== roomId) return;
    try {
      const encryptedDraft = await encryptForRecipients({
        text, roomId, senderId: userId, recipientIds: roomCrypto.memberIds,
        privateKey: identity.privateKey, publicKeyJwk: identity.publicKeyJwk, publicKeys: roomCrypto.publicKeys,
      });
      if (channelRef.current !== channel) return;
      channel.send({ type: "broadcast", event: "draft", payload: { userId, encryptedDraft, name: session?.user?.email?.split("@")[0] || "Someone", updatedAt: Date.now() } });
      channel.send({ type: "broadcast", event: "typing", payload: { userId, name: session?.user?.email?.split("@")[0] || "Someone", active: true } });
    } catch (error) { setNotice("Could not encrypt live draft: " + (error?.message || "Unknown error")); }
  }, [userId, shareDraft, session, identity, roomCrypto, roomId]);

  useEffect(() => {
    if (!supabase || !userId || !roomId || keyStatus !== "ready" || !identity || !roomCrypto || roomCrypto.roomId !== roomId) { setMessages([]); setLiveDrafts({}); return; }
    let alive = true;
    setMessages([]);
    setLiveDrafts({});
    const loadMessages = async () => {
      const { data, error } = await supabase.from("messages").select("id, conversation_id, user_id, encrypted_payload, created_at").eq("conversation_id", roomId).order("created_at", { ascending: true }).limit(300);
      if (!alive) return;
      if (error) { setNotice(error.message); return; }
      const decoded = await Promise.all((data || []).map(async (row) => {
        try {
          const body = await decryptForRecipient({ envelope: row.encrypted_payload, roomId, senderId: row.user_id, recipientId: userId, privateKey: identity.privateKey, expectedSenderPublicKey: roomCrypto.publicKeys[row.user_id] });
          return { ...row, body, decryptError: false };
        } catch { return { ...row, body: "Unable to decrypt this message on this device.", decryptError: true }; }
      }));
      if (alive) setMessages(decoded);
    };
    loadMessages();
    const channel = supabase.channel("chat:" + roomId, { config: { private: true, broadcast: { self: false, ack: true }, presence: { key: userId } } });
    channel
      .on("broadcast", { event: "draft" }, async ({ payload }) => {
        if (!payload?.userId || payload.userId === userId || !payload.encryptedDraft || !identity) return;
        try {
          const text = await decryptForRecipient({ envelope: payload.encryptedDraft, roomId, senderId: payload.userId, recipientId: userId, privateKey: identity.privateKey, expectedSenderPublicKey: roomCrypto.publicKeys[payload.userId] });
          setLiveDrafts((current) => ({ ...current, [payload.userId]: { text, name: payload.name || "Someone", updatedAt: payload.updatedAt || Date.now() } }));
        } catch {
          setLiveDrafts((current) => { const next = { ...current }; delete next[payload.userId]; return next; });
        }
      })
      .on("broadcast", { event: "draft-clear" }, ({ payload }) => {
        if (payload?.userId) setLiveDrafts((current) => { const next = { ...current }; delete next[payload.userId]; return next; });
      })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (!payload?.userId || payload.userId === userId) return;
        setTypingUsers((current) => ({ ...current, [payload.userId]: { name: payload.name || "Someone", active: !!payload.active, at: Date.now() } }));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: "conversation_id=eq." + roomId }, async ({ new: row }) => {
        try {
          const body = await decryptForRecipient({ envelope: row.encrypted_payload, roomId, senderId: row.user_id, recipientId: userId, privateKey: identity.privateKey, expectedSenderPublicKey: roomCrypto.publicKeys[row.user_id] });
          setMessages((current) => current.some((message) => message.id === row.id) ? current : [...current, { ...row, body }]);
        } catch {
          setMessages((current) => current.some((message) => message.id === row.id) ? current : [...current, { ...row, body: "Unable to decrypt this message on this device.", decryptError: true }]);
        }
        setLiveDrafts((current) => { const next = { ...current }; delete next[row.user_id]; return next; });
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setNotice("Realtime connection issue. Check Realtime authorization and try again.");
      });
    channelRef.current = channel;
    return () => {
      alive = false;
      if (draftTimer.current) clearTimeout(draftTimer.current);
      if (draftClearTimer.current) clearTimeout(draftClearTimer.current);
      channel.send({ type: "broadcast", event: "draft-clear", payload: { userId } });
      supabase.removeChannel(channel);
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [supabase, userId, roomId, identity, keyStatus, roomCrypto]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - 12000;
      setLiveDrafts((current) => Object.fromEntries(Object.entries(current).filter(([, item]) => item.updatedAt > cutoff)));
      setTypingUsers((current) => Object.fromEntries(Object.entries(current).filter(([, item]) => item.at > cutoff && item.active)));
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  const sendDraftUpdate = (value) => {
    setDraft(value);
    if (!channelRef.current) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      if (value.trim()) {
        broadcastDraft(value);
      } else {
        broadcastDraft("");
      }
    }, 75);
  };

  const sendMessage = async (event) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !supabase || !roomId || busy) return;
    if (keyStatus !== "ready" || !identity || !roomCrypto || roomCrypto.roomId !== roomId) {
      setNotice("End-to-end encryption is not ready for this conversation yet.");
      return;
    }
    setBusy(true);
    try {
      const encrypted_payload = await encryptForRecipients({
        text: body, roomId, senderId: userId, recipientIds: roomCrypto.memberIds,
        privateKey: identity.privateKey, publicKeyJwk: identity.publicKeyJwk, publicKeys: roomCrypto.publicKeys,
      });
      const { data, error } = await supabase.from("messages").insert({ conversation_id: roomId, user_id: userId, encrypted_payload }).select("id, conversation_id, user_id, encrypted_payload, created_at").single();
      if (error) throw error;
      setMessages((current) => current.some((item) => item.id === data.id) ? current : [...current, { ...data, body }]);
      setDraft("");
      await broadcastDraft("");
      channelRef.current?.send({ type: "broadcast", event: "draft-clear", payload: { userId } });
      channelRef.current?.send({ type: "broadcast", event: "typing", payload: { userId, active: false } });
    } catch (error) {
      setNotice("Message was not sent: " + (error?.message || "Encryption or database error"));
    } finally { setBusy(false); }
  };

  const signIn = async (event) => {
    event.preventDefault();
    if (!supabase || !email.trim()) return;
    setAuthBusy(true); setNotice("");
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.origin } });
    setAuthBusy(false);
    setNotice(error ? error.message : "Magic link sent. Check your email to sign in.");
  };

  const createRoom = async (event) => {
    event.preventDefault();
    if (!supabase || !roomTitle.trim()) return;
    setBusy(true); setNotice("");
    const { data, error } = await supabase.rpc("create_conversation", { p_title: roomTitle.trim() });
    setBusy(false);
    if (error) { setNotice(error.message); return; }
    setRoomTitle("");
    await loadRooms(userId);
    const id = typeof data === "string" ? data : data?.id;
    if (id) { setRoomId(id); roomIdRef.current = id; }
  };

  const joinRoom = async (event) => {
    event.preventDefault();
    if (!supabase || !joinId.trim()) return;
    setBusy(true); setNotice("");
    const { data, error } = await supabase.rpc("join_conversation", { p_conversation_id: joinId.trim() });
    setBusy(false);
    if (error) { setNotice(error.message); return; }
    await loadRooms(userId);
    const id = typeof data === "string" ? data : joinId.trim();
    setRoomId(id); roomIdRef.current = id; setJoinId("");
  };

  const chooseRoom = (id) => { setRoomId(id); roomIdRef.current = id; setDraft(""); setLiveDrafts({}); };
  const signOut = async () => { await supabase?.auth.signOut(); setSession(null); };

  if (!supabase) return <main className="app-shell"><Background /><section className="setup-card"><div className="brand-mark"><MessageCircle size={24}/></div><p className="eyebrow">REALTIME / PRIVATE BY DESIGN</p><h1>Make every word<br/><span>feel immediate.</span></h1><p className="muted">Add your Supabase project keys to connect the chat. Live draft sharing is ephemeral and only sent to the active room.</p><div className="setup-code">NEXT_PUBLIC_SUPABASE_URL<br/>NEXT_PUBLIC_SUPABASE_ANON_KEY</div><a className="primary-button" href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">Open Supabase <ArrowUpRight size={16}/></a></section></main>;

  if (!session) return <main className="app-shell"><Background /><section className="auth-card"><div className="brand-mark"><MessageCircle size={23}/></div><p className="eyebrow">NAAZZ / REALTIME CHAT</p><h1>Words, before<br/><span>they're sent.</span></h1><p className="muted">Sign in with a magic link. Share the draft as you write, or keep it to yourself.</p><form onSubmit={signIn} className="auth-form"><label htmlFor="email">Your email</label><input id="email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required/><button className="primary-button" disabled={authBusy}>{authBusy ? "Sending link…" : "Send magic link"} <ArrowUpRight size={16}/></button></form>{notice && <p className="notice">{notice}</p>}<p className="tiny-note"><ShieldCheck size={14}/> Drafts aren't saved as messages.</p></section></main>;

  return <main className="app-shell"><Background />
    <div className="chat-layout">
      <aside className="sidebar glass-panel">
        <div className="sidebar-head"><div className="brand-mark small"><MessageCircle size={19}/></div><div><p className="eyebrow">NAAZZ / CHAT</p><h2>Conversations</h2></div><button className="icon-button logout" title="Sign out" onClick={signOut}><LogOut size={17}/></button></div>
        <form className="create-room" onSubmit={createRoom}><input aria-label="New room name" placeholder="Name a new room…" value={roomTitle} onChange={(e)=>setRoomTitle(e.target.value)} maxLength={60}/><button className="icon-button accent" title="Create room" disabled={busy || !roomTitle.trim()}><Plus size={18}/></button></form>
        <form className="join-room" onSubmit={joinRoom}><input aria-label="Invite room ID" placeholder="Paste room invite ID…" value={joinId} onChange={(e)=>setJoinId(e.target.value)} /><button className="text-button" disabled={busy || !joinId.trim()}>Join</button></form>
        <div className="room-list">{rooms.map((room)=><button key={room.id} className={"room-item " + (room.id === roomId ? "active" : "")} onClick={()=>chooseRoom(room.id)}><span className="room-avatar"><Users size={16}/></span><span className="room-copy"><strong>{room.title}</strong><small>{shortId(room.id)}</small></span>{room.id===roomId&&<span className="online-dot"/>}</button>)}{!rooms.length&&<p className="empty-side">Create a room, then share its invite ID with someone you trust.</p>}</div>
        <div className="profile-row"><div className="profile-avatar">{(session.user.email||"U").slice(0,1).toUpperCase()}</div><div className="profile-copy"><strong>{session.user.email}</strong><small>Authenticated session</small></div></div>
      </aside>
      <section className="conversation glass-panel">
        <header className="conversation-head"><div className="room-avatar large"><Users size={18}/></div><div className="conversation-title"><h2>{rooms.find((r)=>r.id===roomId)?.title || "Choose a conversation"}</h2><p><span className="online-dot"/> <ShieldCheck size={12}/> {keyStatus === "ready" && roomCrypto?.roomId === roomId ? "End-to-end encrypted" : keyStatus === "error" ? "Encryption needs attention" : "Preparing encryption keys"}</p></div><div className="head-actions"><button className={"share-toggle " + (shareDraft ? "enabled" : "")} onClick={()=>{setShareDraft((value)=>!value); if(shareDraft) broadcastDraft("");}} title="Toggle sharing live draft text"><span className="toggle-dot"/>{shareDraft ? "Live text on" : "Live text off"}</button><button className="icon-button" title="Encryption key fingerprints" disabled={!roomId || keyStatus!=="ready" || roomCrypto?.roomId!==roomId} onClick={()=>setShowKeyInfo((value)=>!value)}><ShieldCheck size={16}/></button><button className="icon-button" title="Copy invite ID" disabled={!roomId} onClick={()=>{navigator.clipboard?.writeText(roomId);setCopyDone(true);setTimeout(()=>setCopyDone(false),1400);}}>{copyDone?<Check size={16}/>:<Copy size={16}/>}</button></div></header>
        {showKeyInfo && roomCrypto?.roomId===roomId && <div className="key-info-panel"><div className="key-info-title"><ShieldCheck size={16}/> End-to-end encryption keys</div><p>Compare each fingerprint with that participant through a separate trusted channel. This helps detect a substituted public key.</p>{Object.entries(fingerprints).map(([id, fingerprint])=><div className="fingerprint-row" key={id}><strong>{id===userId?"You":shortId(id)}</strong><code>{fingerprint || "Calculating fingerprint…"}</code></div>)}</div>}
        <div className="message-feed">
          {!roomId ? <div className="welcome-state"><div className="welcome-orb"><Sparkles size={24}/></div><h3>A room for your words.</h3><p>Create a room or join one using an invite ID. Share the ID only with the person you want in the conversation.</p></div> : !messages.length && !Object.keys(liveDrafts).length ? <div className="welcome-state"><div className="welcome-orb"><MessageCircle size={24}/></div><h3>Start something real.</h3><p>Messages are saved. Draft previews are temporary and appear only while the other person is writing.</p></div> : null}
          {messages.map((message)=><div key={message.id} className={"message-row " + (message.user_id===userId?"mine":"theirs")}><div className={"message-bubble " + (message.decryptError ? "decrypt-error" : "")}><p>{message.body}</p><span><ShieldCheck size={11}/> {message.user_id===userId?"You":shortId(message.user_id)} · {time(message.created_at)}</span></div></div>)}
          {Object.entries(liveDrafts).map(([id, item])=><div key={"draft-"+id} className="message-row theirs"><div className="live-draft-bubble"><div className="draft-label"><span className="typing-dots"><i/><i/><i/></span>{item.name} is writing <span className="live-pill">LIVE DRAFT</span></div><p>{item.text}</p></div></div>)}
          {Object.entries(typingUsers).filter(([id, item]) => item.active && !liveDrafts[id]).map(([id, item])=><div key={"typing-"+id} className="message-row theirs"><div className="typing-indicator"><span className="typing-dots"><i/><i/><i/></span>{item.name} is typing…</div></div>)}
          <div ref={bottomRef}/>
        </div>
        {notice && <div className="notice-bar" role="status">{notice}<button onClick={()=>setNotice("")} aria-label="Dismiss"><X size={14}/></button></div>}
        <form className="composer" onSubmit={sendMessage}><div className="composer-inner"><textarea aria-label="Write a message" placeholder={roomId ? "Write something… they'll see it live if sharing is on" : "Choose a room first"} value={draft} onChange={(e)=>sendDraftUpdate(e.target.value)} disabled={!roomId} rows={1} maxLength={4000} onKeyDown={(e)=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage(e);}}}/><button className="send-button" type="submit" disabled={!draft.trim()||busy||!roomId||keyStatus!=="ready"||roomCrypto?.roomId!==roomId} aria-label="Send message"><Send size={17}/></button></div><div className="composer-footer"><span>{shareDraft?"Live draft sharing is enabled":"Only your sent messages are shared"} · Enter to send · Shift+Enter for newline</span><span>{draft.length}/4000</span></div></form>
      </section>
    </div>
  </main>;
}

function Background() {
  return <div className="ambient-background" aria-hidden="true"><div className="ambient-photo"/><div className="ambient-wash"/><div className="ambient-glow glow-cyan"/><div className="ambient-glow glow-violet"/><div className="ambient-grid"/></div>;
}
