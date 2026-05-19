/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GenAILiveClient, StreamingLog } from '../../lib/genai-live-client';
import { LiveConnectConfig, Modality, LiveServerToolCall, LiveServerContent, LiveServerMessage } from '@google/genai';
import { AudioStreamer } from '../../lib/audio-streamer';
import { audioContext } from '../../lib/utils';
import VolMeterWorket from '../../lib/worklets/vol-meter';
import { useLogStore, useSettings } from '@/lib/state';
import { db, auth, handleFirestoreError, OperationType, getAccessToken } from '@/lib/firebase';
import { doc, getDoc, setDoc, updateDoc, arrayUnion, collection, addDoc, getDocs, query, where, limit } from 'firebase/firestore';
import * as api from '../../lib/api-client';

export type UseLiveApiResults = {
  client: GenAILiveClient;
  setConfig: (config: LiveConnectConfig) => void;
  config: LiveConnectConfig;

  connect: () => Promise<void>;
  disconnect: () => void;
  connected: boolean;

  volume: number;
};

export function useLiveApi({
  apiKey,
}: {
  apiKey: string;
}): UseLiveApiResults {
  const { model } = useSettings();
  const client = useMemo(() => new GenAILiveClient(apiKey, model), [apiKey, model]);

  const audioStreamerRef = useRef<AudioStreamer | null>(null);

  const [volume, setVolume] = useState(0);
  const [connected, setConnected] = useState(false);
  const [config, setConfig] = useState<LiveConnectConfig>({});

  // register audio for streaming server -> speakers
  useEffect(() => {
    if (!audioStreamerRef.current) {
      audioContext({ id: 'audio-out' }).then((audioCtx: AudioContext) => {
        audioStreamerRef.current = new AudioStreamer(audioCtx);
        audioStreamerRef.current
          .addWorklet<any>('vumeter-out', VolMeterWorket, (ev: any) => {
            setVolume(ev.data.volume);
          })
          .then(() => {
            // Successfully added worklet
          })
          .catch(err => {
            console.error('Error adding worklet:', err);
          });
      });
    }
  }, [audioStreamerRef]);

  useEffect(() => {
    const onOpen = () => {
      setConnected(true);
    };

    const onClose = () => {
      setConnected(false);
    };

    const stopAudioStreamer = () => {
      if (audioStreamerRef.current) {
        audioStreamerRef.current.stop();
      }
    };

    const onAudio = (data: ArrayBuffer) => {
      if (audioStreamerRef.current) {
        audioStreamerRef.current.addPCM16(new Uint8Array(data));
      }
    };

    // Bind event listeners
    client.on('open', onOpen);
    client.on('close', onClose);
    client.on('interrupted', stopAudioStreamer);
    client.on('audio', onAudio);

    const onToolCall = async (toolCall: LiveServerToolCall) => {
      const functionResponses: any[] = [];

      for (const fc of toolCall.functionCalls) {
        // Log the function call trigger
        const triggerMessage = `Triggering function call: **${
          fc.name
        }**\n\`\`\`json\n${JSON.stringify(fc.args, null, 2)}\n\`\`\``;
        useLogStore.getState().addTurn({
          role: 'system',
          text: triggerMessage,
          isFinal: true,
        });

        let responsePayload: any = { result: 'ok' };
        
        if (fc.name === 'fetch_google_api') {
           const { url, method, body } = fc.args as any;
           const token = await getAccessToken();
           if (!token) {
               responsePayload = { error: 'No Google access token found, please authenticate with Google (Sign in option).' };
           } else {
               try {
                   const res = await fetch(url, {
                       method: method || 'GET',
                       headers: { 
                          Authorization: `Bearer ${token}`,
                          'Content-Type': 'application/json'
                       },
                       body: body ? JSON.stringify(body) : undefined
                   });
                   const dataText = await res.text();
                   let json = null;
                   try { json = JSON.parse(dataText); } catch(e) {}
                   
                   responsePayload = json || { data: dataText };
                   
                   const uiState = await import('../../lib/state');
                   uiState.useUI.getState().setActiveWorkspaceResult(responsePayload);
                   
               } catch (e: any) {
                   responsePayload = { error: e.message };
               }
           }
        }

        if (fc.name === 'list_drive_files') {
            const { pageSize = 10, q = '' } = fc.args as any;
            const token = await getAccessToken();
            if (!token) {
                responsePayload = { error: 'No Google access token found.' };
            } else {
                try {
                    const url = `https://www.googleapis.com/drive/v3/files?pageSize=${pageSize}&q=${encodeURIComponent(q)}&fields=files(id, name, mimeType, webViewLink, modifiedTime)`;
                    const res = await fetch(url, {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    responsePayload = await res.json();
                } catch (e: any) {
                    responsePayload = { error: e.message };
                }
            }
        }

        if (fc.name === 'read_google_doc') {
            const { documentId } = fc.args as any;
            const token = await getAccessToken();
            if (!token) {
                responsePayload = { error: 'No Google access token found.' };
            } else {
                try {
                    const res = await fetch(`https://docs.googleapis.com/v1/documents/${documentId}`, {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    responsePayload = await res.json();
                } catch (e: any) {
                    responsePayload = { error: e.message };
                }
            }
        }

        if (fc.name === 'read_spreadsheet') {
            const { spreadsheetId, range } = fc.args as any;
            const token = await getAccessToken();
            if (!token) {
                responsePayload = { error: 'No Google access token found.' };
            } else {
                try {
                    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`, {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    responsePayload = await res.json();
                } catch (e: any) {
                    responsePayload = { error: e.message };
                }
            }
        }

        if (fc.name === 'list_contacts') {
            const { pageSize = 10 } = fc.args as any;
            const token = await getAccessToken();
            if (!token) {
                responsePayload = { error: 'No Google access token found.' };
            } else {
                try {
                    const res = await fetch(`https://people.googleapis.com/v1/people/me/connections?pageSize=${pageSize}&personFields=names,emailAddresses,phoneNumbers`, {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    responsePayload = await res.json();
                } catch (e: any) {
                    responsePayload = { error: e.message };
                }
            }
        }

        if (fc.name === 'list_tasks') {
            const { tasklist = '@default' } = fc.args as any;
            const token = await getAccessToken();
            if (!token) {
                responsePayload = { error: 'No Google access token found.' };
            } else {
                try {
                    const res = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${tasklist}/tasks`, {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    responsePayload = await res.json();
                } catch (e: any) {
                    responsePayload = { error: e.message };
                }
            }
        }

        if (fc.name === 'send_chat_message') {
            const { spaceName, text } = fc.args as any;
            const token = await getAccessToken();
            if (!token) {
                responsePayload = { error: 'No Google access token found.' };
            } else {
                try {
                    const res = await fetch(`https://chat.googleapis.com/v1/${spaceName}/messages`, {
                        method: 'POST',
                        headers: { 
                            Authorization: `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ text })
                    });
                    responsePayload = await res.json();
                } catch (e: any) {
                    responsePayload = { error: e.message };
                }
            }
        }

        if (fc.name === 'create_meet_link') {
            const { summary } = fc.args as any;
            const token = await getAccessToken();
            if (!token) {
                responsePayload = { error: 'No Google access token found.' };
            } else {
                try {
                    // Create an event with conferenceData to get a Meet link
                    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1', {
                        method: 'POST',
                        headers: { 
                            Authorization: `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            summary: summary || 'Quick Meeting',
                            start: { dateTime: new Date().toISOString() },
                            end: { dateTime: new Date(Date.now() + 30 * 60 * 1000).toISOString() },
                            conferenceData: {
                                createRequest: {
                                    requestId: Math.random().toString(36).substring(7),
                                    conferenceSolutionKey: { type: 'hangoutsMeet' }
                                }
                            }
                        })
                    });
                    const data = await res.json();
                    responsePayload = { 
                        meetLink: data.hangoutLink || data.conferenceData?.entryPoints?.[0]?.uri,
                        eventId: data.id,
                        status: 'Meeting created'
                    };
                } catch (e: any) {
                    responsePayload = { error: e.message };
                }
            }
        }

        if (fc.name === 'send_whatsapp_message') {
            const { phone, text } = fc.args as any;
            try {
                responsePayload = await api.sendWhatsappMessage(phone, text);
            } catch (e: any) {
                responsePayload = { error: e.message };
            }
        }

        if (fc.name === 'connect_whatsapp') {
            try {
                responsePayload = await api.connectWhatsapp();
            } catch (e: any) {
                responsePayload = { error: e.message };
            }
        }

        if (fc.name === 'send_email') {
           const { recipient, subject, body } = fc.args as any;
           const token = await getAccessToken();
           if (!token) {
               responsePayload = { error: 'No Google access token found.' };
           } else {
               try {
                   // Gmail API send message requires a base64url encoded raw message
                   const email = [
                       `To: ${recipient}`,
                       `Subject: ${subject}`,
                       'Content-Type: text/plain; charset=utf-8',
                       '',
                       body
                   ].join('\r\n');
                   const encodedEmail = btoa(unescape(encodeURIComponent(email))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                   
                   const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
                       method: 'POST',
                       headers: { 
                           Authorization: `Bearer ${token}`,
                           'Content-Type': 'application/json'
                       },
                       body: JSON.stringify({ raw: encodedEmail })
                   });
                   responsePayload = await res.json();
               } catch (e: any) {
                   responsePayload = { error: e.message };
               }
           }
        }

        if (fc.name === 'create_calendar_event') {
           const { summary, location, startTime, endTime } = fc.args as any;
           const token = await getAccessToken();
           if (!token) {
               responsePayload = { error: 'No Google access token found.' };
           } else {
               try {
                   const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
                       method: 'POST',
                       headers: { 
                           Authorization: `Bearer ${token}`,
                           'Content-Type': 'application/json'
                       },
                       body: JSON.stringify({
                           summary,
                           location,
                           start: { dateTime: startTime },
                           end: { dateTime: endTime }
                       })
                   });
                   responsePayload = await res.json();
               } catch (e: any) {
                   responsePayload = { error: e.message };
               }
           }
        }

        if (fc.name === 'set_reminder') {
           const { task, time } = fc.args as any;
           const token = await getAccessToken();
           if (!token) {
               responsePayload = { error: 'No Google access token found.' };
           } else {
               try {
                   const res = await fetch('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks', {
                       method: 'POST',
                       headers: { 
                           Authorization: `Bearer ${token}`,
                           'Content-Type': 'application/json'
                       },
                       body: JSON.stringify({
                           title: task,
                           due: time // ISO format works for due
                       })
                   });
                   responsePayload = await res.json();
               } catch (e: any) {
                   responsePayload = { error: e.message };
               }
           }
        }

        if (fc.name === 'save_memory') {
           const { memory, type } = fc.args as any;
           try {
               responsePayload = await api.saveMemory(memory, type);
           } catch (e: any) {
               responsePayload = { error: e.message };
           }
        }

        if (fc.name === 'search_memories') {
           const { query } = fc.args as any;
           const user = auth.currentUser;
           if (!user) {
               responsePayload = { error: 'No user authenticated.' };
           } else {
               try {
                   const { doc, getDoc } = await import('firebase/firestore');
                   const userDoc = await getDoc(doc(db, 'users', user.uid));
                   if (userDoc.exists()) {
                       const memories = userDoc.data().memories || [];
                       const filtered = memories.filter((m: any) => 
                           m.content.toLowerCase().includes(query.toLowerCase())
                       );
                       responsePayload = { results: filtered };
                   } else {
                       responsePayload = { results: [] };
                   }
               } catch (e: any) {
                   responsePayload = { error: e.message };
               }
           }
        }

        if (fc.name === 'save_note') {
           const { title, content } = fc.args as any;
           const user = auth.currentUser;
           if (!user) {
               responsePayload = { error: 'No user authenticated. Cannot save note.' };
           } else {
               const path = `users/${user.uid}/notes`;
               try {
                   const { collection, addDoc } = await import('firebase/firestore');
                   const notesRef = collection(db, 'users', user.uid, 'notes');
                   await addDoc(notesRef, {
                       title,
                       content,
                       createdAt: new Date().toISOString(),
                       updatedAt: new Date().toISOString()
                   });
                   responsePayload = { status: 'Note saved successfully', title };
               } catch (e: any) {
                   handleFirestoreError(e, OperationType.WRITE, path);
               }
           }
        }

        if (fc.name === 'list_notes') {
            const user = auth.currentUser;
            if (!user) {
                responsePayload = { error: 'No user authenticated.' };
            } else {
                try {
                    const { collection, getDocs } = await import('firebase/firestore');
                    const notesRef = collection(db, 'users', user.uid, 'notes');
                    const snapshot = await getDocs(notesRef);
                    const notes = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
                    responsePayload = { notes };
                } catch (e: any) {
                    responsePayload = { error: e.message };
                }
            }
        }

        if (fc.name === 'read_note') {
            const { title } = fc.args as any;
            const user = auth.currentUser;
            if (!user) {
                responsePayload = { error: 'No user authenticated.' };
            } else {
                try {
                    const { collection, query, where, getDocs, limit } = await import('firebase/firestore');
                    const notesRef = collection(db, 'users', user.uid, 'notes');
                    const q = query(notesRef, where('title', '==', title), limit(1));
                    const snapshot = await getDocs(q);
                    if (!snapshot.empty) {
                        responsePayload = { note: snapshot.docs[0].data() };
                    } else {
                        responsePayload = { error: `Note titled "${title}" not found.` };
                    }
                } catch (e: any) {
                    responsePayload = { error: e.message };
                }
            }
        }

        if (fc.name === 'calculate') {
           const { expression } = fc.args as any;
           try {
              // Basic safe evaluation for math
              const result = new Function(`return ${expression}`)();
              responsePayload = { result };
           } catch (e: any) {
              responsePayload = { error: 'Calculation failed: ' + e.message };
           }
        }

        if (fc.name === 'open_overlay') {
           const { overlay_id } = fc.args as any;
           responsePayload = { status: `Opened overlay ${overlay_id}` };
           const uiState = await import('../../lib/state');
           uiState.useUI.getState().setActiveOverlay(overlay_id);
        }

        if (fc.name === 'get_current_datetime') {
           responsePayload = { datetime: new Date().toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
        }

        if (fc.name === 'open_browser_url') {
           const { url } = fc.args as any;
           window.open(url, '_blank');
           responsePayload = { status: `Opened ${url} in a new tab` };
        }

        if (fc.name === 'create_html_document' || fc.name === 'create_json_file' || fc.name === 'generate_artifact' || fc.name === 'create_markdown_document' || fc.name === 'create_chart_spec' || fc.name === 'create_project_brief' || fc.name === 'create_checklist') {
           const { title, type, content, language, data, items } = fc.args as any;
           let actualType = type;
           let actualContent = content;
           
           if (fc.name === 'create_html_document') actualType = 'html';
           if (fc.name === 'create_json_file') actualType = 'json';
           if (fc.name === 'create_markdown_document') actualType = 'markdown';
           if (fc.name === 'create_chart_spec') {
               actualType = 'chart';
               actualContent = JSON.stringify(data);
           }
           if (fc.name === 'create_project_brief') actualType = 'markdown';
           if (fc.name === 'create_checklist') {
               actualType = 'markdown';
               actualContent = `# ${title}\n\n` + items.map((it: string) => `- [ ] ${it}`).join('\n');
           }
           
           if (!actualType) actualType = 'structured';
           
           responsePayload = { status: `${actualType.toUpperCase()} artifact generated successfully`, title };
           const uiState = await import('../../lib/state');
           uiState.useUI.getState().setActiveWorkspaceResult({
              artifact: { title, type: actualType, content: actualContent, language }
           });
        }

        if (fc.name === 'get_user_location') {
            responsePayload = new Promise((resolve) => {
                if ("geolocation" in navigator) {
                    navigator.geolocation.getCurrentPosition((position) => {
                        resolve({ 
                            latitude: position.coords.latitude, 
                            longitude: position.coords.longitude,
                            accuracy: position.coords.accuracy
                        });
                    }, (error) => {
                        resolve({ error: error.message });
                    });
                } else {
                    resolve({ error: "Geolocation not supported" });
                }
            });
            responsePayload = await responsePayload;
        }

        // Prepare the response
        functionResponses.push({
          id: fc.id,
          name: fc.name,
          response: responsePayload,
        });
      }

      // Log the function call response
      if (functionResponses.length > 0) {
        const responseMessage = `Function call response:\n\`\`\`json\n${JSON.stringify(
          functionResponses,
          null,
          2,
        )}\n\`\`\``;
        useLogStore.getState().addTurn({
          role: 'system',
          text: responseMessage,
          isFinal: true,
        });
      }

      client.sendToolResponse({ functionResponses: functionResponses });
    };

    const handleInputTranscription = (text: string, isFinal: boolean) => {
      const { addTurn, updateLastTurn, turns } = useLogStore.getState();
      const last = turns[turns.length - 1];
      if (last && last.role === 'user' && !last.isFinal) {
        updateLastTurn({ text: last.text + text, isFinal });
      } else {
        addTurn({ role: 'user', text, isFinal });
      }
    };

    const handleContent = (serverContent: LiveServerContent) => {
      const text =
        serverContent.modelTurn?.parts
          ?.map((p: any) => p.text)
          .filter(Boolean)
          .join(' ') ?? '';

      if (!text) return;

      const { addTurn, updateLastTurn, turns } = useLogStore.getState();
      const last = turns.at(-1);

      if (last?.role === 'agent' && !last.isFinal) {
        updateLastTurn({ text: last.text + text });
      } else {
        addTurn({ role: 'agent', text, isFinal: false });
      }
    };

    const handleTurnComplete = () => {
      const { updateLastTurn, turns } = useLogStore.getState();
      const last = turns.at(-1);
      if (last && !last.isFinal) {
        updateLastTurn({ isFinal: true });
      }
    };

    const handleOutputTranscription = (text: string, isFinal: boolean) => {
      const { addTurn, updateLastTurn, turns } = useLogStore.getState();
      const last = turns[turns.length - 1];
      if (last && last.role === 'agent' && !last.isFinal) {
        updateLastTurn({ text: last.text + text, isFinal });
      } else {
        addTurn({ role: 'agent', text, isFinal });
      }
    };

    client.on('inputTranscription', handleInputTranscription);
    client.on('outputTranscription', handleOutputTranscription);
    client.on('content', handleContent);
    client.on('turncomplete', handleTurnComplete);
    client.on('toolcall', onToolCall);

    return () => {
      // Clean up event listeners
      client.off('open', onOpen);
      client.off('close', onClose);
      client.off('interrupted', stopAudioStreamer);
      client.off('audio', onAudio);
      client.off('toolcall', onToolCall);
      client.off('inputTranscription', handleInputTranscription);
      client.off('outputTranscription', handleOutputTranscription);
      client.off('content', handleContent);
      client.off('turncomplete', handleTurnComplete);
    };
  }, [client]);

  const connect = useCallback(async () => {
    if (!config) {
      throw new Error('config has not been set');
    }
    client.disconnect();
    await client.connect(config);
  }, [client, config]);

  const disconnect = useCallback(async () => {
    client.disconnect();
    setConnected(false);
  }, [setConnected, client]);

  return {
    client,
    config,
    setConfig,
    connect,
    connected,
    disconnect,
    volume,
  };
}