import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Союз-Бокса · Сквозная аналитика",
  description: "Дашборд сквозной аналитики клуба единоборств",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
