import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CONSYRION AI", template: "%s · CONSYRION AI" },
  description: "Multiple AI minds. Better decisions. Real execution.",
};

// Applies the stored theme before first paint to avoid a flash; falls back to the OS preference.
const themeScript = `try{var t=localStorage.getItem("consyrion-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
