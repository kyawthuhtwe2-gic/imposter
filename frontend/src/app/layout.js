import "./globals.css";

export const metadata = {
  title: "လျှို့ဝှက်လူလိမ်",
  description: "သူငယ်ချင်းများနှင့် လျှို့ဝှက်လူလိမ်ဂိမ်း ကစားပါ။",
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
      <body>{children}</body>
    </html>
  );
}
