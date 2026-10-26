// Se muestra si faltan las dos variables de conexión con Supabase.
export default function FaltaConfiguracion() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 560, margin: "60px auto", padding: 24, lineHeight: 1.5, color: "#1b1f24" }}>
      <h2 style={{ marginTop: 0 }}>Falta conectar la base de datos</h2>
      <p>La app no encuentra los datos de conexión con Supabase. En Netlify, agrega estas dos variables y vuelve a publicar:</p>
      <ul>
        <li>
          <b>VITE_SUPABASE_URL</b> — la "Project URL" de tu proyecto de Supabase.
        </li>
        <li>
          <b>VITE_SUPABASE_ANON_KEY</b> — la clave "Publishable" (o "anon public") de Supabase.
        </li>
      </ul>
      <p>Netlify → tu sitio → Site configuration → Environment variables → Add a variable. Luego: Deploys → Trigger deploy.</p>
    </div>
  );
}
