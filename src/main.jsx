import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './index.css';

// main.jsx
// ---------
// CONVERSION NOTE: this is the file @main/VISHWASApp.swift's role splits
// into on the web — Swift's `@main` attribute both declared the entry
// point AND built the view tree in one struct; here main.jsx only mounts
// <App/> (see app/App.jsx for the provider/router tree itself).

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
