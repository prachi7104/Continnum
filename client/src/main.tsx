// Mounts the Continuum chat client.
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './style.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing chat container');
createRoot(container).render(<App />);
