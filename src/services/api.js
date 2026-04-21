import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to requests if it exists
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers['x-auth-token'] = token;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Auth APIs
export const register = (email, password) => 
  api.post('/api/auth/register', { email, password });

export const login = (email, password) => 
  api.post('/api/auth/login', { email, password });

export const getCurrentUser = () => 
  api.get('/api/auth/me');

// Session APIs
export const createSession = (name) => 
  api.post('/api/sessions', { name });

export const getHostSessions = () => 
  api.get('/api/sessions/host');

export const getSessionByCode = (code) => 
  api.get(`/api/sessions/code/${code}`);

export const joinSession = (code, name, email, phone) => 
  api.post('/api/sessions/join', { code, name, email, phone });

export const getParticipants = (sessionId) => 
  api.get(`/api/sessions/${sessionId}/participants`);

export default api;
