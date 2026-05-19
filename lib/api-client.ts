/**
 * API Client for Eburon Backend
 */

export const apiClient = {
  get: async (endpoint: string, token?: string) => {
    const headers: any = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    
    const response = await fetch(endpoint, { headers });
    if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
    return response.json();
  },

  post: async (endpoint: string, body: any, token?: string) => {
    const headers: any = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
    return response.json();
  },

  put: async (endpoint: string, body: any, token?: string) => {
    const headers: any = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    
    const response = await fetch(endpoint, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
    return response.json();
  },

  delete: async (endpoint: string, token?: string) => {
    const headers: any = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    
    const response = await fetch(endpoint, { method: 'DELETE', headers });
    if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
    return response.json();
  }
};

/** High-level API helpers */
import { auth } from './firebase';

const getToken = () => auth.currentUser?.getIdToken();

export const fetchSettings = async () => {
  const token = await getToken();
  return apiClient.get('/api/settings', token);
};

export const updateSettings = async (settings: any) => {
  const token = await getToken();
  return apiClient.put('/api/settings', settings, token);
};

export const fetchMemories = async () => {
  const token = await getToken();
  return apiClient.get('/api/memories', token);
};

export const saveMemory = async (content: string, type: string) => {
  const token = await getToken();
  return apiClient.post('/api/memories', { content, type }, token);
};

export const deleteMemory = async (id: string) => {
  const token = await getToken();
  return apiClient.delete(`/api/memories/${id}`, token);
};

export const fetchConversations = async (limit = 50) => {
  // To be implemented if history table is used
  return [];
};

export const saveConversationTurn = async (role: string, content: string, sessionId: string) => {
  // To be implemented
  return { success: true };
};

export const connectWhatsapp = async () => {
  const response = await fetch('/api/whatsapp/connect'); // hypothetical endpoint
  return response.json();
};

export const sendWhatsappMessage = async (phone: string, text: string) => {
  const token = await getToken();
  return apiClient.post('/api/whatsapp/send', { phone, text }, token);
};
