import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PRODUCT_NAME } from '@/config/product';
import { AppShell } from '@/app/AppShell';
import { LoginPage } from '@/app/LoginPage';
import { RequireApproved, RequireAuth, RequirePlatformAdmin } from '@/app/guards';
import { OpportunitiesPage } from '@/features/opportunities/OpportunitiesPage';
import { DossierPage } from '@/features/opportunities/DossierPage';
import { NewOpportunityPage } from '@/features/opportunities/NewOpportunityPage';
import { EditorPage } from '@/features/opportunities/editor/EditorPage';
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
import { AdminImportPage, AdminPublishablePage } from '@/features/admin/ImportPages';
import {
  AdminAreaPage,
  AdminAreasPage,
  AdminLeadsPage,
  AdminLogsPage,
  BrokerLeadsPage,
} from '@/features/admin/CurationPages';
import { OwnerLeadPage } from '@/features/owner/OwnerLeadPage';
import { OwnerAreasPage } from '@/features/owner/OwnerAreasPage';
import { ThesesPage } from '@/features/theses/ThesesPage';
import { AdminMatchesPage, AdminThesesPage } from '@/features/admin/MatchPages';

export function App() {
  useEffect(() => {
    document.title = PRODUCT_NAME;
  }, []);
  return (
    <Routes>
      <Route path="/entrar" element={<LoginPage />} />
      <Route path="/cadastro" element={<SignupPage />} />
      <Route path="/convite/:token" element={<InvitationPage />} />
      {/* Porta do proprietário: pública (lead anônimo) ou com conta de proprietário (D021). */}
      <Route path="/cadastrar-area" element={<OwnerLeadPage />} />
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
        <Route path="/minhas-areas" element={<OwnerAreasPage />} />

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
          path="/teses"
          element={
            <RequireApproved>
              <ThesesPage />
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
          path="/areas/leads"
          element={
            <RequireApproved>
              <BrokerLeadsPage />
            </RequireApproved>
          }
        />
        <Route
          path="/areas/:id/editar"
          element={
            <RequireApproved>
              <EditorPage />
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
          <Route index element={<Navigate to="leads" replace />} />
          <Route path="leads" element={<AdminLeadsPage />} />
          <Route path="areas" element={<AdminAreasPage />} />
          <Route path="areas/:id" element={<AdminAreaPage />} />
          <Route path="publicaveis" element={<AdminPublishablePage />} />
          <Route path="importacao" element={<AdminImportPage />} />
          <Route path="teses" element={<AdminThesesPage />} />
          <Route path="matches" element={<AdminMatchesPage />} />
          <Route path="logs" element={<AdminLogsPage />} />
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
