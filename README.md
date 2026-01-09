# Explicación del Sistema SISA (Sistema Integrado de Información Sanitaria Argentina)

Este documento explica la estructura y funcionamiento del sistema de integración con la API de SISA (sisa.msal.gov.ar), que permite descargar y procesar información de profesionales de la salud registrados en Argentina.

## Estructura General

El sistema está dividido en dos partes principales:

1. **Datasources** (`src/datasources/sisa.msal.gov.ar`): Se encarga de **descargar** los datos desde la API de SISA
2. **Datasets** (`src/datasets/sisa.msal.gov.ar`): Se encarga de **procesar y transformar** los datos descargados

---

## 📥 Datasources (Descarga de Datos)

### Propósito
Los datasources son responsables de obtener los datos crudos desde la API de SISA y guardarlos en caché local para su posterior procesamiento.

### Archivos

#### `index.ts` - Punto de Entrada Principal
Este archivo es el punto de entrada para descargar datos históricos. Su función es:

- **Validar variables de entorno**: Verifica que estén definidas:
  - `SISA_API`: URL base de la API de SISA
  - `SISA_USER`: Usuario para autenticación
  - `SISA_PASSWORD`: Contraseña para autenticación

- **Descargar datos en dos modos**:
  1. **Modo "Registro"**: Descarga profesionales registrados por primera vez
  2. **Modo "Modificacion"**: Descarga profesionales que han sido modificados

**Flujo de ejecución:**
```typescript
await downloadFrom(API_BASE, USERNAME, PASSWORD, 'Registro');
await downloadFrom(API_BASE, USERNAME, PASSWORD, 'Modificacion');
```

#### `historico.ts` - Descarga Histórica por Fechas
Este módulo implementa la lógica para descargar datos día por día desde una fecha inicial hasta la fecha actual.

**Funcionalidades principales:**

1. **`getStartDate(mode: Modo)`**: 
   - Determina la fecha de inicio para la descarga
   - Busca en el caché local (`cache/sisa.msal.gov.ar/sisa/services/rest/profesional`) la última fecha descargada
   - Si no encuentra nada, usa la fecha por defecto: `2010-08-28`
   - Esto permite reanudar descargas interrumpidas sin duplicar datos

2. **`downloadFrom(apiBase, username, password, mode)`**:
   - Crea un `Getter` con configuración específica:
     - Timeout de 500ms
     - Tamaño máximo de respuesta: 200
     - Headers: `Content-Type: application/json`
     - Parámetros a excluir del caché: `fechaModificacionHasta`, `clave`, `usuario`
   
   - **Bucle de descarga diaria**:
     - Itera día por día desde `getStartDate()` hasta la fecha actual
     - Para cada día, construye una URL con parámetros:
       - `fechaRegistroDesde` / `fechaModificacionDesde`: Fecha del día
       - `fechaRegistroHasta` / `fechaModificacionHasta`: Misma fecha (rango de un día)
       - `clave`: Contraseña
       - `usuario`: Usuario
     
     - **Manejo de cuota diaria**:
       - Si la respuesta contiene `QUOTA_DIARIA_EXCEDIDA`, lanza una excepción `DailyQuotaExceeded`
       - Elimina el archivo de caché parcial si existe
       - Detiene el proceso de descarga
     
     - **Manejo de errores**: Registra errores pero continúa con el siguiente día

3. **Clase `DailyQuotaExceeded`**: 
   - Error personalizado que se lanza cuando se excede la cuota diaria de la API

**Endpoint utilizado:**
```
GET {API_BASE}/profesional/buscar?fecha{Modo}Desde={fecha}&fecha{Modo}Hasta={fecha}&clave={password}&usuario={username}
```

#### `nominal.ts` - Consulta de Profesional Específico
Este archivo es un script de prueba/ejemplo que muestra cómo obtener información de un profesional específico por su número de documento.

**Características:**
- Consulta un profesional específico usando el número de documento: `28824751`
- Utiliza el endpoint `/profesional/obtener` en lugar de `/profesional/buscar`
- Parámetros: `nrodoc`, `clave`, `usuario`
- Maneja el caso de "REGISTRO_NO_ENCONTRADO"
- También maneja la excepción de cuota diaria excedida

**Endpoint utilizado:**
```
GET {API_BASE}/profesional/obtener?nrodoc={numero}&clave={password}&usuario={username}
```

#### `utils.ts` - Utilidades de Formato
Contiene funciones auxiliares para formatear fechas:

