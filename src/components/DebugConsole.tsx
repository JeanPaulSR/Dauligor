import React, { useState, useEffect } from 'react';
import { Terminal, X, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { Button } from './ui/button';

interface LogEntry {
  id: string;
  timestamp: string;
  level: 'log' | 'warn' | 'error' | 'info';
  message: string;
  data?: any;
}

export default function DebugConsole() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(true);

  useEffect(() => {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    const originalInfo = console.info;

    const addLog = (level: LogEntry['level'], args: any[]) => {
      const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
      const newEntry: LogEntry = {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toLocaleTimeString(),
        level,
        message,
        data: args.length > 1 ? args.slice(1) : undefined
      };
      setTimeout(() => {
        setLogs(prev => [newEntry, ...prev].slice(0, 50));
      }, 0);
    };

    console.log = (...args) => {
      originalLog(...args);
      addLog('log', args);
    };
    console.warn = (...args) => {
      originalWarn(...args);
      addLog('warn', args);
    };
    console.error = (...args) => {
      originalError(...args);
      addLog('error', args);
    };
    console.info = (...args) => {
      originalInfo(...args);
      addLog('info', args);
    };

    return () => {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
      console.info = originalInfo;
    };
  }, []);

  if (!isOpen) {
    return (
      <button 
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 bg-ink text-gold p-2 rounded-full shadow-lg z-50 hover:scale-110 transition-transform"
        title="Open Debug Console"
      >
        <Terminal className="w-5 h-5" />
      </button>
    );
  }

  return (
    <div className={`fixed bottom-0 right-0 w-full md:w-[500px] bg-ink border-t md:border-l border-gold/20 shadow-2xl z-50 transition-all ${isMinimized ? 'h-10' : 'h-[400px]'}`}>
      <div className="flex items-center justify-between px-4 h-10 border-b border-gold/10 bg-gold/5">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-gold" />
          <span className="label-text">Archive Debug Console</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setLogs([])} className="h-6 w-6 p-0 text-gold/40 hover:text-gold">
            <Trash2 className="w-3 h-3" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setIsMinimized(!isMinimized)} className="h-6 w-6 p-0 text-gold/40 hover:text-gold">
            {isMinimized ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setIsOpen(false)} className="h-6 w-6 p-0 text-gold/40 hover:text-gold">
            <X className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {!isMinimized && (
        <div className="p-2 h-[360px] overflow-y-auto font-mono text-[10px] space-y-1 bg-black/20">
          {logs.map(log => (
            <div key={log.id} className={`flex gap-2 p-1 rounded ${
              log.level === 'error' ? 'bg-blood/10 text-blood' :
              log.level === 'warn' ? 'bg-gold/10 text-gold' :
              'text-gold/60'
            }`}>
              <span className="opacity-30 shrink-0">[{log.timestamp}]</span>
              <span className="break-all">{log.message}</span>
            </div>
          ))}
          {logs.length === 0 && (
            <div className="text-center py-10 text-gold/20 italic">No logs recorded yet.</div>
          )}
        </div>
      )}
    </div>
  );
}
