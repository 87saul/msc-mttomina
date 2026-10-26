-- =====================================================================
--  TRUCK SHOP — SCRIPT 3 DE 3 (OPCIONAL): CARGAR EL PERSONAL DEL TALLER
--  Crea las cuentas del personal (Back Office, Grupos 1–4, Lubrico y
--  Planificación) con su usuario y una contraseña provisional para todos:
--
--        Contraseña provisional:  Ts2026*
--
--  Cada persona ya puede ingresar con su usuario (ej. GuidoC) y esa
--  contraseña. El Administrador puede cambiar cualquier contraseña desde
--  Configuración, y cada usuario la suya desde el menú ⋮ → Cambiar contraseña.
--  Si un usuario ya existe, se salta (se puede ejecutar más de una vez).
-- =====================================================================

do $$
declare
  r record;
  v_creados int := 0;
begin
  for r in select * from (values
    ('GuidoC', 'Carvajal Guido', 'Supervisor', 'Supervisor', 'supervision', 'ACARREO'),
    ('MartinV', 'Vargas Martin', 'Supervisor', 'Supervisor', 'supervision', 'ACARREO'),
    ('JuanT', 'Tintaya Juan', 'Supervisor', 'Supervisor', 'supervision', 'CARGUIO'),
    ('EvansO', 'Ossio Evans', 'Supervisor', 'Supervisor', 'supervision', 'CARGUIO'),
    ('QuintinC', 'Cabita Mamani Quintín', 'Técnico', 'Técnico', '1', 'ACARREO'),
    ('VicenteC', 'Calcina Muraña Vicente', 'Técnico', 'Técnico', '1', 'ACARREO'),
    ('RonaldC', 'Colque Quispe Ronald Ruben', 'Técnico', 'Técnico', '1', 'ACARREO'),
    ('JoseC', 'Condori Rojas José Carlos', 'Técnico', 'Técnico', '1', 'ACARREO'),
    ('AbnerF', 'Fernandez Mamani Abner', 'Técnico', 'Técnico', '1', 'ACARREO'),
    ('NazarioG', 'Gonzáles Copa Nazario', 'Técnico', 'Técnico', '1', 'ACARREO'),
    ('EduardoH', 'Herrera Salas Eduardo', 'Técnico', 'Técnico', '1', 'ACARREO'),
    ('PedroM', 'Mamani Guarachi Pedro Manuel', 'Técnico', 'Técnico', '1', 'ACARREO'),
    ('GastonQ', 'Quintana Céspedes Gastón Fabrony', 'Técnico', 'Técnico', '1', 'ACARREO'),
    ('RaulQ', 'Quispe Pacsi Raul Joaquín', 'Técnico', 'Técnico', '1', 'ACARREO'),
    ('EstebanF', 'Flores Ahocalla Esteban', 'Técnico', 'Técnico', '1', 'CARGUIO'),
    ('OscarB', 'Barrios Bascope Oscar Luis', 'Técnico', 'Técnico', '1', 'CARGUIO'),
    ('WilberD', 'Díaz Condori Wilber', 'Técnico', 'Técnico', '1', 'CARGUIO'),
    ('GermanF', 'Fernández Colque Germán Abercio', 'Técnico', 'Técnico', '1', 'CARGUIO'),
    ('FroilanM', 'Mamani Condori Froilan Placido', 'Técnico', 'Técnico', '1', 'CARGUIO'),
    ('AlvaroM', 'Mercado Colque Alvaro Fernando', 'Técnico', 'Técnico', '1', 'CARGUIO'),
    ('NemesioM', 'Muraña Yañez Nemesio Claudio', 'Técnico', 'Técnico', '1', 'CARGUIO'),
    ('MarioP', 'Patzi Contreras Mario', 'Técnico', 'Técnico', '1', 'CARGUIO'),
    ('HoracioS', 'Sánchez Mora Horacio Abelardo', 'Técnico', 'Técnico', '1', 'CARGUIO'),
    ('TadeoV', 'Valencia Camata Tadeo', 'Técnico', 'Técnico', '1', 'CARGUIO'),
    ('JhasmanyC', 'Choque Callisaya Jhasmany', 'Técnico', 'Técnico', '1', 'CARGUIO'),
    ('HilsenM', 'Muñoz Sanchez Hilsen Tito', 'Técnico', 'Técnico', '2', 'ACARREO'),
    ('PabloA', 'Amador Quispe Pablo', 'Técnico', 'Técnico', '2', 'ACARREO'),
    ('RaymundoA', 'Anze Martínez Raymundo', 'Técnico', 'Técnico', '2', 'ACARREO'),
    ('RobertoA', 'Aviz Reinaga Roberto', 'Técnico', 'Técnico', '2', 'ACARREO'),
    ('EdwinA', 'Ayala Llave Edwin', 'Técnico', 'Técnico', '2', 'ACARREO'),
    ('RubenC', 'Callisaya Beltran Ruben', 'Técnico', 'Técnico', '2', 'ACARREO'),
    ('SamuelR', 'Rodriguez Huisa Samuel', 'Técnico', 'Técnico', '2', 'ACARREO'),
    ('RaulM', 'Mamani Corani Raúl Emilio', 'Técnico', 'Técnico', '2', 'ACARREO'),
    ('AngelM', 'Montoya Montoya Ángel', 'Técnico', 'Técnico', '2', 'ACARREO'),
    ('JhonnyV', 'Valdivia Capriles Jhonny Wilfredo', 'Técnico', 'Técnico', '2', 'ACARREO'),
    ('GustavoZ', 'Zegarra Huiza Gustavo Adolfo', 'Técnico', 'Técnico', '2', 'ACARREO'),
    ('AlbertoC', 'Callejas Juarez Alberto', 'Técnico', 'Técnico', '2', 'CARGUIO'),
    ('BenjaminS', 'Soruco Velasquez Benjamin Vicente', 'Técnico', 'Técnico', '2', 'CARGUIO'),
    ('MiltonC', 'Calcina Gonzáles Milton Hernán', 'Técnico', 'Técnico', '2', 'CARGUIO'),
    ('AbelC', 'Cardenas Villca Abel', 'Técnico', 'Técnico', '2', 'CARGUIO'),
    ('EliasC', 'Carrillo Mendoza Elías', 'Técnico', 'Técnico', '2', 'CARGUIO'),
    ('PauloC', 'Cortez Menacho Paulo Gerson', 'Técnico', 'Técnico', '2', 'CARGUIO'),
    ('JuanM', 'Mamani Flores Juan', 'Técnico', 'Técnico', '2', 'CARGUIO'),
    ('LucioQ', 'Quispe Choquevillca Lucio', 'Técnico', 'Técnico', '2', 'CARGUIO'),
    ('JorgeR', 'Rocha Callejas Jorge', 'Técnico', 'Técnico', '2', 'CARGUIO'),
    ('EdmundoY', 'Yucra Camata Edmundo', 'Técnico', 'Técnico', '2', 'CARGUIO'),
    ('RobertoF', 'Flores Cespedes Roberto Emilio', 'Técnico', 'Técnico', '2', 'CARGUIO'),
    ('NicanorM', 'Morales Chungara Nicanor Dionicio', 'Técnico', 'Técnico', '3', 'ACARREO'),
    ('HumbertoA', 'Ayala Poma Humberto', 'Técnico', 'Técnico', '3', 'ACARREO'),
    ('PedroC', 'Calderón Morales Pedro Rolando', 'Técnico', 'Técnico', '3', 'ACARREO'),
    ('ReneC', 'Chávez Chana René', 'Técnico', 'Técnico', '3', 'ACARREO'),
    ('EdilbertoC', 'Chire Condori Edilberto Lucio', 'Técnico', 'Técnico', '3', 'ACARREO'),
    ('AbelCM', 'Choquert Machaca Abel Omar', 'Técnico', 'Técnico', '3', 'ACARREO'),
    ('ArminC', 'Colque Flores Armin Winzor', 'Técnico', 'Técnico', '3', 'ACARREO'),
    ('GilbertoF', 'Flores Salinas Gilberto Felix', 'Técnico', 'Técnico', '3', 'ACARREO'),
    ('BertyG', 'Gonzales Quispe Berty Hilarión', 'Técnico', 'Técnico', '3', 'ACARREO'),
    ('AlexS', 'Sirpa Alex Clemente', 'Técnico', 'Técnico', '3', 'ACARREO'),
    ('SergioV', 'Velarde Romay Sergio', 'Técnico', 'Técnico', '3', 'ACARREO'),
    ('LizandroC', 'Cayo Mayorga Lizandro', 'Técnico', 'Técnico', '3', 'CARGUIO'),
    ('FranciscoA', 'Aspi Aspi Francisco', 'Técnico', 'Técnico', '3', 'CARGUIO'),
    ('HugoC', 'Calcina Muraña Hugo Faustino', 'Técnico', 'Técnico', '3', 'CARGUIO'),
    ('ArmandoC', 'Calderón Yebara Armando', 'Técnico', 'Técnico', '3', 'CARGUIO'),
    ('FreddyM', 'Mamani Pacosillo Freddy', 'Técnico', 'Técnico', '3', 'CARGUIO'),
    ('RicardoM', 'Matha Aruquipa Ricardo', 'Técnico', 'Técnico', '3', 'CARGUIO'),
    ('FaustinoM', 'Muraña Lazo Faustino', 'Técnico', 'Técnico', '3', 'CARGUIO'),
    ('WilfredoA', 'Acho Surco Wilfredo', 'Técnico', 'Técnico', '3', 'CARGUIO'),
    ('MarcoR', 'Ramos Zubia Marco Antonio', 'Técnico', 'Técnico', '3', 'CARGUIO'),
    ('DiegoV', 'Valdivia Mendoza Diego Andres', 'Técnico', 'Técnico', '3', 'CARGUIO'),
    ('EdgarM', 'Mamani Callisaya Edgar', 'Técnico', 'Técnico', '3', 'CARGUIO'),
    ('ArielG', 'Gomez Velasco Ariel Osmar', 'Técnico', 'Técnico', '4', 'ACARREO'),
    ('JoseA', 'Ayaviri Ramos José Angel', 'Técnico', 'Técnico', '4', 'ACARREO'),
    ('RubenB', 'Basilio Veniz Rubén', 'Técnico', 'Técnico', '4', 'ACARREO'),
    ('AlexC', 'Colque Cruz Alex Bladimir', 'Técnico', 'Técnico', '4', 'ACARREO'),
    ('AntonioG', 'Gonzales Quispe Antonio', 'Técnico', 'Técnico', '4', 'ACARREO'),
    ('SantosL', 'León Guzmán Santos', 'Técnico', 'Técnico', '4', 'ACARREO'),
    ('MoisesL', 'Lima Escobar Moises Diego', 'Técnico', 'Técnico', '4', 'ACARREO'),
    ('WenceslaoM', 'Mayta Humerez Wenceslao Felix', 'Técnico', 'Técnico', '4', 'ACARREO'),
    ('HayderR', 'Romero Aneiva Hayder Richard', 'Técnico', 'Técnico', '4', 'ACARREO'),
    ('DilverthM', 'Dilverth Mamani', 'Técnico', 'Técnico', '4', 'ACARREO'),
    ('JoseB', 'Baldiviezo Olmos Jose Luis', 'Técnico', 'Técnico', '4', 'ACARREO'),
    ('EdwinB', 'Bustos Fernández Edwin Rolando', 'Técnico', 'Técnico', '4', 'CARGUIO'),
    ('VictorA', 'Aiza Eugenio Victor Humberto', 'Técnico', 'Técnico', '4', 'CARGUIO'),
    ('WillsonC', 'Cabrera Choque Willson', 'Técnico', 'Técnico', '4', 'CARGUIO'),
    ('DesiderioC', 'Cruz Choque Desiderio Germán', 'Técnico', 'Técnico', '4', 'CARGUIO'),
    ('EfrainG', 'Gutiérrez Ramos Efraín', 'Técnico', 'Técnico', '4', 'CARGUIO'),
    ('JoseCF', 'Copa Flores Jose Luis', 'Técnico', 'Técnico', '4', 'CARGUIO'),
    ('RobertoL', 'Limachi Callisaya Roberto', 'Técnico', 'Técnico', '4', 'CARGUIO'),
    ('BerardoP', 'Portillo Torrez Berardo Jaime', 'Técnico', 'Técnico', '4', 'CARGUIO'),
    ('FaustoR', 'Rosario Gonzales Fausto', 'Técnico', 'Técnico', '4', 'CARGUIO'),
    ('EdwardT', 'Torrez Edward Marco', 'Técnico', 'Técnico', '4', 'CARGUIO'),
    ('PonceM', 'Muraña Yañez Ponce Hipolito', 'Técnico', 'Técnico', '4', 'CARGUIO'),
    ('GustavoG', 'Gorriti Gustavo', 'Planificador', 'Planificador', 'planificacion', 'ACARREO'),
    ('JaimeK', 'Klajebick Jaime', 'Planificador', 'Planificador', 'planificacion', 'ACARREO'),
    ('JaimeS', 'Sandi Jaime', 'Planificador', 'Planificador', 'planificacion', 'CARGUIO'),
    ('ReneB', 'Barrientos Rene', 'Planificador', 'Planificador', 'planificacion', 'CARGUIO'),
    ('AlexM', 'Mobil Alex', 'Lubricador', 'Lubricador', 'lubrico', null),
    ('GabrielM', 'Mobil Gabriel', 'Lubricador', 'Lubricador', 'lubrico', null),
    ('JuanMo', 'Mobil Juan', 'Lubricador', 'Lubricador', 'lubrico', null),
    ('VictorM', 'Mobil Víctor', 'Lubricador', 'Lubricador', 'lubrico', null)
  ) as t(usuario, nombre, rol, cargo, categoria, flota_grupo)
  loop
    if not exists (select 1 from public.perfiles where lower(usuario) = lower(r.usuario)) then
      perform public._crear_usuario(r.usuario, 'Ts2026*', r.nombre, r.rol, r.cargo, r.categoria, r.flota_grupo);
      v_creados := v_creados + 1;
    end if;
  end loop;
  raise notice 'Usuarios creados: %', v_creados;
end $$;
