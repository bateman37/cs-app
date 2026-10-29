import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CS App", template: "%s · CS App" },
  description: "Análisis de Customer Success de Vincle",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <a className="skip" href="#contenido">Saltar al contenido</a>
        {children}
      </body>
    </html>
  );
}
