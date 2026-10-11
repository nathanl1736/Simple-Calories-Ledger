import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installPressFeedback } from './ui/press';
import '@fontsource-variable/nunito';
import './styles.css';

installPressFeedback();

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
