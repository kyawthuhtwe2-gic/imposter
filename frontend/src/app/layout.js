import "./globals.css";

export const metadata = {
  title: "Imposter",
  description: "သူငယ်ချင်းများနှင့် Imposter ဂိမ်း ကစားပါ။",
  icons: {
    icon: "/imposter-logo-icon.webp",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="my" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{var theme=localStorage.getItem("imposter-theme");if(theme==="day"||theme==="night"){document.documentElement.dataset.theme=theme}}catch{}',
          }}
        />
      </head>
      <body>
        {children}
        <footer className="page-footer">
          <div className="creator-watermark" aria-label="Developed by Kyaw Thu, 2026-11-10">
            <span>Developed by Kyaw Thu</span>
            <span>2026.11.10</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
