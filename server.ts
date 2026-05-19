import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import admin from 'firebase-admin';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// Constants for production pathing
const IS_PROD = process.env.NODE_ENV === 'production';
const DIST_PATH = path.join(process.cwd(), 'dist');

// Initialize Firebase Admin lazily
let adminInitialized = false;
function getFirebaseAdmin() {
  if (!adminInitialized) {
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
    if (projectId) {
      try {
        admin.initializeApp({
          projectId: projectId,
        });
        adminInitialized = true;
        console.log('Firebase Admin initialized');
      } catch (e) {
        console.warn('Firebase Admin initialization failed:', e);
      }
    } else {
      console.warn('FIREBASE_PROJECT_ID not set, Firebase Admin not initialized');
    }
  }
  return admin;
}

// Initialize Supabase (Optional fallback)
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json());

  // Auth Middleware
  const authenticateToken = async (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401);

    try {
      const decodedToken = await getFirebaseAdmin().auth().verifyIdToken(token);
      req.user = decodedToken;
      next();
    } catch (error) {
      console.error('Auth error:', error);
      res.sendStatus(403);
    }
  };

  // API Routes
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/api/avatar', (req, res) => {
    // Return Beatrice avatar URL or image
    res.redirect('https://ui-avatars.com/api/?name=Beatrice&background=cbfb45&color=000&size=200');
  });

  // Settings
  app.get('/api/settings', authenticateToken, async (req: any, res) => {
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', req.user.uid)
        .single();
      
      if (error && error.code !== 'PGRST116') throw error;
      res.json(data || {
        persona_name: 'Beatrice',
        user_call_name: 'Boss',
        voice: 'Puck',
        language: 'English',
        system_prompt: 'Classic Beatrice behavior.'
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/settings', authenticateToken, async (req: any, res) => {
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    try {
      const { error } = await supabase
        .from('user_settings')
        .upsert({ user_id: req.user.uid, ...req.body, updated_at: new Date().toISOString() });
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Memories
  app.get('/api/memories', authenticateToken, async (req: any, res) => {
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    try {
      const { data, error } = await supabase
        .from('user_memories')
        .select('*')
        .eq('user_id', req.user.uid)
        .order('created_at', { ascending: false });
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/memories', authenticateToken, async (req: any, res) => {
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    try {
      const { data, error } = await supabase
        .from('user_memories')
        .insert([{ user_id: req.user.uid, ...req.body, created_at: new Date().toISOString() }])
        .select()
        .single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/memories/:id', authenticateToken, async (req: any, res) => {
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    try {
      const { error } = await supabase
        .from('user_memories')
        .delete()
        .eq('id', req.params.id)
        .eq('user_id', req.user.uid);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Search Proxy
  app.get('/api/search', async (req, res) => {
    const { q } = req.query;
    const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
    const cx = process.env.GOOGLE_SEARCH_ENGINE_ID;
    if (!apiKey || !cx) return res.json({ results: [`Google Search not configured on server.`] });
    
    try {
      const searchRes = await fetch(`https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(q as string)}`);
      const data = await searchRes.json();
      const results = data.items?.map((item: any) => `${item.title}: ${item.snippet} (${item.link})`) || [];
      res.json({ results });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // WhatsApp Proxy
  app.get('/api/whatsapp/connect', async (req, res) => {
    const gowaUrl = process.env.GOWA_API_URL;
    if (!gowaUrl) return res.status(503).json({ error: 'GoWA API not configured' });
    
    try {
      const response = await fetch(`${gowaUrl}/instance/connect`, {
        headers: {
          'Authorization': `Basic ${Buffer.from(`${process.env.GOWA_USERNAME}:${process.env.GOWA_PASSWORD}`).toString('base64')}`
        }
      });
      res.json(await response.json());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/whatsapp/send', authenticateToken, async (req: any, res) => {
    const gowaUrl = process.env.GOWA_API_URL;
    if (!gowaUrl) return res.status(503).json({ error: 'GoWA API not configured' });
    
    try {
      const response = await fetch(`${gowaUrl}/message/sendText`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${Buffer.from(`${process.env.GOWA_USERNAME}:${process.env.GOWA_PASSWORD}`).toString('base64')}`
        },
        body: JSON.stringify({
          number: req.body.phone,
          text: req.body.message
        })
      });
      res.json(await response.json());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
  if (!IS_PROD) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(DIST_PATH));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(DIST_PATH, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Eburon AI Server running on http://localhost:${PORT}`);
  });
}

startServer();
