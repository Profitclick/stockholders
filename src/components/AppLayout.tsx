import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Link, Navigate, Outlet } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

export function AppLayout() {
  const { session, isAdmin, loading } = useAuth();
  if (loading) return <p className="p-6 text-muted-foreground">Laster…</p>;
  if (!session) return <Navigate to="/auth" replace />;
  if (!isAdmin) return (
    <div className="p-6 space-y-3">
      <p className="text-muted-foreground">Denne kontoen har ikke tilgang.</p>
      <Button size="sm" variant="outline" onClick={() => supabase.auth.signOut()}>Logg ut</Button>
    </div>
  );
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-12 flex items-center border-b px-4 shrink-0">
            <SidebarTrigger />
            <span className="ml-3 text-sm font-semibold text-foreground">
              Investor Pattern Studio
            </span>
            <div className="ml-auto">
              {session ? (
                <Button size="sm" variant="ghost" onClick={() => supabase.auth.signOut()}>Logg ut</Button>
              ) : (
                <Button size="sm" variant="ghost" asChild><Link to="/auth">Logg inn</Link></Button>
              )}
            </div>
          </header>
          <main className="flex-1 overflow-auto p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
