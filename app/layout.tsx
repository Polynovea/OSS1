import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Polynovea CMS",
  description: "Governed content operations platform",
};

const themeBoot = `(function(){try{var k='polynovea-cms-theme';var p=localStorage.getItem(k)||'system';if(p!=='light'&&p!=='dark'&&p!=='system')p='system';var r=p==='system'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):p;var e=document.documentElement;e.dataset.themePreference=p;e.dataset.theme=r;e.classList.toggle('dark',r==='dark');e.style.colorScheme=r;}catch(_){document.documentElement.dataset.theme='dark';document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark';}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeBoot }} /></head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
