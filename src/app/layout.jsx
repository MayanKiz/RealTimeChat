import "./globals.css";

export const metadata = {
  title: "RealTimeChat | Live Drafts",
  description: "A private real-time chat where you can optionally share drafts as you write.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#02090b",
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
