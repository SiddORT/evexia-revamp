import { createRoot } from 'react-dom/client';
import './auth/navigationGuard.js';
import App from './App.jsx';
import { Router } from 'wouter';
import './index.css';
import DevelopmentUpdateNotice from './development/DevelopmentUpdateNotice.jsx';

createRoot(document.getElementById('root')).render(<DevelopmentUpdateNotice><Router base={import.meta.env.BASE_URL.replace(/\/$/, '')}><App /></Router></DevelopmentUpdateNotice>);