// Tipos principales de los registros que se guardan en Supabase.

export type Turno = "dia" | "noche";

export interface Perfil {
  id: string;
  nombre: string;
  usuario: string;
  rol: string;
  cargo?: string | null;
  categoria?: string | number | null;
  flota_grupo?: string | null;
  activo: boolean;
  orden?: number;
}

export interface Trabajo {
  id: string;
  equipo: string;
  flota: string;
  tipo_trabajo: string;
  sintoma_causa?: string;
  descripcion?: string;
  ubicacion?: string;
  fecha: string;
  turno: Turno;
  grupo?: number | "";
  hora_inicio?: string;
  hora_fin?: string;
  estado_final?: string;
  participantes: string[];
  observaciones?: string;
  marca?: string | null;
  creado_en?: string;
  editado_en?: string;
}

export interface Aceite {
  id: string;
  equipo: string;
  flota: string;
  tipo_trabajo?: string;
  fecha: string;
  turno: Turno;
  tipo_operacion: string;
  tipo_aceite?: string;
  sistema_equipo?: string;
  cantidad_litros?: number | "";
  horometro?: number | "";
  participantes: string[];
  [clave: string]: unknown;
}

export interface Requerimiento {
  id: string;
  equipo: string;
  flota: string;
  numero_parte?: string;
  descripcion?: string;
  cantidad?: number;
  solicitante?: string;
  fecha_solicitud?: string;
  estado: string;
  [clave: string]: unknown;
}

export interface Equipo {
  id: string;
  codigo: string;
  flota: string;
  modelo: string;
  descripcion: string;
  activo: boolean;
}

export interface ItemCatalogo {
  id: string;
  nombre: string;
  activo: boolean;
}

export interface GrupoTrabajo {
  id: number;
  nombre: string;
  alcance: string;
}