- **`toSisaDate(date: Date)`**: 
  - Convierte un objeto `Date` a formato de fecha que espera la API de SISA
  - Formato: `DD/MM/YYYY` (ejemplo: `28/08/2010`)

---

## 📊 Datasets (Procesamiento de Datos)

### Propósito
Los datasets procesan los datos descargados, los transforman a estructuras tipadas, los validan y generan archivos de salida en diferentes formatos (JSON, CSV).

### Archivos

#### `index.ts` - Procesamiento y Merge Principal
Este es el punto de entrada para procesar los datos descargados.

**Flujo de procesamiento:**

1. **Carga de datos desde caché**:
   ```typescript
   const profesionalesReg = fromCacheSisa(API_BASE, 'Registro');
   const profesionalesMod = fromCacheSisa(API_BASE, 'Modificacion');
   ```
   - Carga profesionales de ambos modos (Registro y Modificación)
   - Cada uno retorna un `Map<string, Profesional>` donde la clave es un ID único

2. **Merge de profesionales**:
   ```typescript
   const mergedProfessionals = mergeProfesionales([
     ...profesionalesReg.values(),
     ...profesionalesMod.values(),
   ]);
   ```
   - Combina ambos conjuntos de profesionales
   - La función `mergeProfesionales` elimina duplicados y mantiene la versión más reciente

3. **Generación de archivos de salida**:
   - **JSON**: `out/professionals-merged.json`
   - **CSV**: `out/professionals-merged.csv`

#### `historico.ts` - Lectura y Procesamiento desde Caché
Este módulo lee los archivos descargados del caché y los transforma a objetos tipados.

**Función principal: `fromCacheSisa(apiBase, mode)`**

**Proceso:**

1. **Iteración por fechas**:
   - Itera desde `FIRST_START_DATE` (28/08/2010) hasta la fecha actual
   - Para cada fecha, construye la URL que se usó para descargar

2. **Lectura y transformación**:
   - Usa `CacheGetter` para leer archivos del caché
   - Convierte XML a JSON usando `xml2json`
   - Aplica la función `simplify()` para limpiar la estructura XML anidada
   - Valida que el resultado sea `OK`

3. **Procesamiento de profesionales**:
   - Maneja casos donde hay:
     - **Múltiples profesionales**: Array de profesionales
     - **Un solo profesional**: Objeto único
     - **Sin profesionales**: Resultado vacío
   
   - Para cada profesional:
     - Parsea usando `parseProfesional()`
     - Genera un ID único con `idForProfesional()`
     - Si el ID ya existe, lo ignora (evita duplicados)
     - Almacena en un `Map<string, Profesional>`

4. **Guardado intermedio**:
   - Guarda los profesionales procesados en:
     - `out/sisa-profesionales.json` (para modo Registro)
     - `out/sisa-profesionales-modificacion.json` (para modo Modificación)

5. **Retorno**: Devuelve el `Map` con todos los profesionales procesados

#### `nominal.ts` - Prueba de Consulta Individual
Similar al `nominal.ts` de datasources, pero procesa la respuesta:

- Lee del caché la respuesta de `/profesional/obtener`
- Convierte XML a JSON
- Parsea el profesional usando `parseProfesional()`
- Muestra el resultado en consola

#### `types.ts` - Definiciones de Tipos TypeScript
Define todas las estructuras de datos utilizadas:

**Enums:**
- **`Estado`**: Estados de una matrícula
  - `'baja definitiva'`
  - `'baja temporal'`
  - `'habilitado'`
  - `'inhabilitacion por rematriculacion'`

- **`Provincia`**: Provincias argentinas con sus IDs numéricos (1-24)

- **`TipoDocumento`**: Tipos de documento de identidad
  - `'ci'`, `'de'`, `'dni'`, `'dnim'`, `'lc'`, `'le'`

**Types:**

1. **`Especialidad`**: Información de una especialidad médica
   - `especialidad`: Nombre de la especialidad
   - `establecimiento`: Establecimiento donde se certificó (opcional)
   - `fechaCertificacion`: Fecha de certificación
   - `idEspecialidad`, `idEspecialidadMod`: IDs numéricos
   - `ministerio`: Ministerio que certificó (opcional)
   - `nroCertificacion`: Número de certificación (opcional)
   - `sociedadCientifica`: Sociedad científica (opcional)
   - `tipoCertificacion`: Tipo de certificación

