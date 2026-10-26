import { useState } from "react";
import { cambiarMiContrasena } from "../lib/datos";

// Ventana para que el usuario conectado cambie su propia contraseña
// (menú ⋮ → Cambiar contraseña).
export default function CambiarContrasena({ onCerrar }: { onCerrar: () => void }) {
  const [nueva, setNueva] = useState("");
  const [repetir, setRepetir] = useState("");
  const [error, setError] = useState("");
  const [listo, setListo] = useState(false);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setError("");
    if (nueva.length < 6) return setError("La contraseña debe tener al menos 6 caracteres.");
    if (nueva !== repetir) return setError("Las contraseñas no coinciden.");
    setGuardando(true);
    try {
      await cambiarMiContrasena(nueva);
      setListo(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="ts-modal-form-fondo ts-login-fondo">
      <div className="ts-login-caja" role="dialog" aria-modal="true">
        <div className="ts-login">
          <h2>Cambiar contraseña</h2>
          {listo ? (
            <>
              <p>Tu contraseña se cambió correctamente.</p>
              <button type="button" className="ts-btn ts-login-btn" onClick={onCerrar}>
                Aceptar
              </button>
            </>
          ) : (
            <>
              <label className="ts-campo">
                <span>Nueva contraseña</span>
                <input type="password" autoComplete="new-password" value={nueva} onChange={(e) => setNueva(e.target.value)} />
              </label>
              <label className="ts-campo">
                <span>Repite la nueva contraseña</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={repetir}
                  onChange={(e) => setRepetir(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && guardar()}
                />
              </label>
              {error && <span className="ts-error-texto">{error}</span>}
              <div className="ts-form-acciones">
                <button type="button" className="ts-btn-ghost" onClick={onCerrar}>
                  Cancelar
                </button>
                <button type="button" className="ts-btn" onClick={guardar} disabled={guardando}>
                  {guardando ? "Guardando…" : "Guardar"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
