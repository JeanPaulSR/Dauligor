import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Suppress ResizeObserver and WebSocket errors
const isSuppressedError = (message: any) => {
  if (!message) return false;
  const msg = typeof message === 'string' ? message : (message.message || message.reason?.message || '');
  
  return (
    msg.includes('ResizeObserver') ||
    msg.includes('ResizeObserver loop completed with undelivered notifications') ||
    msg.includes('ResizeObserver loop limit exceeded') ||
    msg.includes('WebSocket') ||
    msg.includes('vite') ||
    msg.includes('Script error')
  );
};

const originalError = console.error;
console.error = (...args: any[]) => {
  if (isSuppressedError(args[0])) return;
  originalError.apply(console, args);
};

const originalWarn = console.warn;
console.warn = (...args: any[]) => {
  if (isSuppressedError(args[0])) return;
  originalWarn.apply(console, args);
};

window.addEventListener('error', (e) => {
  if (isSuppressedError(e.message)) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
}, true);

window.addEventListener('unhandledrejection', (e: any) => {
  if (isSuppressedError(e.reason)) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
}, true);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
