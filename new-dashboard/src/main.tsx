import { createRoot } from 'react-dom/client';
import App from './App';
import './assets/mdi-subset/materialdesignicons-subset.css';
import './styles/index.scss';

const storedPrimary = localStorage.getItem('themePrimary');
const storedSecondary = localStorage.getItem('themeSecondary');
if (storedPrimary) document.documentElement.style.setProperty('--astrbot-primary', storedPrimary);
if (storedSecondary) document.documentElement.style.setProperty('--astrbot-secondary', storedSecondary);

createRoot(document.getElementById('root')!).render(
  <App />,
);
