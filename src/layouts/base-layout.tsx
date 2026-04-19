import type React from "react";

export default function BaseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="page-frame h-full">
      {children}
    </div>
  );
}
