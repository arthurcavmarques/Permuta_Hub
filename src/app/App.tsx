import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PRODUCT_NAME } from '@/config/product';
import { AppShell } from '@/app/AppShell';
import { LoginPage } from '@/app/LoginPage';
import { RequireApproved, RequireAuth, RequirePlatformAdmin } from '@/app/guards';
import { OpportunitiesPage } from '@/features/opportunities/OpportunitiesPage';
import { DossierPage } from '@/features/opportunities/DossierPage';
import { NewOpportunityPage } from '@/features/opportunities/NewOpportunityPage';
import { SignupPage } from '@/features/account/SignupPage';
import { AccountPage } from '@/features/account/AccountPage';
import { OrganizationPage } from '@/features/organizations/OrganizationPage';
import { InvitationPage } from '@/features/organizations/InvitationPage';
import {
  AdminCreciPage,
  AdminLayout,
  AdminOrganizationsPage,
  AdminOutboxPage,
  AdminUsersPage,
} from '@/features/admin/AdminPages';
import { AdminTermsPage } from '@/features/admin/TermsPage';

export function App() {
  useEffect(() => {
    document.title = PRODUCT_NAME;
  }, []);
  return (
    <Routes>
      <Route path="/entrar" element={<LoginPage />} />
      <Route path="/cadastro" element={<SignupPage />} />
      <Route path="/convite/:token" element={<InvitationPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        {/* Acessível a qualquer conta, inclusive pendente (D014). */}
        <Route path="/conta" element={<AccountPage />} />
        <Route path="/organizacao/:id" element={<OrganizationPage />} />

        <Route
          path="/oportunidades"
          element={
            <RequireApproved>
              <OpportunitiesPage />
            </RequireApproved>
          }
        />
        <Route
          path="/oportunidades/:id"
          element={
            <RequireApproved>
              <DossierPage />
            </RequireApproved>
          }
        />
        <Route
          path="/areas/nova"
          element={
            <RequireApproved>
              <NewOpportunityPage />
            </RequireApproved>
          }
        />
        <Route
          path="/admin"
          element={
            <RequirePlatformAdmin>
              <AdminLayout />
            </RequirePlatformAdmin>
          }
        >
          <Route index element={<Navigate to="usuarios" replace />} />
          <Route path="usuarios" element={<AdminUsersPage />} />
          <Route path="creci" element={<AdminCreciPage />} />
          <Route path="organizacoes" element={<AdminOrganizationsPage />} />
          <Route path="termos" element={<AdminTermsPage />} />
          <Route path="caixa-de-saida" element={<AdminOutboxPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/oportunidades" replace />} />
    </Routes>
  );
}