2. **`Matricula`**: Información de una matrícula profesional
   - `especialidades`: Array de especialidades
   - `estado`: Estado de la matrícula (opcional)
   - `fechaMatricula`, `fechaModificacion`, `fechaRegistro`, `fechaTitulo`: Fechas relevantes
   - `idInstitucionFormadora`, `idJurisdiccion`, `idProfesion`, `idProfesionalMatricula`: IDs numéricos
   - `institucionFormadora`, `jurisdiccion`, `profesion`: Nombres
   - `matricula`: Número de matrícula
   - `observaciones`: Observaciones (opcional)
   - `provincia`: Provincia de la matrícula

3. **`Profesional`**: Información completa de un profesional
   - `apellido`, `nombre`: Datos personales
   - `codigo`: Código único del profesional
   - `cuit`: CUIT (opcional)
   - `fechaModificacion`, `fechaRegistro`: Fechas de registro/modificación
   - `idProfesional`: ID numérico
   - `matriculas`: Array de matrículas
   - `numeroDocumento`: Número de documento
   - `sss`: Información del Sistema de Seguimiento de Salud (opcional)
   - `tipoDocumento`: Tipo de documento

4. **`SssInfo`**: Información del Sistema de Seguimiento de Salud
   - `certificado`: Número de certificado
   - `fecha`, `fechaFin`: Fechas de vigencia

#### `utils.ts` - Utilidades de Procesamiento
Este archivo contiene la mayor parte de la lógica de transformación y validación.

**Funciones de Identificación:**

1. **`idForProfesional(prof)`**: Genera un ID único para un profesional
   - Formato: `{tipoDocumento}:{numeroDocumento}:{codigo}:{idProfesional}`

2. **`idForMatriculas(mat)`**: Genera un ID único para una matrícula
   - Formato: `{idProfesionalMatricula}:{idProfesion}:{idJurisdiccion}:{matricula}`

3. **`idForEspecialidades(esp)`**: Genera un ID único para una especialidad
   - Formato: `{fechaCertificacion}:{especialidad}:{ministerio}:{nroCertificacion}:{idEspecialidad}`

**Funciones de Parsing:**

1. **`parseEspecialidad(data)`**: 
   - Valida y parsea datos de una especialidad
   - Normaliza textos
   - Convierte fechas de formato `DD/MM/YYYY` a objetos `Date`

2. **`parseMatricula(data)`**:
   - Valida y parsea datos de una matrícula
   - Maneja especialidades (puede ser array, objeto único, o undefined)
   - Valida que la provincia coincida con su ID
   - Convierte fechas en diferentes formatos:
     - `DD-MM-YYYY HH:mm` para `fechaMatricula`
     - `DD-MM-YYYY` para `fechaRegistro`, `fechaModificacion`
   - Normaliza observaciones (puede ser string o objeto)

3. **`parseProfesional(data)`**:
   - Valida y parsea datos de un profesional completo
   - Procesa matriculas (puede ser array, objeto único, o undefined)
   - Construye el objeto `sss` con información opcional
   - Valida que el tipo de documento sea válido

**Funciones de Transformación:**

1. **`simplify(data)`**:
   - Limpia la estructura JSON resultante de convertir XML
   - Elimina objetos vacíos
   - Simplifica estructuras anidadas innecesarias (cuando hay un solo hijo)
   - Elimina propiedades que empiezan con `_` (metadatos XML)

**Funciones de Validación de Tipos:**

- `isString()`, `isNumber()`, `isArray()`, `isObject()`, `isStringOrNumber()`
- `isSlashDateString()`, `isDashDateString()`, `isDashDateTimeString()`: Validadores de formatos de fecha

**Funciones de Conversión de Fechas:**

1. **`slashDateStringToDate(str)`**: 
   - Convierte `DD/MM/YYYY` a `Date`
   - Maneja años de 2 dígitos (asume 1900-1999 si < 70, 2000-2099 si >= 70)
   - Valida que la fecha sea correcta

2. **`dashDateStringToDate(str)`**: 
   - Convierte `DD-MM-YYYY` a `Date`

3. **`dashDateTimeStringToDate(str)`**: 
   - Convierte `DD-MM-YYYY HH:mm` a `Date`

**Funciones de Merge (Eliminación de Duplicados):**

1. **`merge<T>(subjects, id)`**:
   - Función genérica que elimina duplicados basándose en un ID
   - Cuando hay duplicados, mantiene el más reciente según:
     1. `fechaModificacion` (más reciente primero)
     2. Si son iguales, `fechaRegistro` (más reciente primero)
     3. Si son iguales, `fechaCertificacion` (más reciente primero)

2. **`mergeProfesionales(profesionales)`**:
   - Merge de profesionales basado en `codigo`
   - Para cada profesional, también hace merge de:
     - **Matrículas**: Basado en `{idJurisdiccion}:{profesion}:{matricula}`
     - **Especialidades**: Basado en `{idEspecialidad}:{idEspecialidadMod}`

