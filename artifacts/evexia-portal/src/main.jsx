import { createRoot } from 'react-dom/client';
import './auth/navigationGuard.js';
import App from './App.jsx';
import { Router } from 'wouter';
import './index.css';
import DevelopmentBoundary from './development/DevelopmentBoundary.jsx';

createRoot(document.getElementById('root')).render(<DevelopmentBoundary><Router base={import.meta.env.BASE_URL.replace(/\/$/, '')}><App /></Router></DevelopmentBoundary>);