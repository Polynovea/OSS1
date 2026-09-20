import type { Metadata } from "next";
import ProtectedRoute from "@/components/admin/ProtectedRoute";

export const metadata: Metadata = {
  title: "Polynovea Admin",
  description: "Executive command center for Polynovea",
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      {children}
    </ProtectedRoute>
  );
}
