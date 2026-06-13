import { useEffect, useRef, useState } from 'react';
import { clearStoredPassword, fetchMeta, fetchThesisAnchors, getStoredPassword } from './api';
import { fetchFigures, FigureEntry } from './figures';
import { Chat } from './components/Chat';
import { Gallery } from './components/Gallery';
import { Landing } from './components/Landing';
import { PasswordGate } from './components/PasswordGate';
import { PdfView } from './components/PdfView';
import { PendingPrompt, SiteMeta, ThesisAnchors } from './types';

type View = 'home' | 'chat' | 'pdf' | 'figures';

export function App() {
  const [password, setPassword] = useState<string | null>(getStoredPassword());
  const [view, setView] = useState<View>('home');
  const [meta, setMeta] = useState<SiteMeta | null>(null);
  const [anchors, setAnchors] = useState<ThesisAnchors | null>(null);
  const [figures, setFigures] = useState<FigureEntry[] | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<PendingPrompt | null>(null);
  const promptSeq = useRef(0);

  useEffect(() => {
    void fetchMeta().then(setMeta);
    void fetchThesisAnchors().then(setAnchors);
    void fetchFigures().then(setFigures);
  }, []);

  /** Enter the chat, optionally queueing a question from the landing page.
   *  The prompt lives here rather than in Chat so it survives the password
   *  gate: set before unlock, it fires once Chat mounts. */
  function openChat(prompt?: string) {
    if (prompt) setPendingPrompt({ text: prompt, seq: ++promptSeq.current });
    setView('chat');
  }

  function lock() {
    clearStoredPassword();
    setPassword(null);
    setView('home');
  }

  /** A 401 mid-conversation: forget the password but stay on the chat view,
   *  so the gate appears in place and the user re-unlocks where they were. */
  function expire() {
    clearStoredPassword();
    setPassword(null);
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setView('home')}>
          Thesis Companion
        </button>
        <nav className="tabs">
          <button className={view === 'home' ? 'tab active' : 'tab'} onClick={() => setView('home')}>
            Home
          </button>
          <button className={view === 'chat' ? 'tab active' : 'tab'} onClick={() => setView('chat')}>
            Chat
          </button>
          <button className={view === 'pdf' ? 'tab active' : 'tab'} onClick={() => setView('pdf')}>
            Thesis PDF
          </button>
          <button className={view === 'figures' ? 'tab active' : 'tab'} onClick={() => setView('figures')}>
            Figures
          </button>
        </nav>
        <span className="spacer" />
        <a
          className="ghost"
          href="/runs.csv"
          download
          title="Download the frozen W&B runs export (lean CSV: the exact data the agent queries)"
        >
          Runs CSV
        </a>
        {password && (
          <button
            className="ghost"
            onClick={lock}
            title="Forget the password in this browser session and return to the start page"
          >
            Lock
          </button>
        )}
      </header>
      {/* All panes stay mounted so switching views neither reloads the PDF
          nor drops the in-memory conversation. */}
      <main className="content">
        <div style={{ display: view === 'home' ? 'contents' : 'none' }}>
          <Landing
            meta={meta}
            onOpenChat={openChat}
            onOpenPdf={() => setView('pdf')}
            onOpenFigures={() => setView('figures')}
          />
        </div>
        <div style={{ display: view === 'chat' ? 'contents' : 'none' }}>
          {password ? (
            <Chat
              meta={meta}
              anchors={anchors}
              figures={figures}
              password={password}
              onAuthExpired={expire}
              pendingPrompt={pendingPrompt}
              onPromptConsumed={() => setPendingPrompt(null)}
            />
          ) : (
            <PasswordGate onUnlock={() => setPassword(getStoredPassword())} />
          )}
        </div>
        <div style={{ display: view === 'pdf' ? 'contents' : 'none' }}>
          <PdfView />
        </div>
        <div style={{ display: view === 'figures' ? 'contents' : 'none' }}>
          <Gallery figures={figures} />
        </div>
      </main>
    </div>
  );
}
