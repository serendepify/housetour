import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "HouseTour - Walkable 3D Real Estate Tours",
    template: "%s · HouseTour",
  },
  description:
    "High-end B2B platform for continuous 3D and VR apartment tours. Upload 360° captures, publish walkable experiences, embed on listings.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
