import { createRoot } from 'react-dom/client';
import './auth/navigationGuard.js';
import App from './App.jsx';
import { Router } from 'wouter';
import './index.css';

createRoot(document.getElementById('root')).render(<Router base={import.meta.env.BASE_URL.replace(/\/$/, '')}><App /></Router>);