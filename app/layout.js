import './globals.css';
export const metadata = { title: 'Family Locator', description: 'Consent-based family location sharing' };
export const viewport = { width: 'device-width', initialScale: 1 };
export default function RootLayout({ children }) {
  return (<html lang="en"><body>{children}</body></html>);
}
