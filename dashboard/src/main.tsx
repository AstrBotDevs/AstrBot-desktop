import { createRoot } from 'react-dom/client';
import { AppBootstrap } from './app/AppBootstrap';
import { themePrimaryPreference, themeSecondaryPreference } from './config/preferences';
import './assets/mdi-subset/materialdesignicons-subset.css';
import './styles/index.scss';

const storedPrimary = themePrimaryPreference.read();
const storedSecondary = themeSecondaryPreference.read();
if (storedPrimary) document.documentElement.style.setProperty('--astrbot-primary', storedPrimary);
if (storedSecondary) document.documentElement.style.setProperty('--astrbot-secondary', storedSecondary);

createRoot(document.getElementById('root')!).render(<AppBootstrap />);
