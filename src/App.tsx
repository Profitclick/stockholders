import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/AppLayout";
import Index from "./pages/Index";
import Investors from "./pages/Investors";
import Companies from "./pages/Companies";
import Profiles from "./pages/Profiles";
import Segments from "./pages/Segments";
import Exports from "./pages/Exports";
import Plugins from "./pages/Plugins";
import AuditLog from "./pages/AuditLog";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Index />} />
            <Route path="/investors" element={<Investors />} />
            <Route path="/companies" element={<Companies />} />
            <Route path="/profiles" element={<Profiles />} />
            <Route path="/segments" element={<Segments />} />
            <Route path="/exports" element={<Exports />} />
            <Route path="/plugins" element={<Plugins />} />
            <Route path="/audit-log" element={<AuditLog />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
