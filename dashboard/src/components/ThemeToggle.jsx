import { useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { getTheme, toggleTheme } from '../lib/theme.js';

// One-tap light/dark switch for the topbar.
export default function ThemeToggle() {
  const [theme, setTheme] = useState(getTheme());
  return (
    <button
      className="icon-btn no-print"
      title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
      aria-label="Toggle light or dark theme"
      onClick={() => setTheme(toggleTheme())}
    >
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
