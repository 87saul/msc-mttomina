import { Navigate, Route, Routes } from "react-router-dom";
import { supabaseConfigurado } from "./lib/supabase";
import FaltaConfiguracion from "./components/FaltaConfiguracion";
import TruckShopApp from "./pages/TruckShopApp";

export default function App() {
  if (!supabaseConfigurado) return <FaltaConfiguracion />;
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/inicio" replace />} />
      <Route path="/*" element={<TruckShopApp />} />
    </Routes>
  );
}
