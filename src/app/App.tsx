import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PRODUCT_NAME } from '@/config/product';
import { AppShell } from '@/app/AppShell';
import { LoginPage } from '@/app/LoginPage';
import { RequireAuth } from '@/app/guards';
import { OpportunitiesPage } from '@/features/opportunities/OpportunitiesPage';
import { DossierPage } from '@/features/opportunities/DossierPage';

export function App() {
  useEffect(() => {
    document.title = PRODUCT_NAME;
  }, []);
  return (
    <Routes>
      <Route path="/entrar" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/oportunidades" element={<OpportunitiesPage />} />
        <Route path="/oportunidades/:id" element={<DossierPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/oportunidades" replace />} />
    </Routes>
  );
}
