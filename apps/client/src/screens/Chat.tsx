import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { closeChat, openChats, subscribeChats, toggleMinimized, type OpenChat } from '../dms';
import { fetchMessages, reportMessage, sendMessage, type DirectMessage } from '../net/api';
import { refreshSocial } from '../social';
import { profile } from '../store';
import { sound } from '../util';
import { t } from '../i18n';
import { Icon } from './Icons';

const MAX = 300;
const POLL_MS = 4000;

export function useOpenChats(): OpenChat[] {
  const [, force] = useState(0);
  useEffect(() => subscribeChats(() => force((n) => n + 1)), []);
  return openChats();
}

function timeText(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function dayText(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** One conversation: messages, a box to write in, and buttons to minimize or close it. */
export function ChatWindow({ chat, online }: { chat: OpenChat; online: boolean }) {
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [reported, setReported] = useState<Set<string>>(new Set());
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const input = useRef<HTMLInputElement>(null);

  // Merges new messages in, keeping order and dropping repeats.
  const merge = (incoming: DirectMessage[]) => {
    setMessages((old) => {
      const byId = new Map(old.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, m);
      return [...byId.values()].sort((a, b) => a.at - b.at);
    });
  };

  const refresh = async (first = false) => {
    const r = await fetchMessages(chat.name);
    if (r.data) {
      const before = messages.length;
      merge(r.data.messages);
      if (first) setMore(r.data.more);
      // A new message from them makes a soft sound, unless this is the first load.
      if (!first && r.data.messages.some((m) => !m.mine && !messages.some((x) => x.id === m.id)) && before > 0) sound('chatReceive', profile.muted);
      setError('');
    } else if (r.error) setError(r.error);
    if (first) setLoading(false);
  };

  useEffect(() => {
    void refresh(true).then(() => refreshSocial());
  }, [chat.name]);

  // Keeps checking for replies while the chat is open and the page is visible.
  useEffect(() => {
    if (chat.minimized) return;
    const t = setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [chat.name, chat.minimized, messages.length]);

  // Stays scrolled to the newest message, unless the player scrolled up to read.
  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, chat.minimized]);

  const loadOlder = async () => {
    const oldest = messages[0];
    if (!oldest) return;
    const el = list.current;
    const height = el?.scrollHeight ?? 0;
    const r = await fetchMessages(chat.name, oldest.at);
    if (r.data) {
      stick.current = false;
      merge(r.data.messages);
      setMore(r.data.more);
      // Keep the view where it was after older messages appear above.
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - height;
      });
    }
  };

  const send = async (e: Event) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setNote('');
    const r = await sendMessage(chat.name, body);
    setSending(false);
    if (r.error) {
      setError(r.error);
      sound('error', profile.muted);
      return;
    }
    sound('chatSend', profile.muted);
    setError('');
    setText('');
    stick.current = true;
    merge([r.data!]);
    if (r.data!.text !== body) setNote('Some words were hidden by the chat filter.');
    sound('click', profile.muted);
    input.current?.focus();
  };

  const report = async (m: DirectMessage) => {
    const r = await reportMessage(m.id);
    if (r.error) return setError(r.error);
    setReported(new Set([...reported, m.id]));
    setNote(r.data?.message ?? 'Reported.');
  };

  const lastMine = [...messages].reverse().find((m) => m.mine);
  let lastDay = '';
  return (
    <section class={`chat-window ${chat.minimized ? 'min' : ''}`} aria-label={`Chat with ${chat.name}`}>
      <header class="chat-head">
        <span class={`chat-title ${online ? 'on' : ''}`}>
          <i class="dot" aria-hidden="true" />
          <strong>{chat.name}</strong>
          <small class="muted">{online ? 'Online' : 'Offline'}</small>
        </span>
        <span class="chat-controls">
          <button class="small plain" aria-label={chat.minimized ? `Open chat with ${chat.name}` : `Minimize chat with ${chat.name}`} aria-expanded={!chat.minimized} onClick={() => toggleMinimized(chat.name)}>
            <Icon name={chat.minimized ? 'chevronUp' : 'chevronDown'} />
          </button>
          <button class="small plain" aria-label={`Close chat with ${chat.name}`} onClick={() => closeChat(chat.name)}><Icon name="close" /></button>
        </span>
      </header>
      {!chat.minimized && (
        <>
          <div
            class="chat-log"
            ref={list}
            role="log"
            aria-live="polite"
            aria-label={`Messages with ${chat.name}`}
            onScroll={(e) => {
              const el = e.currentTarget as HTMLDivElement;
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
          >
            {loading ? <p class="muted small-note">{t('ui.loadingMessages')}</p> : messages.length === 0 ? (
              <p class="muted small-note chat-empty">{t('ui.noMessagesYetSayHiMessages')}</p>
            ) : (
              <>
                {more && <button class="small plain chat-older" onClick={() => void loadOlder()}>{t('ui.showOlderMessages')}</button>}
                {messages.map((m) => {
                  const day = dayText(m.at);
                  const showDay = day !== lastDay;
                  lastDay = day;
                  return (
                    <>
                      {showDay && <p class="chat-day">{day}</p>}
                      <div class={`chat-msg ${m.mine ? 'mine' : 'theirs'}`}>
                        <p class="chat-bubble">{m.text}</p>
                        <small class="chat-meta">
                          {timeText(m.at)}
                          {m.mine && m.id === lastMine?.id && m.seen && ' · Seen'}
                          {!m.mine && (reported.has(m.id)
                            ? ' · Reported'
                            : <> · <button class="plain chat-report" onClick={() => void report(m)}>{t('ui.report')}</button></>)}
                        </small>
                      </div>
                    </>
                  );
                })}
              </>
            )}
          </div>
          <form class="chat-send" onSubmit={(e) => void send(e)}>
            <input
              ref={input}
              type="text"
              value={text}
              maxLength={MAX}
              placeholder={`Message ${chat.name}`}
              aria-label={`Message ${chat.name}`}
              autocomplete="off"
              onInput={(e) => setText((e.target as HTMLInputElement).value)}
            />
            <button class="small primary" type="submit" disabled={sending || !text.trim()}>{t('ui.send')}</button>
          </form>
          <p class="chat-foot">
            <span class={error ? 'error' : 'muted'}>{error || note || ' '}</span>
            <span class={`muted ${text.length > MAX - 30 ? 'warn' : ''}`}>{text.length}/{MAX}</span>
          </p>
        </>
      )}
    </section>
  );
}
