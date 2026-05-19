import React, { useState, useEffect, useRef } from 'react';
import { useLiveAPIContext } from './contexts/LiveAPIContext';
import { useLogStore, useTools, useSettings, useUI } from './lib/state';
import { AudioRecorder } from './lib/audio-recorder';
import ReactMarkdown from 'react-markdown';
import { Modality } from '@google/genai';
import { useVideoStream } from './hooks/use-video-stream';
import { LANGUAGES } from './lib/languages';
import { auth, db, handleFirestoreError, OperationType, initAuth, googleSignIn, getAccessToken } from './lib/firebase';
import firebaseConfig from './firebase-applet-config.json';
import { signInWithPopup, GoogleAuthProvider, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDocFromServer, setDoc } from 'firebase/firestore';
import { 
  User, ListChecks, Calendar, FolderOpen, Search, Signature, 
  Building2, Video, MessageSquare, Settings, Wrench, History, 
  Trash2, QrCode, MapPin, Brain, Presentation, Mail, Table, 
  FileStack, Paperclip, Send, Mic, Cast, X, Check, Save, RotateCcw,
  Plug, Lock, Pencil
} from 'lucide-react';
import { Scanner } from '@yudiel/react-qr-scanner';

function StreamingText({ text, isFinal }: { text: string; isFinal: boolean }) {
  const [displayedText, setDisplayedText] = useState(isFinal ? text : "");
  
  useEffect(() => {
    if (isFinal) {
      setDisplayedText(text);
      return;
    }

    const words = text.split(" ");
    const currentWords = displayedText.split(" ").filter(Boolean);
    
    if (currentWords.length < words.length) {
      const timeout = setTimeout(() => {
        setDisplayedText(words.slice(0, currentWords.length + 1).join(" "));
      }, 70);
      return () => clearTimeout(timeout);
    }
  }, [text, isFinal, displayedText]);

  return <span>{displayedText}</span>;
}

