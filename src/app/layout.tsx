import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SpotOn — Revenue Operating System',
  description:
    'A SaaS revenue operating system: accounts, pipeline, quoting and approvals, subscriptions, co-termed amendments, renewals, ARR movement, customer health and service — with an MCP server for Claude.',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Archivo Black gives the condensed, heavy display voice the theme wants;
            the stack degrades to Impact and then a system gothic. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Archivo:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
