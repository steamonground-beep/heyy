import './globals.css';

export const metadata = {
  title: 'Snakes Hosting',
  description: 'Host your own game backend with your Discord-linked account.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}