**Funciones de Exportación a CSV:**

1. **`toPaths(subject, path)`**: 
   - Convierte un objeto JSON anidado a un array de rutas y valores
   - Ejemplo: `{a: {b: 1}}` → `[['a', 'b'], 1]`

2. **`flatten(subject, separator)`**: 
   - Aplana un objeto JSON usando un separador (por defecto `__`)
   - Ejemplo: `{a: {b: 1}}` → `{'a__b': 1}`

3. **`jsonArrayToCsv(subject, separator)`**: 
   - Convierte un array de objetos JSON a formato CSV
   - Retorna: `[filas, headers]`
   - Headers ordenados por profundidad y alfabéticamente

4. **`writeJsonArrayToCsv(filename, subject)`**: 
   - Escribe un array JSON a un archivo CSV

**Constantes:**

- **`FIRST_START_DATE`**: Fecha inicial para procesamiento: `2010-08-28T00:00:00.000-03:00`

---

## 🔄 Flujo Completo del Sistema

```
1. DATASOURCES (Descarga)
   │
   ├─ index.ts ejecuta downloadFrom() para 'Registro' y 'Modificacion'
   │
   ├─ historico.ts itera día por día desde la última fecha descargada
   │  │
   │  └─ Para cada día: GET /profesional/buscar → Guarda en caché
   │
   └─ Los datos se guardan en: cache/sisa.msal.gov.ar/...

2. DATASETS (Procesamiento)
   │
   ├─ index.ts ejecuta fromCacheSisa() para ambos modos
   │
   ├─ historico.ts lee archivos del caché día por día
   │  │
   │  ├─ Convierte XML → JSON
   │  ├─ Simplifica estructura
   │  ├─ Parsea cada profesional con parseProfesional()
   │  └─ Guarda en Map<string, Profesional>
   │
   ├─ index.ts mergea ambos Maps
   │  │
   │  ├─ Elimina duplicados (mantiene más reciente)
   │  ├─ Mergea matrículas y especialidades
   │  └─ Genera archivos finales:
   │     ├─ professionals-merged.json
   │     └─ professionals-merged.csv
   │
   └─ Los archivos finales están en: src/datasets/sisa.msal.gov.ar/out/
```

---

## 📁 Estructura de Archivos de Salida

### Archivos Intermedios (en `out/`):
- `sisa-profesionales.json`: Profesionales del modo "Registro"
- `sisa-profesionales-modificacion.json`: Profesionales del modo "Modificación"

### Archivos Finales (en `out/`):
- `professionals-merged.json`: JSON con todos los profesionales mergeados
- `professionals-merged.csv`: CSV con todos los profesionales mergeados (estructura aplanada)

---

## 🔐 Variables de Entorno Requeridas

```bash
SISA_API=https://sisa.msal.gov.ar/sisa/services/rest
SISA_USER=tu_usuario
SISA_PASSWORD=tu_contraseña
```

---

## ⚠️ Consideraciones Importantes

1. **Cuota Diaria**: La API de SISA tiene una cuota diaria limitada. Si se excede, el sistema detiene la descarga automáticamente.

2. **Caché**: El sistema usa caché para evitar descargas duplicadas. Los archivos se guardan en `cache/sisa.msal.gov.ar/`.

3. **Reanudación**: Si se interrumpe una descarga, el sistema reanuda desde la última fecha descargada automáticamente.

4. **Duplicados**: El sistema elimina duplicados inteligentemente, manteniendo siempre la versión más reciente basándose en fechas de modificación, registro y certificación.

5. **Formato de Fechas**: La API de SISA usa diferentes formatos de fecha:
   - `DD/MM/YYYY` para fechas simples
   - `DD-MM-YYYY` para fechas con guiones
   - `DD-MM-YYYY HH:mm` para fechas con hora

6. **XML a JSON**: Los datos vienen en XML desde la API, pero se convierten a JSON para facilitar el procesamiento.

---

## 🎯 Casos de Uso

- **Descarga completa histórica**: Ejecutar `datasources/sisa.msal.gov.ar/index.ts` para descargar todos los datos desde 2010
- **Consulta individual**: Usar `datasources/sisa.msal.gov.ar/nominal.ts` o `datasets/sisa.msal.gov.ar/nominal.ts` para consultar un profesional específico
- **Procesamiento y análisis**: Ejecutar `datasets/sisa.msal.gov.ar/index.ts` para generar los archivos finales procesados