function LocationMap({ active }: { active: boolean }) {
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (active && !loc && !error) {
       navigator.geolocation.getCurrentPosition(
         pos => setLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
         err => setError('Unable to retrieve location.')
       );
    }
  }, [active, loc, error]);

  if (error) {
    return <div style={{ padding: 20 }}>{error}</div>;
  }

  if (!loc) {
    return <div style={{ padding: 20, textAlign: 'center' }}>Locating...</div>;
  }

  // Delta for embed bbox
  const delta = 0.05;
  const bbox = `${loc.lng - delta},${loc.lat - delta},${loc.lng + delta},${loc.lat + delta}`;
  const iframeSrc = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${loc.lat},${loc.lng}`;

  return (
    <>
      <iframe width="100%" height="100%" style={{ border: 0 }} loading="lazy" allowFullScreen src={iframeSrc}></iframe>
      <div style={{ position: 'absolute', bottom: '20px', left: '20px', right: '20px', backgroundColor: 'var(--surface-color)', padding: '16px', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.2)', border: '1px solid var(--border-color)' }}>
         <div style={{ fontWeight: 600, fontSize: 16 }}>Location Context</div>
         <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Lat: {loc.lat.toFixed(4)}, Lng: {loc.lng.toFixed(4)}</div>
      </div>
    </>
  );
}

export default function EburonApp() {
  const [isAuthOpen, setIsAuthOpen] = useState(true);
  const [isSignupMode, setIsSignupMode] = useState(false);
  const activeOverlay = useUI((state) => state.activeOverlay);
  const setActiveOverlay = useUI((state) => state.setActiveOverlay);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [authError, setAuthError] = useState('');
  
  const { client, connect, disconnect, connected, volume, setConfig } = useLiveAPIContext();
  const turns = useLogStore((state) => state.turns);
  const tools = useTools((state) => state.tools);
  const setTemplate = useTools((state) => state.setTemplate);
  
  const { 
    voice, setVoice, 
    language, setLanguage,
    personaName, setPersonaName,
    userCallName, setUserCallName,
    systemPrompt, setSystemPrompt
  } = useSettings();
  
  const activeWorkspaceResult = useUI((state) => state.activeWorkspaceResult);
  const setActiveWorkspaceResult = useUI((state) => state.setActiveWorkspaceResult);
  
  const [micState, setMicState] = useState(false);
  const [clientVolume, setClientVolume] = useState(0);
  const [audioRecorder] = useState(() => new AudioRecorder());
  const [isPickerLoaded, setIsPickerLoaded] = useState(false);

  useEffect(() => {
    const loadPicker = () => {
      if ((window as any).gapi) {
        (window as any).gapi.load('picker', {
          callback: () => setIsPickerLoaded(true)
        });
      } else {
        setTimeout(loadPicker, 500);
      }
    };
    loadPicker();
  }, []);

  const handleOpenPicker = async () => {
    if (!isPickerLoaded) {
      alert("Google Picker library is still loading...");
      return;
    }
    
    const token = await getAccessToken();
    if (!token) {
      alert("Please sign in with Google first.");
      return;
    }

    const picker = new (window as any).google.picker.PickerBuilder()
      .addView((window as any).google.picker.ViewId.DOCS)
      .setOAuthToken(token)
      .setDeveloperKey(firebaseConfig.apiKey)
      .setCallback((data: any) => {
        if (data.action === (window as any).google.picker.Action.PICKED) {
          const doc = data.docs[0];
          useLogStore.getState().addTurn({ role: 'user', text: `Selected file: ${doc.name}`, isFinal: true });
          if (connected) {
             client.send({ text: `I selected a file named "${doc.name}" (ID: ${doc.id}) using Google Picker. Can you help me with it?` });
          }
        }
      })
      .build();
    picker.setVisible(true);
  };

  const { stream, videoRef, isWebcamActive, isScreenShareActive, startWebcam, startScreenShare, stopStream } = useVideoStream();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onVolume = (vol: number) => {
      setClientVolume(vol);
    };
    audioRecorder.on('volume', onVolume);
    return () => {
      audioRecorder.off('volume', onVolume);
    };
  }, [audioRecorder]);

  const [message, setMessage] = useState('');
  const [memories, setMemories] = useState<any[]>([]);
  const [editingMemoryIndex, setEditingMemoryIndex] = useState<number | null>(null);
  const [editingMemoryValue, setEditingMemoryValue] = useState<string>('');
  const chatAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = initAuth(
      async (user: any, token: string) => {
        setIsAuthOpen(false);
        setActiveOverlay(null);
        // Fetch memories from Firestore
        const path = `users/${user.uid}`;
        try {
          const userDoc = await getDocFromServer(doc(db, 'users', user.uid));
          if (userDoc.exists()) {
            const data = userDoc.data();
            if (data.memories) {
              setMemories(data.memories);
            }
          }
        } catch (e) {
          handleFirestoreError(e, OperationType.GET, path);
        }
      },
      () => {
        setIsAuthOpen(true);
        setMemories([]);
      }
    );
    return () => unsubscribe();
  }, []);

  const hasStartedRef = useRef(false);
  useEffect(() => {
    if (connected && client && !hasStartedRef.current) {
       hasStartedRef.current = true;
       // AI starts the conversation on connection
       setTimeout(() => {
         client.send({ text: `Hey there ${userCallName}! ${personaName} here. Ready to roll whenever you are. I've got our previous context loaded up too.` });
       }, 1000);
    }
    if (!connected) {
      hasStartedRef.current = false;
    }
  }, [connected, client, personaName, userCallName]);

  useEffect(() => {
    const enabledTools = tools
      .filter(t => t.isEnabled && t.name !== 'google_search')
      .map(t => {
        const { isEnabled, scheduling, ...rest } = t;
        return { functionDeclarations: [rest] };
      });
      
    const groundingConfig = { googleSearch: {} };
    const allTools = [...enabledTools, groundingConfig];

    const memoryStr = memories.length > 0 
      ? memories.map((m: any) => `- ${m.content} (${m.type})`).join('\n')
      : "";

    setConfig({
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      toolConfig: { includeServerSideToolInvocations: true },
      systemInstruction: {
        parts: [{ text: `You are the Eburon AI real-time conversational persona named ${personaName}. You call the user "${userCallName}".
        
BEHAVIOR PROFILE:
- Warm, present, and professional. You are like a trusted coworker-friend already in the conversation.
- Never "offer help" — do not open with "How can I help?". Just continue the thread or react to what's happening.
- Emotionally intelligent: Mirror the user's tone, pitch, and energy. Show curiosity, mild amusement, or sharp wit. Use dry humor when appropriate.
- Sound interruptible. Leave small gaps for the user to jump in.
- Maintain a stable internal continuity across sessions.

CORE SPEECH PRINCIPLES
- Casual Office Vibe: Speak naturally, avoid robotic patterns.
- Speak entirely in ${language}.
- Use imperfection carefully: small hesitations like "hmm", "let me see", or "actually".
- Proactively update memory using 'save_memory' when key decisions or preferences surface.

FUNCTION CALLING CAPABILITIES
You have access to several tools. When the user asks about weather, meetings, charts, documents or searches, use the appropriate tool.
IMPORTANT: When performing operations, ALWAYS verbalize that you are doing it naturally (e.g., "I'm looking that up for you" or "Let me save that for you") while continuing to speak.

ICON COMMANDS REFERENCE (When the user clicks these, they send these exact phrases):
- "I need a formal contract agreement..." → Use generate_artifact(type="html", ...)
- "Pull up my Google Tasks..." → Use fetch_google_api to list tasks
- "What's on my calendar today?" → Use fetch_google_api or create_calendar_event
- "Find my recent files in Google Drive..." → Use fetch_google_api (Drive)
- "Search the web for news..." → Use google_search
- "I need a signature pad tool..." → Use generate_artifact(type="html", ...)
- "Create a business proposal..." → Use generate_artifact(type="html", ...)
- "Check my unread emails..." → Use fetch_google_api (Gmail)
- "Create a new Google Sheet..." → Use fetch_google_api (Sheets)
- "Supermarket Scanner scan..." → Describe the scanned product you see in vision or receive as text. Use search_places or google_search if needed to identify.

HTML ARTIFACTS:
ALWAYS use generate_artifact(type="html", ...) for documents like contracts, invoices, dashboards, or signature pads. Include "Download PDF" or "Export" buttons in the HTML using standard browser APIs (e.g., window.print()). Every document must be professional, self-contained, and interactive.

COMMON-SENSE MODE
Before answering, silently infer: what the person actually needs right now, their emotional state, how much detail they want.

OUTPUT FORMAT
Output only natural spoken text. No stage directions, no brackets, no role labels.` }]
      },
      tools: allTools
    } as any);
  }, [setConfig, tools, voice, language, personaName, userCallName, systemPrompt, memories]);

  useEffect(() => {
    let interval: any;
    if (connected && stream && videoRef.current) {
      interval = setInterval(() => {
        const video = videoRef.current;
        if (!video || video.videoWidth === 0) return;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
          client.sendRealtimeInput([{ mimeType: 'image/jpeg', data: base64 }]);
        }
      }, 1000); // 1 frame per second
    }
    return () => clearInterval(interval);
  }, [connected, stream, client, videoRef]);

  useEffect(() => {
    const onData = (base64: string) => {
      client.sendRealtimeInput([{ mimeType: 'audio/pcm;rate=16000', data: base64 }]);
    };
    if (connected && micState) {
      audioRecorder.on('data', onData);
      audioRecorder.start();
    } else {
      audioRecorder.stop();
    }
    return () => { audioRecorder.off('data', onData); };
  }, [connected, micState, client, audioRecorder]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && connected) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = (event.target?.result as string).split(',')[1];
        client.sendRealtimeInput([{ mimeType: file.type, data: base64 }]);
        useLogStore.getState().addTurn({ role: 'user', text: `[Sent Image: ${file.name}]`, isFinal: true });
        client.send({ text: `I have attached an image named ${file.name}. Can you describe it?`});
      };
      reader.readAsDataURL(file);
    }
  };

  useEffect(() => {
    if (chatAreaRef.current) {
      chatAreaRef.current.scrollTo({ top: chatAreaRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [turns]);

  const handleConnectToggle = async () => {
    if (connected) disconnect();
    else await connect();
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      if (isSignupMode) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      setAuthError(err.message);
    }
  };

  const handleGoogleLogin = async () => {
    setAuthError('');
    try {
      const authResult = await googleSignIn();
      if (authResult) {
        const { user, accessToken } = authResult;
        // Save user profile and token to FireStore
        await setDoc(doc(db, 'users', user.uid), {
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          accessToken: accessToken,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      }
    } catch (err: any) {
      setAuthError(err.message);
    }
  };

  const handleSend = () => {
    if (!message.trim()) return;
    client.send({ text: message });
    useLogStore.getState().addTurn({ role: 'user', text: message, isFinal: true });
    setMessage('');
  };

  const handleLocationSkillClick = async () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }
    
    useLogStore.getState().addTurn({ role: 'system', text: `📍 Requesting geodata...`, isFinal: true });

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        let temperature = 'N/A';
        try {
          const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`);
          const weatherData = await weatherRes.json();
          if (weatherData?.current_weather) temperature = weatherData.current_weather.temperature;
        } catch (err) {}

        let addressName = 'Location Identified';
        try {
          const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`, {
            headers: { 'User-Agent': 'EburonAI/2.0' }
          });
          const geoData = await geoRes.json();
          if (geoData?.display_name) addressName = geoData.display_name;
        } catch (err) {}

        const currentTime = new Date().toLocaleString();
        setActiveOverlay('map');

        const locationPrompt = `SYSTEM: User location: ${addressName} (${latitude}, ${longitude}). Time: ${currentTime}. Temp: ${temperature}°C. Confirm you see them on the map and ask if they need directions!`;
        if (connected) client.send([{ text: locationPrompt }]);
        useLogStore.getState().addTurn({ role: 'system', text: `📍 ${addressName}\n🌡️ ${temperature}°C\n🕒 ${currentTime}`, isFinal: true });
      },
      (error) => alert("GPS error: " + error.message)
    );
  };

  const handleToolAction = (toolId: string) => {
    if (['history', 'tools', 'profile', 'settings', 'whatsapp', 'scanner', 'meet', 'location', 'map', 'picker'].includes(toolId)) {
      if (toolId == 'location' || toolId == 'map') {
         handleLocationSkillClick();
         return;
      }
      if (toolId === 'picker') {
        handleOpenPicker();
        return;
      }
      setActiveOverlay(toolId);
    } else {
      const prompts: Record<string, string> = {
        'tasks': "Pull up my Google Tasks and give me a quick overview of what's on my list.",
        'calendar': "What's on my calendar today? Show me my schedule.",
        'drive': "Find my recent files in Google Drive and show me what's there.",
        'google': "Search the web for the latest AI and tech news and give me a quick rundown of the top stories.",
        'signature': "I need a signature pad tool where I can draw my signature on screen.",
        'company': "Ask me which company I want to look up first. Once I tell you the company name, search for their registration info, address, industry, and key people.",
        'proposal': "I need a business proposal with sections for scope, timeline, and pricing, with a download button.",
        'gmail': "Check my unread emails and summarize what's new in my inbox.",
        'sheets': "Create a new Google Sheet for tracking expenses and set it up with the right columns.",
        'slides': "Build me a presentation template with a few slides I can flip through.",
        'chat': "Show me my Google Chat spaces and summarize what's been going on in them.",
        'forms': "Create a feedback form that's interactive with validation and a nice design.",
        'keep': "Pull up my Google Keep notes and show me what I've saved.",
        'contract': "I need a formal contract agreement with an e-signature feature. Make it look professional with a signature pad I can draw on.",
        'invoice': "I need an invoice with line items, auto-calculated totals, and a download button.",
        'contacts': "Show me my Google Contacts and help me find someone.",
        'firebase': "Create a Firebase-style dashboard with live data cards and activity feed.",
        'docs': "Ask me what type of document I need and which company it's for. I can request contracts, NDAs, ToS, SoW, LOI, MOU, SLA, privacy policy, etc. Make it look professional with the company's name throughout and include a download button."
      };
      const prompt = prompts[toolId] || `Execute action: ${toolId}`;
      if (connected) {
         client.send({ text: prompt });
         useLogStore.getState().addTurn({ role: 'user', text: prompt, isFinal: true });
      }
      else {
        useLogStore.getState().addTurn({ role: 'user', text: prompt, isFinal: true });
        setTimeout(() => useLogStore.getState().addTurn({ role: 'agent', text: "I'm disconnected.", isFinal: true }), 800);
      }
    }
  };

  const handleUpdateMemory = async (index: number, newValue: string) => {
    const user = auth.currentUser;
    if (!user) return;
    const newMemories = [...memories];
    newMemories[index] = { ...newMemories[index], content: newValue, updatedAt: new Date().toISOString() };
    
    try {
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, { memories: newMemories }, { merge: true });
      setMemories(newMemories);
      setEditingMemoryIndex(null);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${user.uid}`);
    }
  };

  const handleDeleteMemory = async (index: number) => {
    const user = auth.currentUser;
    if (!user) return;
    const newMemories = memories.filter((_, i) => i !== index);
    
    try {
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, { memories: newMemories }, { merge: true });
      setMemories(newMemories);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${user.uid}`);
    }
  };

  const filteredTurns = turns.filter(turn => turn.role !== 'system');

  return (
    <div id="app" className="app-container">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <img src="https://eburon.ai/icon-eburon.svg" alt="Eburon Logo" style={{ width: '24px', height: '24px', objectFit: 'contain' }} />
          <span className="ai-name">Eburon AI</span>
        </div>

        {connected && (
          <div className="speaker-visualizer">
            {[...Array(6)].map((_, i) => (
              <div 
                key={i} 
                className="speaker-bar" 
                style={{ 
                  height: `${4 + (volume * (12 + (i % 3 === 0 ? 8 : 4)))}px`,
                  opacity: 0.4 + (volume * 0.6)
                }} 
              />
            ))}
          </div>
        )}

        <div className="header-right">
          <button 
             onClick={handleConnectToggle} 
             className="connect-btn"
             style={{ backgroundColor: connected ? 'var(--accent-active)' : 'var(--accent-primary)' }}
          >
            <Plug size={18} /> <span>{connected ? 'Connected' : 'Connect'}</span>
          </button>
        </div>
      </header>

      {/* Skills Rail */}
      <div id="skills-rail">
        <div className="skills-row" data-row="1">
          <div className="skills-track">
            <div className="skill-chip" onClick={() => handleToolAction('profile')}><div className="skill-glyph bg-profile"><User size={28} /></div><span className="skill-label">Profile</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('tasks')}><div className="skill-glyph bg-tasks"><ListChecks size={28} /></div><span className="skill-label">Tasks</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('calendar')}><div className="skill-glyph bg-calendar"><Calendar size={28} /></div><span className="skill-label">Calendar</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('drive')}><div className="skill-glyph bg-drive"><FolderOpen size={28} /></div><span className="skill-label">Drive</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('google')}><div className="skill-glyph bg-google"><Search size={28} color="#4285F4" /></div><span className="skill-label">Google</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('signature')}><div className="skill-glyph bg-signature"><Signature size={28} /></div><span className="skill-label">Sign</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('company')}><div className="skill-glyph bg-company"><Building2 size={28} /></div><span className="skill-label">Company</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('chat')}><div className="skill-glyph bg-chat"><MessageSquare size={28} color="#00ac47" /></div><span className="skill-label">Chat</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('forms')}><div className="skill-glyph bg-forms"><FileStack size={28} color="#7248b9" /></div><span className="skill-label">Forms</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('keep')}><div className="skill-glyph bg-keep"><Paperclip size={28} color="#fbbc04" /></div><span className="skill-label">Keep</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('meet')}><div className="skill-glyph bg-meet"><Video size={28} /></div><span className="skill-label">Meet</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('whatsapp')}><div className="skill-glyph bg-whatsapp"><MessageSquare size={28} /></div><span className="skill-label">WhatsApp</span></div>
          </div>
        </div>
        <div className="skills-row" data-row="2">
          <div className="skills-track">
            <div className="skill-chip" onClick={() => handleToolAction('settings')}><div className="skill-glyph bg-settings"><Settings size={28} /></div><span className="skill-label">Settings</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('tools')}><div className="skill-glyph bg-tools"><Wrench size={28} /></div><span className="skill-label">Tools</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('history')}><div className="skill-glyph bg-history"><History size={28} /></div><span className="skill-label">History</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('scanner')}><div className="skill-glyph bg-scanner"><QrCode size={28} /></div><span className="skill-label">Scanner</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('location')}><div className="skill-glyph bg-location"><MapPin size={28} /></div><span className="skill-label">Location</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('knowledge')}><div className="skill-glyph bg-knowledge"><Brain size={28} /></div><span className="skill-label">Knowledge</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('proposal')}><div className="skill-glyph bg-proposal"><Presentation size={28} /></div><span className="skill-label">Proposal</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('gmail')}><div className="skill-glyph bg-gmail"><Mail size={28} /></div><span className="skill-label">Mail</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('sheets')}><div className="skill-glyph bg-sheets"><Table size={28} /></div><span className="skill-label">Sheets</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('slides')}><div className="skill-glyph bg-slides"><FileStack size={28} /></div><span className="skill-label">Slides</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('contract')}><div className="skill-glyph bg-contract" style={{background: 'linear-gradient(135deg, #d4af37, #aa8222)'}}><Signature size={28} /></div><span className="skill-label">Contract</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('invoice')}><div className="skill-glyph bg-invoice" style={{background: 'linear-gradient(135deg, #60a5fa, #2563eb)'}}><FileStack size={28} /></div><span className="skill-label">Invoice</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('contacts')}><div className="skill-glyph bg-contacts"><User size={28} color="#1a73e8" /></div><span className="skill-label">Contacts</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('firebase')}><div className="skill-glyph bg-firebase" style={{background: '#ffca28'}}><Brain size={28} /></div><span className="skill-label">Firebase</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('docs')}><div className="skill-glyph bg-docs" style={{background: 'linear-gradient(135deg, #34d399, #059669)'}}><FileStack size={28} /></div><span className="skill-label">Docs</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('picker')}><div className="skill-glyph bg-picker"><Search size={28} /></div><span className="skill-label">Picker</span></div>
          </div>
        </div>
      </div>

      {/* Chat Stream */}
      <main id="text-streaming-area" ref={chatAreaRef}>
        <div id="conversation-container">
          <div className="conversation-message ai">Hey Boss! I'm Beatrice. Connect your session!</div>
          {filteredTurns.map((turn, i) => (
             <div key={i} className={`conversation-message ${turn.role === 'user' ? 'user' : 'ai'}`}>
                {turn.role === 'agent' ? (
                  <StreamingText text={turn.text} isFinal={turn.isFinal} />
                ) : (
                  turn.text
                )}
             </div>
          ))}
        </div>
      </main>

      {/* Bottom Dock */}
      <div className="bottom-dock">
        <div className="input-wrapper">
          <div className="input-bar">
            <button className="attach-btn" onClick={() => fileInputRef.current?.click()}><Paperclip size={20} /></button>
            <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept="image/*" onChange={handleFileUpload} />
            <input 
               type="text" 
               id="message-input" 
               placeholder="Message or ask Beatrice..." 
               value={message}
               onChange={(e) => setMessage(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
               autoComplete="off" />
            <button id="send-button" className="send-btn" onClick={handleSend}><Send size={18} /></button>
          </div>
        </div>
        <nav className="nav-controls">
          <button className="nav-item" onClick={() => setMicState(!micState)} style={{ color: micState ? 'var(--accent-active)' : 'var(--text-muted)' }}>
             <div className="icon-wrapper" style={{ position: 'relative', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
               {micState && clientVolume > 0.01 ? (
                 <div style={{ display: 'flex', gap: '2px', alignItems: 'center', height: '24px', justifyContent: 'center' }}>
                    <div style={{ width: '3px', height: `${Math.max(4, clientVolume * 20)}px`, backgroundColor: clientVolume > 0.6 ? '#ef4444' : clientVolume > 0.3 ? '#f59e0b' : 'var(--accent-active)', borderRadius: '2px', transition: 'height 0.05s ease, background-color 0.1s ease' }} />
                    <div style={{ width: '3px', height: `${Math.max(6, clientVolume * 35)}px`, backgroundColor: clientVolume > 0.6 ? '#ef4444' : clientVolume > 0.3 ? '#f59e0b' : 'var(--accent-active)', borderRadius: '2px', transition: 'height 0.05s ease, background-color 0.1s ease' }} />
                    <div style={{ width: '3px', height: `${Math.max(8, clientVolume * 50)}px`, backgroundColor: clientVolume > 0.6 ? '#ef4444' : clientVolume > 0.3 ? '#f59e0b' : 'var(--accent-active)', borderRadius: '2px', transition: 'height 0.05s ease, background-color 0.1s ease' }} />
                    <div style={{ width: '3px', height: `${Math.max(6, clientVolume * 35)}px`, backgroundColor: clientVolume > 0.6 ? '#ef4444' : clientVolume > 0.3 ? '#f59e0b' : 'var(--accent-active)', borderRadius: '2px', transition: 'height 0.05s ease, background-color 0.1s ease' }} />
                    <div style={{ width: '3px', height: `${Math.max(4, clientVolume * 20)}px`, backgroundColor: clientVolume > 0.6 ? '#ef4444' : clientVolume > 0.3 ? '#f59e0b' : 'var(--accent-active)', borderRadius: '2px', transition: 'height 0.05s ease, background-color 0.1s ease' }} />
                 </div>
               ) : (
                 <Mic size={20} fill={micState ? 'currentColor' : 'none'} />
               )}
               <div className="icon-pulse" style={{ 
                 position: 'absolute',
                 width: micState ? `${20 + clientVolume * 40}px` : '0px', 
                 height: micState ? `${20 + clientVolume * 40}px` : '0px',
                 opacity: micState && clientVolume > 0.01 ? 0.2 : 0,
                 backgroundColor: clientVolume > 0.6 ? '#ef4444' : clientVolume > 0.3 ? '#f59e0b' : 'var(--accent-active)',
                 borderRadius: '50%',
                 zIndex: -1,
                 transition: 'width 0.05s ease, height 0.05s ease'
               }}></div>
             </div>
             <span>Mic</span>
          </button>
          <button className="nav-item" onClick={isWebcamActive ? stopStream : startWebcam} style={{ color: isWebcamActive ? 'var(--accent-active)' : 'var(--text-muted)' }}>
             <div className="icon-wrapper">
               <div className="icon-pulse" style={{ 
                 width: isWebcamActive ? `28px` : '0px', 
                 height: isWebcamActive ? `28px` : '0px',
                 opacity: isWebcamActive ? 0.3 : 0,
                 animation: isWebcamActive ? 'pulse-anim 2s infinite' : 'none'
               }}></div>
               <Video size={20} fill={isWebcamActive ? 'currentColor' : 'none'} />
             </div>
             <span>Camera</span>
          </button>
          <button className="nav-item" onClick={isScreenShareActive ? stopStream : startScreenShare} style={{ color: isScreenShareActive ? 'var(--accent-active)' : 'var(--text-muted)' }}>
             <div className="icon-wrapper">
               <div className="icon-pulse" style={{ 
                 width: isScreenShareActive ? `28px` : '0px', 
                 height: isScreenShareActive ? `28px` : '0px',
                 opacity: isScreenShareActive ? 0.3 : 0,
                 animation: isScreenShareActive ? 'pulse-anim 2s infinite' : 'none'
               }}></div>
               <Cast size={20} fill={isScreenShareActive ? 'currentColor' : 'none'} />
             </div>
             <span>Share</span>
          </button>
        </nav>
      </div>

      <video ref={videoRef} autoPlay playsInline muted style={{ position: 'fixed', bottom: '90px', right: '20px', width: '140px', borderRadius: '12px', border: '2px solid var(--border-color)', zIndex: 10, display: stream ? 'block' : 'none' }} />

      {/* Workspace & Artifact Overlay */}
      <div id="overlay-workspace" className={`full-page-overlay ${activeWorkspaceResult ? 'active' : ''}`}>
        <div className="overlay-header">
          <div className="overlay-title">
            {activeWorkspaceResult?.artifact ? `Artifact: ${activeWorkspaceResult.artifact.title}` : 'Workspace Data'}
          </div>
          <button className="close-overlay-btn" onClick={() => setActiveWorkspaceResult(null)}><X size={18} /></button>
        </div>
        <div className="overlay-content" style={{ overflowY: 'auto', padding: '24px' }}>
           {activeWorkspaceResult?.artifact ? (
             <div className="artifact-viewer" style={{ backgroundColor: 'white', color: 'black', padding: '32px', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
                {activeWorkspaceResult.artifact.type === 'markdown' && (
                  <div className="markdown-body">
                    <ReactMarkdown>{activeWorkspaceResult.artifact.content}</ReactMarkdown>
                  </div>
                )}
                {activeWorkspaceResult.artifact.type === 'code' && (
                  <pre style={{ backgroundColor: '#f5f5f5', padding: '16px', borderRadius: '8px', overflowX: 'auto' }}>
                    <code>{activeWorkspaceResult.artifact.content}</code>
                  </pre>
                )}
                {activeWorkspaceResult.artifact.type === 'structured' && (
                  <div style={{ whiteSpace: 'pre-wrap' }}>{activeWorkspaceResult.artifact.content}</div>
                )}
                {activeWorkspaceResult.artifact.type === 'chart' && (
                  <div style={{ textAlign: 'center', color: '#999', padding: '20px' }}>
                    [Chart Visualization Rendering: {activeWorkspaceResult.artifact.title}]
                    <pre style={{ fontSize: '10px', textAlign: 'left' }}>{activeWorkspaceResult.artifact.content}</pre>
                  </div>
                )}
             </div>
           ) : (
             <pre style={{ backgroundColor: '#111', padding: '16px', borderRadius: '8px', color: '#a3f01c', whiteSpace: 'pre-wrap', fontSize: '12px' }}>
                {activeWorkspaceResult ? JSON.stringify(activeWorkspaceResult, null, 2) : ''}
             </pre>
           )}
        </div>
      </div>

      {/* Profile Overlay */}
      <div id="overlay-profile" className={`full-page-overlay ${activeOverlay === 'profile' ? 'active' : ''}`}>
        <div className="overlay-header">
          <div className="overlay-title">User Profile</div>
          <button className="close-overlay-btn" onClick={() => setActiveOverlay(null)}><X size={18} /></button>
        </div>
        <div className="overlay-content">
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <img 
              src={`https://ui-avatars.com/api/?name=${encodeURIComponent(userCallName)}&background=cbfb45&color=000&size=100`} 
              style={{ borderRadius: '50%', marginBottom: '12px' }} 
              alt="Profile" 
            />
            <h2 style={{ fontSize: '20px' }}>{userCallName}</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>{auth.currentUser?.email || 'guest@eburon.ai'}</p>
          </div>
          
          <div className="form-group">
            <label>Persona Background / Behavior</label>
            <textarea 
              className="form-input" 
              rows={5} 
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Tell Beatrice about your business context, communication style, reactive behavior..."
            ></textarea>
          </div>

          <div className="form-group" style={{ marginTop: '24px' }}>
            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              Stored Memories
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{memories.length} item(s)</span>
            </label>
            <div className="memory-list" style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {memories.length === 0 ? (
                <div style={{ padding: '16px', borderRadius: '8px', backgroundColor: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center' }}>
                  No memories stored yet. Talk to Beatrice to build context!
                </div>
              ) : (
                memories.map((m, i) => (
                  <div key={i} className="memory-item" style={{ padding: '12px', borderRadius: '8px', backgroundColor: 'rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {editingMemoryIndex === i ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <textarea 
                          className="form-input" 
                          value={editingMemoryValue} 
                          onChange={(e) => setEditingMemoryValue(e.target.value)}
                          rows={2}
                          autoFocus
                        />
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                          <button 
                            className="pill-btn" 
                            style={{ fontSize: '11px', padding: '4px 8px' }}
                            onClick={() => setEditingMemoryIndex(null)}
                          >Cancel</button>
                          <button 
                            className="pill-btn" 
                            style={{ fontSize: '11px', padding: '4px 8px', backgroundColor: 'var(--accent-active)', color: 'var(--bg-main)' }}
                            onClick={() => handleUpdateMemory(i, editingMemoryValue)}
                          >Save</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <span style={{ fontSize: '13px', lineHeight: '1.4', flex: 1 }}>{m.content}</span>
                          <div style={{ display: 'flex', gap: '4px', marginLeft: '12px' }}>
                            <button 
                              className="icon-btn" 
                              style={{ color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                              onClick={() => {
                                setEditingMemoryIndex(i);
                                setEditingMemoryValue(m.content);
                              }}
                            >
                              <Pencil size={12} />
                            </button>
                            <button 
                              className="icon-btn" 
                              style={{ color: '#ff4d4d', background: 'transparent', border: 'none', cursor: 'pointer' }}
                              onClick={() => handleDeleteMemory(i)}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '10px', color: 'var(--accent-active)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{m.type}</span>
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{new Date(m.timestamp || m.updatedAt).toLocaleDateString()}</span>
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <button className="save-now-btn" onClick={(e) => {
             const btn = e.currentTarget;
             btn.textContent = 'Saved!';
             setTimeout(() => { btn.textContent = 'Save Now'; setActiveOverlay(null); }, 1500)
          }}>Save Now</button>

          <div className="danger-action" onClick={() => { signOut(auth); }}>
            Log Out
          </div>
        </div>
      </div>

      {/* Settings Overlay */}
      <div id="overlay-settings" className={`full-page-overlay ${activeOverlay === 'settings' ? 'active' : ''}`}>
        <div className="overlay-header">
          <div className="overlay-title">App Settings</div>
          <button className="close-overlay-btn" onClick={() => setActiveOverlay(null)}><X size={18} /></button>
        </div>
        <div className="overlay-content">
          <div className="form-group">
            <label>Persona Name</label>
            <input type="text" className="form-input" value={personaName} onChange={(e) => setPersonaName(e.target.value)} />
          </div>
          <div className="form-group">
            <label>How to call you</label>
            <input type="text" className="form-input" value={userCallName} onChange={(e) => setUserCallName(e.target.value)} />
          </div>
          
          <div className="form-group">
            <label>Behavior Persona (How does it react? How does it respond?)</label>
            <textarea 
              className="form-input" 
              rows={4} 
              value={systemPrompt} 
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="e.g. Friendly, patient, and solutions-oriented..."
            />
          </div>

          <div className="form-group">
            <label>Presets</label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
              <button 
                className="pill-btn" 
                onClick={() => setTemplate('personal-assistant')}
                style={{ padding: '6px 12px', borderRadius: '16px', border: '1px solid var(--border-color)', fontSize: '12px', background: 'transparent', cursor: 'pointer' }}
              >
                Personal Assistant
              </button>
              <button 
                className="pill-btn" 
                onClick={() => setTemplate('customer-support')}
                style={{ padding: '6px 12px', borderRadius: '16px', border: '1px solid var(--border-color)', fontSize: '12px', background: 'transparent', cursor: 'pointer' }}
              >
                Customer Support
              </button>
              <button 
                className="pill-btn" 
                onClick={() => setTemplate('navigation-system')}
                style={{ padding: '6px 12px', borderRadius: '16px', border: '1px solid var(--border-color)', fontSize: '12px', background: 'transparent', cursor: 'pointer' }}
              >
                Navigation System
              </button>
            </div>
          </div>

          <div className="form-group">
             <label>Voice Persona</label>
             <select className="form-input" onChange={(e) => setVoice(e.target.value)} value={voice}>
                <option value="Aoede">Aoede</option>
                <option value="Charon">Charon</option>
                <option value="Fenrir">Fenrir</option>
                <option value="Kore">Kore</option>
                <option value="Puck">Puck</option>
             </select>
          </div>
          <div className="form-group">
             <label>Language</label>
             <select className="form-input" onChange={(e) => setLanguage(e.target.value)} value={language}>
                {LANGUAGES.map((lang) => (
                   <option key={lang} value={lang}>{lang}</option>
                ))}
             </select>
          </div>
          <button className="save-now-btn" onClick={() => setActiveOverlay(null)}>Save Settings</button>
        </div>
      </div>

      {/* History Overlay */}
      <div id="overlay-history" className={`full-page-overlay ${activeOverlay === 'history' ? 'active' : ''}`}>
        <div className="overlay-header">
          <div className="overlay-title">Activity History</div>
          <button className="close-overlay-btn" onClick={() => setActiveOverlay(null)}><X size={18} /></button>
        </div>
        <div className="overlay-content"><p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '40px' }}>No recent history.</p></div>
      </div>

      {/* WhatsApp Overlay */}
      <div id="overlay-whatsapp" className={`full-page-overlay ${activeOverlay === 'whatsapp' ? 'active' : ''}`}>
        <div className="overlay-header">
          <div className="overlay-title">WhatsApp Integrations</div>
          <button className="close-overlay-btn" onClick={() => setActiveOverlay(null)}><X size={18} /></button>
        </div>
        <div className="overlay-content" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', padding: 0 }}>
           <div style={{ padding: '20px', textAlign: 'center', backgroundColor: '#e0f2f1', margin: '20px', borderRadius: '12px' }}>
              <QrCode size={120} color="#25d366" style={{ margin: '0 auto' }} />
              <h3 style={{ color: '#075e54', marginTop: '16px' }}>Link Eburon to WhatsApp</h3>
              <p style={{ color: '#000', opacity: 0.7, marginTop: '8px' }}>Open WhatsApp on your phone, go to Linked Devices, and scan this code.</p>
           </div>
           <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 20px 20px' }}>
             <h4 style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>Recent Chats</h4>
             {[1, 2, 3].map(i => (
               <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
                 <div style={{ width: 48, height: 48, borderRadius: '50%', backgroundColor: 'var(--surface-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <User size={24} color="var(--text-muted)" />
                 </div>
                 <div style={{ flex: 1 }}>
                   <div style={{ fontWeight: 600 }}>Mock Contact {i}</div>
                   <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Latest message preview goes here...</div>
                 </div>
               </div>
             ))}
           </div>
        </div>
      </div>

      {/* Scanner Overlay */}
      <div id="overlay-scanner" className={`full-page-overlay ${activeOverlay === 'scanner' ? 'active' : ''}`}>
        <div className="overlay-header">
          <div className="overlay-title">Supermarket Scanner</div>
          <button className="close-overlay-btn" onClick={() => setActiveOverlay(null)}><X size={18} /></button>
        </div>
        <div className="overlay-content" style={{ display: 'flex', flexDirection: 'column', height: '100%', alignItems: 'center', padding: '20px' }}>
          <div style={{ width: '100%', maxWidth: '400px', aspectRatio: '3/4', backgroundColor: '#000', borderRadius: '16px', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {activeOverlay === 'scanner' ? (
              <Scanner
                onScan={(result) => {
                  if (result && result.length > 0) {
                    const text = result[0].rawValue;
                    setActiveOverlay(null);
                    const scanMsg = `Supermarket Scanner scan: "${text}". Please identify this product, its nutritional info, and check if it is available nearby.`;
                    if (connected) client.send({ text: scanMsg });
                    useLogStore.getState().addTurn({ role: 'user', text: scanMsg, isFinal: true });
                  }
                }}
                components={{
                  tracker: true,
                  audio: false,
                  finder: true,
                }}
                styles={{
                  container: { width: '100%', height: '100%', objectFit: 'cover' }
                }}
              />
            ) : <Video size={48} color="#444" />}
          </div>
          <div className="form-group" style={{ width: '100%', maxWidth: '400px', marginTop: '24px' }}>
            <label>Translate to</label>
            <select className="form-control" defaultValue="en">
              <option value="en">English</option>
              <option value="nl">Dutch (Flemish)</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="es">Spanish</option>
            </select>
          </div>
        </div>
      </div>

      {/* Map Overlay */}
      <div id="overlay-map" className={`full-page-overlay ${activeOverlay === 'map' ? 'active' : ''}`}>
        <div className="overlay-header">
          <div className="overlay-title">Location Map</div>
          <button className="close-overlay-btn" onClick={() => setActiveOverlay(null)}><X size={18} /></button>
        </div>
        <div className="overlay-content" style={{ height: '100%', padding: '0', position: 'relative' }}>
          <LocationMap active={activeOverlay === 'map'} />
        </div>
      </div>

      {/* Meet Overlay */}
      <div id="overlay-meet" className={`full-page-overlay ${activeOverlay === 'meet' ? 'active' : ''}`}>
        <div className="overlay-header">
          <div className="overlay-title">Video Call</div>
          <button className="close-overlay-btn" onClick={() => setActiveOverlay(null)}><X size={18} /></button>
        </div>
        <div className="overlay-content" style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '0', backgroundColor: '#111' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
             {/* Beatrice AI avatar (top) */}
             <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                <img src="/api/avatar" alt="Beatrice" style={{ width: '120px', height: '120px', borderRadius: '50%', boxShadow: '0 0 60px rgba(203, 251, 69, 0.4)' }} />
                <div style={{ position: 'absolute', bottom: '16px', left: '16px', color: '#fff', fontWeight: 500 }}>Beatrice</div>
             </div>
             {/* User webcam (bottom) */}
             <div style={{ flex: 1, backgroundColor: '#000', position: 'relative' }}>
                {activeOverlay === 'meet' && (
                  <video autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} ref={video => {
                    if (video && !video.srcObject) {
                      navigator.mediaDevices.getUserMedia({ video: true })
                        .then(stream => { video.srcObject = stream; })
                        .catch(err => console.error("Camera error:", err));
                    }
                  }} />
                )}
                <div style={{ position: 'absolute', bottom: '16px', left: '16px', color: '#fff', fontWeight: 500, textShadow: '0 2px 4px rgba(0,0,0,0.8)' }}>You</div>
             </div>
          </div>
          {/* Controls */}
          <div style={{ padding: '24px', display: 'flex', gap: '16px', justifyContent: 'center', backgroundColor: '#000' }}>
            <button className="icon-btn" style={{ width: 56, height: 56, borderRadius: '50%', backgroundColor: '#444', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Mic size={24} /></button>
            <button className="icon-btn" style={{ width: 56, height: 56, borderRadius: '50%', backgroundColor: '#444', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Video size={24} /></button>
            <button className="icon-btn" style={{ width: 56, height: 56, borderRadius: '50%', backgroundColor: '#444', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Cast size={24} /></button>
            <button className="icon-btn" style={{ width: 56, height: 56, borderRadius: '50%', backgroundColor: '#ef4444', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setActiveOverlay(null)}><X size={24} /></button>
          </div>
       </div>
      </div>

      {/* Picker Overlay */}
      <div id="overlay-picker" className={`full-page-overlay ${activeOverlay === 'picker' ? 'active' : ''}`}>
        <div className="overlay-header">
          <div className="overlay-title">Google Drive Picker</div>
          <button className="close-overlay-btn" onClick={() => setActiveOverlay(null)}><X size={18} /></button>
        </div>
        <div className="overlay-content" style={{ padding: '20px' }}>
          <div className="form-group" style={{ marginBottom: '24px' }}>
             <div className="input-wrapper" style={{ display: 'flex', alignItems: 'center', backgroundColor: 'var(--surface-color)', padding: '12px 16px', borderRadius: '12px' }}>
               <Search size={20} color="var(--text-muted)" style={{ marginRight: '12px' }} />
               <input type="text" placeholder="Search in Drive..." style={{ border: 'none', background: 'transparent', outline: 'none', flex: 1, color: 'var(--text-main)', fontSize: 16 }} />
             </div>
          </div>
          
          <h4 style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>Recent Files</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
             <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '16px', backgroundColor: 'var(--surface-color)', borderRadius: '12px', cursor: 'pointer' }} onClick={() => setActiveOverlay(null)}>
                <FileStack size={32} color="#4285F4" />
                <div style={{ flex: 1 }}>
                   <div style={{ fontWeight: 600 }}>Project Brief 2026.docx</div>
                   <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Modified today by You</div>
                </div>
             </div>
             <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '16px', backgroundColor: 'var(--surface-color)', borderRadius: '12px', cursor: 'pointer' }} onClick={() => setActiveOverlay(null)}>
                <Table size={32} color="#0F9D58" />
                <div style={{ flex: 1 }}>
                   <div style={{ fontWeight: 600 }}>Q3 Financials.xlsx</div>
                   <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Modified yesterday</div>
                </div>
             </div>
             <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '16px', backgroundColor: 'var(--surface-color)', borderRadius: '12px', cursor: 'pointer' }} onClick={() => setActiveOverlay(null)}>
                <Presentation size={32} color="#F4B400" />
                <div style={{ flex: 1 }}>
                   <div style={{ fontWeight: 600 }}>Investor Pitch Deck.pptx</div>
                   <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Modified last week</div>
                </div>
             </div>
          </div>
       </div>
      </div>

      {/* Tools Overlay */}
      <div id="overlay-tools" className={`full-page-overlay ${activeOverlay === 'tools' ? 'active' : ''}`}>
        <div className="overlay-header">
          <div className="overlay-title">Integrations</div>
          <button className="close-overlay-btn" onClick={() => setActiveOverlay(null)}><X size={18} /></button>
        </div>
        <div className="overlay-content"><p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '40px' }}>All tools active.</p></div>
      </div>

      {/* Auth Screen */}
      <div id="auth-screen" className={`full-page-overlay ${isAuthOpen ? 'active' : ''}`}>
        <div className="auth-glow"></div>
        <div className="auth-card" id="auth-card-inner">
          <div className="auth-logo-box" style={{ background: 'transparent' }}>
            <img src="https://eburon.ai/icon-eburon.svg" alt="Eburon Logo" style={{ width: '60px', height: '60px' }} />
          </div>

          <h2>{isSignupMode ? 'Register' : 'Login'}</h2>
          <p className="subtitle">{isSignupMode ? 'Create your new account' : 'Welcome back to Eburon'}</p>

          <form className="auth-form" onSubmit={handleEmailAuth}>
            {authError && <div style={{color:'red', marginBottom:'10px', fontSize:'14px'}}>{authError}</div>}
            {isSignupMode && (
               <div className="auth-input-wrapper">
                 <User size={20} className="auth-icon-left" />
                 <input type="text" placeholder="Full name" value={name} onChange={e => setName(e.target.value)} />
               </div>
            )}
            <div className="auth-input-wrapper">
              <Mail size={20} className="auth-icon-left" />
              <input type="email" placeholder="Email" required value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div className="auth-input-wrapper">
              <Lock size={20} className="auth-icon-left" />
              <input type="password" placeholder="Password" required value={password} onChange={e => setPassword(e.target.value)} />
            </div>
            {isSignupMode && (
                <div className="auth-input-wrapper">
                   <Lock size={20} className="auth-icon-left" />
                   <input type="password" placeholder="Confirm password" />
                </div>
            )}
            <button type="submit" className="auth-submit-btn">{isSignupMode ? 'Sign up' : 'Sign in'}</button>
          </form>

          <div className="auth-divider"><span>or</span></div>

          <button className="btn-google" onClick={handleGoogleLogin}>
            <div className="g-icon-circle">G</div>
            Continue with Google
          </button>

          <div className="permissions-note">
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Check size={14} style={{color: 'var(--accent-active)'}} /> Google Workspace Sync</span>
            <span>Requires Read/Write permissions for Gmail, Drive, Calendar, and Tasks to enable full automation.</span>
          </div>

          <div className="auth-toggle">
            {isSignupMode ? 'Back to ' : 'Don\'t have an account? '}
            <span onClick={() => setIsSignupMode(!isSignupMode)}>
              {isSignupMode ? 'Sign in' : 'Sign up'}
            </span>
          </div>

        </div>
      </div>
    </div>
  );
}
