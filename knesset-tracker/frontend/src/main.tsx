import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { Layout } from "./components/Layout";
import { isLang } from "./i18n";
import { BillPage } from "./pages/Bill";
import { BillsPage } from "./pages/Bills";
import { CommitteePage } from "./pages/Committee";
import { CommitteesPage } from "./pages/Committees";
import { HomePage } from "./pages/Home";
import { MkPage } from "./pages/Mk";
import { MksPage } from "./pages/Mks";
import { NotFound } from "./pages/NotFound";
import { AccountPage } from "./pages/Account";
import { LoginPage } from "./pages/Login";
import { SearchPage } from "./pages/Search";
import { VerifyPage } from "./pages/Verify";
import { ApiPage, DataQualityPage, StatusPage } from "./pages/About";
import "./styles.css";

function LangGuard() {
  const { lang } = useParams();
  return isLang(lang) ? <Layout /> : <Navigate to="/he" replace />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/he" replace />} />
        <Route path="/:lang" element={<LangGuard />}>
          <Route index element={<HomePage />} />
          <Route path="bills" element={<BillsPage />} />
          <Route path="bills/:id" element={<BillPage />} />
          <Route path="mks" element={<MksPage />} />
          <Route path="mks/:id" element={<MkPage />} />
          <Route path="committees" element={<CommitteesPage />} />
          <Route path="committees/:id" element={<CommitteePage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="auth/verify" element={<VerifyPage />} />
          <Route path="account" element={<AccountPage />} />
          <Route path="status" element={<StatusPage />} />
          <Route path="data-quality" element={<DataQualityPage />} />
          <Route path="api" element={<ApiPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
