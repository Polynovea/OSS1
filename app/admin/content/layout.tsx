"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function RetiredContentLayout({ children }: { children: React.ReactNode }) { const router = useRouter(); useEffect(() => { router.replace("/admin/cms"); }, [router]); return <div className="hidden">{children}</div>; }
