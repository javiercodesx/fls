# Documentación del Módulo @parsers

## Índice

1. [Visión General](#visión-general)
2. [index.ts - Punto de Entrada Principal](#indexts---punto-de-entrada-principal)
3. [generic/index.ts - Clase Base Abstracta](#genericindexts---clase-base-abstracta)
4. [misrx/index.ts - Parser de MisRX](#misrxindexts---parser-de-misrx)
5. [ospsa/index.ts - Parser de Ospsa](#ospsaindexts---parser-de-ospsa)
6. [rcta/index.ts - Parser de RCTA](#rctaindexts---parser-de-rcta)
7. [override/ - Mapeo de Diagnósticos](#override---mapeo-de-diagnósticos)

---

## Visión General

El módulo `@parsers` es responsable de **parsear recetas médicas** desde diferentes fuentes (MisRX, Ospsa, RCTA) y convertirlas a un formato estandarizado (`Recipe`). El sistema utiliza un patrón de diseño basado en **herencia** con una clase base abstracta que define el contrato común para todos los parsers.

### Flujo General de Procesamiento

```
URLs → fromUrls() → Filtrado por parser → Parseo individual → Remapeo de diagnósticos → Recetas estandarizadas
```

---

## index.ts - Punto de Entrada Principal

### Función Principal: `fromUrls`

**¿Qué hace?**
Esta es la función principal que orquesta todo el proceso de parseo. Recibe un array de URLs y un `Getter`, y devuelve un par `[Recipe[], URL[]]` donde:

- `Recipe[]`: Recetas parseadas exitosamente
- `URL[]`: URLs que no pudieron ser parseadas por ningún parser

**¿Cómo funciona?**

```typescript
const fromUrls: (getter: Getter, urls: (string | URL)[]) => Promise<[Recipe[], URL[]]>;
```

1. **Inicialización de Parsers**: Crea instancias de los tres parsers disponibles:
   - `OspsaParser`
   - `MisRXParser`
   - `RctaParser`

2. **Procesamiento Paralelo**: Usa `Promise.all` para procesar cada parser en paralelo:
   - Cada parser recibe todas las URLs
   - Filtra las URLs que puede procesar (usando `isOurURL`)
   - Intenta parsear cada URL válida
   - Si falla, devuelve la URL original

3. **Agregación de Resultados**: Reduce todos los resultados en dos arrays separados:
   - Recetas parseadas exitosamente
   - URLs que fallaron

**Ejemplo de uso:**

```typescript
const [recipes, failedUrls] = await fromUrls(getter, [
  'https://misrx.com.ar/receta?token=abc123',
  'https://wwwospsa.sanidad.org.ar/...',
  'https://prescriptions.rcta.me/...',
]);
```

### Función: `filterByParser`

**¿Qué hace?**
Filtra las URLs que corresponden a un parser específico y las intenta parsear.

**Proceso:**

1. Filtra URLs usando `parser.isOurURL(url)` - cada parser sabe qué URLs puede procesar
2. Para cada URL válida:
   - Llama a `parser.parse(url)`
   - Aplica `remapDiagnoses()` para enriquecer diagnósticos
   - Si falla, devuelve la URL original (catch)

**¿Por qué devuelve `Recipe | URL`?**

- Si el parseo es exitoso → devuelve `Recipe`
- Si falla → devuelve `URL` para que el caller sepa qué URLs no se pudieron procesar

### Sistema de Remapeo de Diagnósticos

#### `diagnosesMap`

**¿Qué es?**
Un `Map<string, string[]>` que mapea descripciones de diagnósticos normalizadas a códigos ICD10.

**¿De dónde se carga?**
Se carga desde archivos CSV en el directorio `override/`:

- `20250828000000.csv`
- `20250918000000.csv`

**Proceso de carga:**

1. `readFilesSorted()` lee todos los archivos CSV del directorio `override/` ordenados por nombre
2. Cada archivo se parsea como CSV usando `readString()`
3. Cada fila tiene formato: `"diagnosis";"icd10_list"` donde `icd10_list` es una lista separada por comas
4. Se normaliza el texto del diagnóstico y los códigos ICD10
5. Se filtra cualquier entrada vacía

**Ejemplo de datos:**

```csv
"diagnosis";"icd10_list"
"diabetes";"E10E,E11,E12,E13,E14"
"hipertension arterial";"I10,I11,I12,I13,I15"
```

#### `remapDiagnosis`

**¿Qué hace?**
Enriquece un `DiagnosisInformation` con códigos ICD10 si no los tiene.

**Lógica:**

- Si el diagnóstico **no tiene** códigos ICD10 (`icd10` está vacío o undefined)
- Y tiene una descripción
- Busca en `diagnosesMap` usando la descripción normalizada
- Si encuentra una entrada, asigna los códigos ICD10 encontrados

**¿Por qué es útil?**
Algunos parsers no siempre incluyen códigos ICD10, pero tenemos un mapeo manual de diagnósticos comunes a sus códigos. Esto permite enriquecer los datos automáticamente.

#### `remapDiagnoses`

**¿Qué hace?**
Aplica `remapDiagnosis` a todos los diagnósticos de una receta:

1. Diagnósticos principales (`recipe.medical.diagnosis`)
2. Diagnósticos asociados a cada medicamento (`medicine.diagnosis`)

---

## generic/index.ts - Clase Base Abstracta

### Clase Abstracta: `Parser`

**¿Por qué es abstracta?**
Define el **contrato común** que todos los parsers deben cumplir, pero deja la implementación específica a cada parser concreto. Esto permite:

- Código reutilizable para el flujo común
- Flexibilidad para implementaciones específicas
- Garantizar que todos los parsers tengan la misma interfaz

### Propiedades y Métodos

#### Propiedades Protegidas

- **`getter: Getter`**: Instancia del sistema de obtención de datos (con cache)
- **`mangleURL: (url: URL) => Promise<URL>`**: Método que puede transformar la URL antes de hacer la petición (por defecto retorna la URL sin cambios)

#### Métodos Abstractos (deben ser implementados por cada parser)

1. **`isOurURL: (url: URL) => boolean`**
   - Determina si una URL puede ser procesada por este parser
   - Cada parser tiene su propio patrón de URLs (regex)

2. **`get name(): string`**
   - Retorna el nombre identificador del parser (ej: "misrx", "ospsa", "RCTA")

3. **`doParse: (data: ArrayBuffer, url: URL) => Promise<Recipe>`**
   - **Método principal de parseo**: Recibe los datos crudos y la URL, retorna una `Recipe` estandarizada
   - Cada parser implementa su lógica específica aquí

4. **`getDispensingWhenUndefined: () => boolean`**
   - Indica si el parser debe reintentar el parseo cuando la información de dispensación está ausente
   - Algunos parsers pueden tener datos de dispensación solo en versiones no cacheadas

### Método Público: `parse`

**¿Qué hace?**
Este es el método principal que orquesta todo el proceso de parseo. Es el mismo para todos los parsers (herencia).

**Flujo paso a paso:**

```typescript
public readonly parse: (url: URL) => Promise<Recipe>
```

1. **Validación de URL**:

   ```typescript
   if (!this.isOurURL(url)) {
     throw new ParserURLError(url, this.name);
   }
   ```

   - Verifica que la URL sea válida para este parser
   - Si no, lanza una excepción específica

2. **Transformación de URL (mangleURL)**:

   ```typescript
   const getterURL: string = (await this.mangleURL(url)).toString();
   ```

   - Algunos parsers necesitan transformar la URL antes de hacer la petición
   - Por ejemplo, MisRX convierte la URL de la receta a la URL de su API JSON
   - Por defecto, `mangleURL` retorna la URL sin cambios

3. **Obtención de Datos (con cache)**:

   ```typescript
   const rawData: GetterResult = await this.getter.get(getterURL, { log: true });
   ```

   - Usa el `Getter` para obtener los datos
   - **¿De dónde se levantan los datos?**
     - **Primero intenta desde cache**: El `Getter` busca en el sistema de archivos local
     - **Si no está en cache**: Hace una petición HTTP y guarda el resultado en cache
   - `GetterResult` incluye:
     - `data: ArrayBuffer`: Los datos crudos
     - `cacheHit: boolean`: Indica si vino de cache o de la web
     - `cachePath: string`: Ruta donde se guardó/cargó el archivo
     - `url: URL`: URL final usada

4. **Parseo de Datos**:

   ```typescript
   const recipe: Recipe = await this.doParse(rawData.data, url);
   ```

   - Llama al método abstracto `doParse` implementado por cada parser
   - Cada parser sabe cómo interpretar sus datos específicos

5. **Reintento si falta información de dispensación**:
   ```typescript
   if (this.getDispensingWhenUndefined() && undefined === recipe.dispensing?.date && rawData.cacheHit) {
     return await this.doParse((await this.getter.get(getterURL, { log: true, skipCache: true })).data, url);
   }
   ```

   - **¿Cuándo se ejecuta?**
     - Si el parser indica que debe reintentar (`getDispensingWhenUndefined()` retorna `true`)
     - Y la receta no tiene fecha de dispensación
     - Y los datos vinieron de cache (`cacheHit === true`)
   - **¿Por qué?**
     - Algunos sistemas (como MisRX) pueden tener información de dispensación solo en versiones actualizadas
     - Si tenemos datos cacheados antiguos, pueden no tener la información de dispensación
     - Al forzar `skipCache: true`, obtenemos la versión más reciente desde la web

### Clases de Error

- **`ParserError`**: Clase base para errores de parseo
- **`ParserRecipeError`**: Error cuando falla el parseo de una receta específica
- **`ParserURLError`**: Error cuando una URL no es válida para un parser (incluye el nombre del parser y la URL)

---

## misrx/index.ts - Parser de MisRX

### Clase: `MisRXParser extends Parser`

**¿Qué es MisRX?**
Sistema de recetas médicas digitales. Este parser procesa recetas desde la API de MisRX.

### Características Específicas

#### `isOurURL`

```typescript
/https:\/\/misrx\.com\.ar\/receta\?token=[0-9a-z%\-]+/iv;
```

- Solo procesa URLs de MisRX con formato específico
- Requiere un token en los query parameters

#### `mangleURL`

**Transforma la URL de la receta a la URL de la API JSON:**

```typescript
'https://misrx.com.ar/wsmvd/api/receta' + searchParams;
```

- La URL pública de la receta se convierte en la URL de la API interna
- Mantiene los query parameters (especialmente el token)

#### `getDispensingWhenUndefined`

```typescript
return true;
```

- **Sí reintenta** si falta información de dispensación
- MisRX puede tener datos de dispensación solo en versiones actualizadas

### Proceso de Parseo (`doParse`)

#### 1. Parseo del JSON

```typescript
const misRXRecipe = StrictJSON.parse(decode(data)) as MisRXRecipe;
```

- Los datos vienen como JSON desde la API
- Se decodifican y parsean estrictamente

#### 2. Determinación de Fecha de Dispensación

```typescript
const dispensedDate: Date =
  maybe(parseDateTimeUsecs)(maybe(normalizeText)(misRXRecipe.dispensa?.fecha_mov)) ??
  parseDateTimeUsecs(normalizeText(misRXRecipe.fecha_emision));
```

- Intenta usar la fecha de dispensación si existe
- Si no, usa la fecha de emisión como fallback

#### 3. Construcción de Información Médica

**Diagnósticos (`#diagnosis`)**:

- Combina diagnóstico textual y código CIE10
- Si el diagnóstico es "sin diagnostico", se omite
- Intenta parsear códigos ICD10 desde el texto del diagnóstico

**Medicamentos (`#medicine`)**:

- Para cada item en la receta, crea un `MedicineInformation`
- Usa el registro AlfaBeta para obtener información del producto:
  - Código FLAP
  - Precio
  - Acción farmacológica
- Si no encuentra datos en AlfaBeta, lanza `ParserRecipeError`

#### 4. Información del Paciente (`#patient`)

**Contacto (`#patientContact`)**:

- Email y teléfono del afiliado
- País: "Argentina"

**Cobertura (`#patientCoverage`)**:

- Financiador (convenio)
- Número de afiliado
- Plan de la obra social

**Personal (`#patientPersonal`)**:

- Nombre, apellido, DNI
- Sexo (M/F)
- Fecha de nacimiento

#### 5. Información del Médico (`#physician`)

**Personal**:

- Nombre, apellido, DNI del médico

**Profesional**:

- Matrícula
- Especialidad

#### 6. Información de Dispensación (`DispensingParser`)

**Clase Helper: `DispensingParser`**

Esta clase procesa la información de dispensación de MisRX, que viene en un formato separado.

**Proceso:**

1. **Parseo Inicial**:
   - Fecha de dispensación
   - Información de la farmacia (CUIT, GLN, razón social, etc.)
   - Items dispensados (medicamentos, cantidades, precios)

2. **Matching de Medicamentos**:
   - Calcula la multiplicidad de cada droga (cuántas veces aparece)
   - Crea IDs únicos para cada medicamento:
     - Si una droga aparece solo una vez: `"nombre_droga"`
     - Si aparece múltiples veces: `"nombre_droga|presentacion"` para distinguirlas
   - Mapea los items dispensados a los medicamentos de la receta usando estos IDs

3. **Manejo de Items Sin Match**:
   - Si un item dispensado no coincide con ningún medicamento de la receta, se coloca en la primera posición disponible

**¿Por qué es complejo?**

- Los medicamentos en la receta pueden no coincidir exactamente con los items dispensados
- Puede haber múltiples presentaciones de la misma droga
- Necesita hacer un matching inteligente entre ambos

---

## ospsa/index.ts - Parser de Ospsa

### Clase: `OspsaParser extends Parser`

**¿Qué es Ospsa?**
Obra social que emite recetas en formato PDF. Este parser extrae información de PDFs.

### Características Específicas

#### `isOurURL`

```typescript
/https:\/\/wwwospsa\.sanidad\.org\.ar\/f3984xa\/STD_HTML\/RecetasMedicamentos\/RecetaMedicamento[0-9a-z]+\.pdf\?sClave=[0-9a-z]+/iv;
```

- Solo procesa URLs de PDFs de Ospsa con formato específico
- Requiere una clave de seguridad en los query parameters

#### `getDispensingWhenUndefined`

```typescript
return false;
```

- **No reintenta** si falta información de dispensación
- Ospsa no tiene información de dispensación en sus recetas

#### `mangleURL`

- No transforma la URL (usa la implementación por defecto)
- La URL apunta directamente al PDF

### Proceso de Parseo (`doParse`)

#### 1. Parseo del PDF

```typescript
const pdfParseResults: PDFParseResults = await parsePDF(Buffer.from(copyArrayBuffer(data)));
```

- Los datos vienen como PDF
- Se parsea el PDF para extraer:
  - Líneas de texto
  - Fecha de creación del documento
  - Links (si los hay)

#### 2. Parseo de Líneas con `SingleRecipeStatefulParser`

**Clase Helper: `SingleRecipeStatefulParser`**

Esta clase implementa un parser de estado que procesa línea por línea el contenido del PDF.

**Estado Interno:**

- `#parseResults: RecipeParseResults`: Acumula toda la información parseada
- `#relevantLines: string[]`: Líneas del PDF normalizadas y limpiadas
- `#url: URL`: URL original para mensajes de error

**Proceso de Normalización de Líneas (`#getRelevantLines`)**:

1. Normaliza caracteres Unicode (NFKD)
2. Reemplaza espacios múltiples por un solo espacio
3. Elimina caracteres no ASCII
4. Trim de cada línea

**Parseo Línea por Línea (`#parseLine`)**:

El parser identifica diferentes tipos de líneas y las procesa:

1. **`No DE BENEFICIARIO.:`** → `#parseAffiliationLine`
   - Extrae número de beneficiario y filial

2. **`NOMBRE Y APELLIDO:`** → `#parseNameLine`
   - Extrae nombre, apellido y DNI

3. **`DESCUENTO:`** → `#parseDiscountLine`
   - Extrae descuento, edad y sexo

4. **`DOMICILIO:`** → `#parseHouseAddressLine`
   - Extrae domicilio, teléfono, altura y calle

5. **`LOCALIDAD - PROVINCIA:`** → `#parseCityLine`
   - Extrae localidad y provincia

6. **`DIAGNOSTICO n:`** → `#parseDiagnosisLine`
   - Extrae diagnósticos (hasta 5)
   - Busca el siguiente diagnóstico o el final de la sección

7. **`Rp1`, `Rp2`, `Rp3`** → `#parseMedicationLine`
   - Extrae información de medicamentos
   - Usa regex complejo para parsear:
     - Monodroga
     - Presentación
     - Nombre comercial
     - Cantidad de envases
     - Dosificación (uxt, txd, dxs)

8. **`CORRESPONDE TRATAMIENTO PROLONGADO`** → `#parseProlongedTreatmentLine`
   - Marca el tratamiento como prolongado

9. **Línea con número de receta** → `#parseRecipeIDLine`
   - Extrae el número de receta (formato: `"123 123"`)

**Validación Final:**

- Verifica que todos los campos requeridos estén presentes
- Si falta alguno, lanza `ParserRecipeError`

#### 3. Hidratación de Medicamentos (`OspsaMedicationHydrator`)

**¿Qué es la hidratación?**
Los PDFs de Ospsa solo tienen información básica del medicamento (nombre comercial, presentación, monodroga). La hidratación enriquece esta información con datos del registro AlfaBeta.

**Proceso:**

1. **Traducción Kairos → AlfaBeta**:

   ```typescript
   const alfaBetaEntry = lookupKairos(nombreComercial, presentacion, fecha);
   ```

   - Ospsa usa nombres de productos que pueden diferir de AlfaBeta
   - Existe un mapeo (`kairosNameAndPresentationToAlfaBetaKey`) que traduce nombres Kairos a claves AlfaBeta
   - Si encuentra una entrada única, la usa

2. **Enriquecimiento**:
   - Reemplaza monodroga, nombre comercial, presentación con datos de AlfaBeta
   - Agrega: acción terapéutica, laboratorio, precio unitario, código FLAP (troquel)

3. **Si no encuentra datos**:
   - Retorna `undefined`
   - El parser lanza un error

#### 4. Construcción de la Receta

**Información Médica (`#medical`)**:

- Diagnósticos: lista de descripciones (sin códigos ICD10 en el PDF)
- Medicamentos: con dosificación completa (días por semana, tomas por día, unidades por toma)
- Tratamiento: indica si es prolongado

**Información del Paciente (`#patient`)**:

- Contacto: domicilio completo, teléfono, localidad, provincia
- Cobertura: financiador "ospsa", número de beneficiario, filial, descuento
- Personal: nombre, apellido, DNI, edad, sexo

**Nota**: Ospsa no incluye información del médico en el PDF.

---

## rcta/index.ts - Parser de RCTA

### Clase: `RctaParser extends Parser`

**¿Qué es RCTA?**
Sistema de recetas médicas digitales que usa encriptación. Este parser procesa recetas encriptadas desde RCTA.

### Características Específicas

#### `isOurURL`

```typescript
/https:\/\/prescriptions\.rcta\.me\/[0-9A-Z]+_\d+\.pdf/iv;
```

- Solo procesa URLs de PDFs de RCTA con formato específico
- El formato incluye un hash en el nombre del archivo

#### `getDispensingWhenUndefined`

```typescript
return false;
```

- **No reintenta** si falta información de dispensación
- RCTA no tiene información de dispensación en sus recetas

#### `mangleURL` (Complejo)

**¿Por qué es complejo?**
RCTA usa un sistema de encriptación. El PDF contiene un hash que se usa para desencriptar los datos JSON.

**Proceso:**

1. **Parseo del PDF para extraer hash**:

   ```typescript
   const pdfParseResults = await RctaParser.#pdfParseResults(url, this.getter);
   ```

   - Parsea el PDF para extraer links
   - Busca links que contengan el hash en el formato: `https://verumrp.com.ar/{hash}`

2. **Extracción del hash (`#hashes`)**:
   - Usa regex para encontrar todos los hashes en los links del PDF
   - Debe encontrar exactamente un hash

3. **Construcción de URL de desencriptación**:

   ```typescript
   const mangled = this.#decrypterURL.toString().replace('{HASH}', hash);
   ```

   - Reemplaza `{HASH}` en la URL del desencriptador con el hash encontrado
   - URL por defecto: `https://decrypter.verumrp.com.ar/api/RecipeDecryption?hashedRecipe={HASH}`

4. **Cache de resultados de PDF**:
   - Guarda los resultados del parseo del PDF en un Map estático
   - Si se necesita parsear el mismo PDF dos veces (una para el hash, otra para datos), reutiliza el resultado

### Proceso de Parseo (`doParse`)

#### 1. Parseo del JSON Desencriptado

```typescript
const rctaRecipe = StrictJSON.parse(decode(data)) as RctaRecipe;
```

- Los datos vienen como JSON desencriptado desde la API de desencriptación
- Se decodifican y parsean estrictamente

#### 2. Parseo del PDF (para datos adicionales)

```typescript
const pdfParseResults = await RctaParser.#pdfParseResults(url, this.getter);
```

- También necesita parsear el PDF para obtener información adicional (como el nombre completo del paciente)

#### 3. Construcción de la Receta

**Diagnósticos (`#diagnosis`)**:

- Combina descripción y código de diagnóstico
- Normaliza el código ICD10 con formato: `"ABC.DE"` (agrega punto después de los primeros 3 caracteres)
- Si no hay código, retorna array vacío

**Medicamentos (`#medicine`)**:

- Para cada medicamento:
  - Normaliza el nombre de la droga usando `rctaNormalize`
  - Separa componentes si hay "+" (medicamentos combinados)
  - Asocia diagnósticos específicos del medicamento
  - Información del producto (nombre, presentación) si está disponible
  - Indica si es tratamiento prolongado

**Información del Paciente (`#patient`)**:

**Contacto (`#patientContact`)**:

- Email y teléfono
- Localidad y provincia
- País: "Argentina"

**Cobertura (`#patientCoverage`)**:

- Financiador
- Número de cobertura
- Plan (si existe)
- Indica si es privado

**Personal (`#patientPersonal`)**:

- **Nombre completo**: Se extrae del PDF (no está en el JSON)
  - Busca línea que empiece con "paciente: "
  - Extrae hasta " sexo:"
  - Aplica `uppercaseWords` para capitalizar correctamente
- Fecha de nacimiento
- DNI y tipo de documento
- Sexo

**Información del Médico (`#physician`)**:

**Personal (`#physicianPersonal`)**:

- Nombre, apellido, DNI
- Fecha de nacimiento
- Sexo

**Profesional (`#physicianProfessional`)**:

- **Licencia (`#license`)**:
  - Número de matrícula
  - Especialidad
  - Jurisdicción: Mapea número de provincia a nombre (usa array `jurisdictions`)
- **Oficina (`#office`)**:
  - Teléfono
  - Email (puede venir del médico o del email general)
  - Dirección del consultorio

**Tratamiento Médico (`#medicalTreatment`)**:

- Si `diasAtencion` no es null, crea información de tratamiento con días

### Cache Estático de PDFs

```typescript
static #urlToParseResults: Map<string, PDFParseResults> = new Map();
```

**¿Por qué existe?**

- El mismo PDF puede necesitar parsearse múltiples veces:
  1. Una vez en `mangleURL` para extraer el hash
  2. Otra vez en `doParse` para extraer datos adicionales
- Cachear evita parsear el mismo PDF dos veces

---

## override/ - Mapeo de Diagnósticos

### ¿Qué es?

Directorio que contiene archivos CSV con mapeos manuales de diagnósticos a códigos ICD10.

### Formato de los Archivos

Cada archivo CSV tiene el formato:

```csv
"diagnosis";"icd10_list"
"diabetes";"E10E,E11,E12,E13,E14"
"hipertension arterial";"I10,I11,I12,I13,I15"
```

- **Columna 1**: Descripción del diagnóstico (normalizada)
- **Columna 2**: Lista de códigos ICD10 separados por comas

### ¿Por qué existen múltiples archivos?

Los archivos están nombrados con timestamps:

- `20250828000000.csv`
- `20250918000000.csv`

**Razón**: Permite tener un historial de mapeos. El sistema carga todos los archivos ordenados por nombre, por lo que mapeos más recientes pueden sobrescribir mapeos antiguos si hay duplicados.

### ¿Cómo se usan?

1. Se cargan todos los archivos CSV del directorio `override/`
2. Se parsean y se crea un `Map<string, string[]>` donde:
   - Key: diagnóstico normalizado
   - Value: array de códigos ICD10
3. Cuando se procesa una receta, `remapDiagnoses` busca en este mapa
4. Si un diagnóstico no tiene códigos ICD10 pero tiene una descripción que coincide con una entrada del mapa, se asignan los códigos automáticamente

### Casos de Uso

- **Diagnósticos con abreviaciones**: "hta" → "I10,I11,I12,I13,I15"
- **Diagnósticos con variaciones**: "diabetico" → "E08,E09,E10,E11,E13,E14"
- **Diagnósticos con errores de tipeo**: "INCAPACIDAD RESPIRATORIA" → "J96"
- **Diagnósticos complejos**: "Paciente con enfermedad coronaria con IAM previo..." → "I25,I50,Z95"

---

## Resumen del Flujo Completo

### Ejemplo: Procesar una URL de MisRX

1. **`fromUrls` recibe URLs**:

   ```typescript
   await fromUrls(getter, ['https://misrx.com.ar/receta?token=abc123']);
   ```

2. **Filtrado por parser**:
   - `MisRXParser.isOurURL()` retorna `true`
   - `OspsaParser.isOurURL()` retorna `false`
   - `RctaParser.isOurURL()` retorna `false`

3. **Parseo**:
   - `MisRXParser.parse(url)` se ejecuta:
     - Valida URL ✓
     - `mangleURL()` transforma a URL de API
     - `getter.get()` obtiene datos (desde cache o web)
     - `doParse()` parsea JSON a `Recipe`
     - Si falta dispensación y vino de cache, reintenta sin cache

4. **Remapeo de diagnósticos**:
   - `remapDiagnoses()` enriquece diagnósticos con códigos ICD10 del mapa

5. **Resultado**:
   - Retorna `Recipe` estandarizada

### Sistema de Cache

**¿Siempre de cache?**
No. El sistema funciona así:

1. **Primera petición**:
   - `getter.get(url)` busca en cache
   - Si no existe, hace petición HTTP
   - Guarda resultado en cache
   - Retorna datos con `cacheHit: false`

2. **Peticiones subsecuentes**:
   - `getter.get(url)` encuentra en cache
   - Retorna datos con `cacheHit: true`
   - **No hace petición HTTP**

3. **Forzar actualización**:
   - `getter.get(url, { skipCache: true })`
   - Ignora cache, siempre hace petición HTTP
   - Actualiza cache con nuevos datos

**¿Cuándo se usa `skipCache`?**

- Cuando `getDispensingWhenUndefined()` retorna `true` y falta información de dispensación
- Permite obtener la versión más reciente de los datos

---

## Patrones de Diseño Utilizados

### 1. Template Method Pattern

- La clase `Parser` define el esqueleto del algoritmo (`parse`)
- Las subclases implementan los pasos específicos (`doParse`, `isOurURL`, etc.)

### 2. Strategy Pattern

- Cada parser es una estrategia diferente para parsear recetas
- `fromUrls` selecciona la estrategia apropiada basándose en la URL

### 3. Factory Pattern (implícito)

- `fromUrls` crea instancias de todos los parsers
- Cada parser se crea con su `Getter` específico

### 4. Cache-Aside Pattern

- El `Getter` implementa cache-aside:
  - Primero busca en cache
  - Si no existe, obtiene de la fuente
  - Guarda en cache para futuras peticiones

---

## Consideraciones de Diseño

### ¿Por qué clases abstractas?

1. **Reutilización de código**: El método `parse` es común a todos los parsers
2. **Consistencia**: Garantiza que todos los parsers tengan la misma interfaz
3. **Mantenibilidad**: Cambios en el flujo común solo requieren modificar la clase base
4. **Type safety**: TypeScript garantiza que todas las clases implementen los métodos abstractos

### ¿Por qué métodos protegidos?

- `mangleURL` es protegido porque:
  - No debe ser llamado directamente desde fuera
  - Solo se usa internamente en `parse`
  - Pero puede ser sobrescrito por subclases

### ¿Por qué métodos privados con `#`?

- Métodos como `#diagnosis`, `#medicine`, etc. son privados porque:
  - Son detalles de implementación específicos de cada parser
  - No deben ser accesibles desde fuera de la clase
  - Ayudan a mantener la encapsulación

---

## Extensiones Futuras

Para agregar un nuevo parser:

1. Crear nueva clase que extienda `Parser`
2. Implementar métodos abstractos:
   - `isOurURL`: Patrón de URLs que acepta
   - `name`: Nombre identificador
   - `doParse`: Lógica de parseo específica
   - `getDispensingWhenUndefined`: Si debe reintentar
3. Opcionalmente sobrescribir `mangleURL` si necesita transformar URLs
4. Agregar instancia en `fromUrls` en `index.ts`

---

## Conclusión

El módulo `@parsers` es un sistema robusto y extensible para parsear recetas médicas desde múltiples fuentes. Utiliza herencia, cache inteligente, y mapeo de diagnósticos para proporcionar un formato estandarizado de recetas, facilitando el procesamiento posterior y el análisis de datos médicos.








---

# Este es el otro markdown

# Guía de Aprendizaje para Mantener el Código de @parsers

## 📚 Índice

1. [Programación Orientada a Objetos (OOP)](#1-programación-orientada-a-objetos-oop)
2. [TypeScript Avanzado](#2-typescript-avanzado)
3. [Programación Asíncrona](#3-programación-asíncrona)
4. [Funciones de Orden Superior y Programación Funcional](#4-funciones-de-orden-superior-y-programación-funcional)
5. [Patrones de Diseño](#5-patrones-de-diseño)
6. [Manejo de Errores](#6-manejo-de-errores)
7. [Estructuras de Datos Avanzadas](#7-estructuras-de-datos-avanzadas)
8. [Manejo de Archivos y I/O](#8-manejo-de-archivos-y-io)
9. [Expresiones Regulares](#9-expresiones-regulares)
10. [Testing y Debugging](#10-testing-y-debugging)

---

## 1. Programación Orientada a Objetos (OOP)

### 1.1 Fundamentos de Clases

**Conceptos Clave:**

- ✅ **Clases vs Instancias**: Entender la diferencia entre la definición de una clase y sus instancias
- ✅ **Constructor**: Método especial que se ejecuta al crear una instancia
- ✅ **Propiedades**: Variables que pertenecen a una instancia o clase
- ✅ **Métodos**: Funciones que pertenecen a una instancia o clase

**Ejemplo del código:**

```typescript
class Parser {
  protected getter: Getter;

  constructor(getter: Getter) {
    this.getter = getter;
  }
}
```

**Qué estudiar:**

- Sintaxis de clases en TypeScript
- Inicialización de propiedades
- `this` y su contexto

---

### 1.2 Modificadores de Acceso

**Conceptos Clave:**

- ✅ **`public`**: Accesible desde cualquier lugar (por defecto)
- ✅ **`protected`**: Accesible desde la clase y sus subclases
- ✅ **`private`**: Solo accesible desde dentro de la clase
- ✅ **`#` (Private Fields)**: Campos privados de ES2022 (más estricto que `private`)

**Ejemplos del código:**

```typescript
// Público
public readonly parse: (url: URL) => Promise<Recipe>

// Protegido (accesible en subclases)
protected getter: Getter;
protected mangleURL: (url: URL) => Promise<URL>

// Privado con #
static #urlToParseResults: Map<string, PDFParseResults>
#parseResults: DispensingInformation | undefined
```

**Qué estudiar:**

- Diferencia entre `private` y `#`
- Cuándo usar cada modificador
- Encapsulación y ocultamiento de información

**Ejercicios prácticos:**

- Crear una clase con diferentes niveles de acceso
- Intentar acceder a propiedades privadas desde fuera (debe fallar)
- Entender por qué `protected` es útil en herencia

---

### 1.3 Propiedades Estáticas

**Conceptos Clave:**

- ✅ **`static`**: Propiedades y métodos que pertenecen a la clase, no a la instancia
- ✅ **Compartidas entre todas las instancias**: Útiles para constantes, caches, contadores
- ✅ **Acceso sin instancia**: `ClassName.staticProperty`

**Ejemplos del código:**

```typescript
// Constante estática
static readonly #JSON_BASE: string = 'https://misrx.com.ar/wsmvd/api/receta';

// Cache estático compartido
static #urlToParseResults: Map<string, PDFParseResults> = new Map();

// Método estático
static #pdfParseResults: (url: string | URL, getter: Getter) => Promise<PDFParseResults>
```

**Qué estudiar:**

- Cuándo usar `static` vs instancia
- Memoria compartida entre instancias
- Métodos estáticos privados

**Ejercicios prácticos:**

- Crear una clase con contador estático
- Implementar un cache estático simple
- Comparar comportamiento con y sin `static`

---

### 1.4 Propiedades de Solo Lectura (`readonly`)

**Conceptos Clave:**

- ✅ **`readonly`**: Propiedad que solo puede asignarse una vez (en inicialización o constructor)
- ✅ **Inmutabilidad**: Previene modificaciones accidentales
- ✅ **Puede combinarse con otros modificadores**: `public readonly`, `protected readonly`

**Ejemplos del código:**

```typescript
public readonly parse: (url: URL) => Promise<Recipe> = async (url: URL) => {
  // ...
}
```

**Qué estudiar:**

- Diferencia entre `readonly` y `const`
- `readonly` en clases vs interfaces
- Inmutabilidad en TypeScript

---

### 1.5 Getters y Setters

**Conceptos Clave:**

- ✅ **Getters**: Métodos que se acceden como propiedades (`obj.name` en vez de `obj.getName()`)
- ✅ **Setters**: Métodos que se asignan como propiedades (`obj.name = value`)
- ✅ **Computed properties**: Propiedades calculadas dinámicamente

**Ejemplos del código:**

```typescript
public get name(): string {
  return 'misrx';
}

public get parserName(): string {
  return this.#parserName;
}

public get url(): URL {
  return this.#url;
}
```

**Qué estudiar:**

- Sintaxis de getters/setters
- Cuándo usar getters vs métodos
- Getters como propiedades computadas
- Validación en setters

**Ejercicios prácticos:**

- Crear una clase con getter que calcula un valor
- Implementar validación en un setter
- Comparar getter vs método público

---

### 1.6 Herencia (`extends`)

**Conceptos Clave:**

- ✅ **Herencia**: Una clase puede extender otra, heredando todas sus propiedades y métodos
- ✅ **`super`**: Referencia a la clase padre
- ✅ **Reutilización de código**: Evita duplicación
- ✅ **Jerarquía de clases**: Clase base → Clase derivada

**Ejemplos del código:**

```typescript
// Clase base
abstract class Parser {
  protected getter: Getter;
  constructor(getter: Getter) {
    this.getter = getter;
  }
}

// Clase derivada
class MisRXParser extends Parser {
  constructor(getter: Getter) {
    super(getter); // Llama al constructor de la clase padre
  }
}
```

**Qué estudiar:**

- Sintaxis de `extends`
- Llamadas a `super()` en constructor
- Acceso a métodos/propiedades de la clase padre
- Cadena de herencia

**Ejercicios prácticos:**

- Crear una jerarquía de 3 niveles
- Acceder a métodos de la clase padre
- Entender el orden de ejecución de constructores

---

### 1.7 Clases Abstractas

**Conceptos Clave:**

- ✅ **`abstract`**: Clase que no puede ser instanciada directamente
- ✅ **Métodos abstractos**: Métodos que deben ser implementados por subclases
- ✅ **Contrato**: Define qué debe implementar cada subclase
- ✅ **Template Method Pattern**: La clase base define el esqueleto, las subclases implementan los detalles

**Ejemplos del código:**

```typescript
abstract class Parser {
  // Método abstracto - debe ser implementado
  public abstract isOurURL: (url: URL) => boolean;
  public abstract get name(): string;
  protected abstract doParse: (data: ArrayBuffer, url: URL) => Promise<Recipe>;

  // Método concreto - implementado en la clase base
  public readonly parse: (url: URL) => Promise<Recipe> = async (url: URL) => {
    // Usa los métodos abstractos
    if (!this.isOurURL(url)) {
      throw new ParserURLError(url, this.name);
    }
    // ...
  };
}
```

**Qué estudiar:**

- Diferencia entre clase abstracta e interfaz
- Cuándo usar clases abstractas
- Implementación de métodos abstractos con `override`
- Template Method Pattern

**Ejercicios prácticos:**

- Crear una clase abstracta con métodos abstractos
- Implementar múltiples subclases
- Intentar instanciar la clase abstracta (debe fallar)

---

### 1.8 Override de Métodos

**Conceptos Clave:**

- ✅ **`override`**: Palabra clave que indica que estás sobrescribiendo un método de la clase padre
- ✅ **Polimorfismo**: El mismo método puede comportarse diferente en cada subclase
- ✅ **Type safety**: TypeScript verifica que el método existe en la clase padre

**Ejemplos del código:**

```typescript
class MisRXParser extends Parser {
  // Sobrescribe método abstracto
  public override doParse: (data: ArrayBuffer, url: URL) => Promise<Recipe> = (
    data: ArrayBuffer,
    url: URL,
  ): Promise<Recipe> => {
    // Implementación específica
  };

  // Sobrescribe método protegido
  protected override mangleURL: (url: URL) => Promise<URL> = (url: URL): Promise<URL> =>
    Promise.resolve(new URL(`${MisRXParser.#JSON_BASE}${new URL(url).search}`));
}
```

**Qué estudiar:**

- Sintaxis de `override`
- Reglas de sobrescritura (firma debe ser compatible)
- `super.method()` para llamar al método padre
- Polimorfismo en tiempo de ejecución

**Ejercicios prácticos:**

- Sobrescribir métodos de la clase padre
- Usar `super` para extender comportamiento
- Crear código polimórfico

---

### 1.9 Encapsulación

**Conceptos Clave:**

- ✅ **Ocultamiento de información**: Ocultar detalles de implementación
- ✅ **Interfaz pública**: Solo exponer lo necesario
- ✅ **Métodos privados**: Lógica interna que no debe ser accesible desde fuera

**Ejemplos del código:**

```typescript
class DispensingParser {
  // Privado - solo usado internamente
  #drugMultiplicity: (medical: MedicalInformation) => Map<string, number>;
  #medicationIDs: (medical: MedicalInformation, drugMultiplicity: Map<string, number>) => string[];
  #parseDispenseItems: (item: MisRXDispensaItems) => [number, DispensingUnitInformation];

  // Público - interfaz externa
  public parse: () => DispensingInformation | undefined;
}
```

**Qué estudiar:**

- Principio de menor privilegio
- Beneficios de la encapsulación
- Refactoring seguro

---

### 1.10 Composición vs Herencia

**Conceptos Clave:**

- ✅ **Herencia "es un"**: `MisRXParser extends Parser` → MisRXParser ES UN Parser
- ✅ **Composición "tiene un"**: `Parser tiene un Getter` → `protected getter: Getter`
- ✅ **Cuándo usar cada una**: Herencia para especialización, composición para reutilización

**Ejemplos del código:**

```typescript
// Herencia
class MisRXParser extends Parser {}

// Composición
class Parser {
  protected getter: Getter; // Parser TIENE UN Getter
}
```

**Qué estudiar:**

- "Favor composition over inheritance"
- Cuándo usar herencia vs composición
- Delegación

---

## 2. TypeScript Avanzado

### 2.1 Tipos Básicos y Anotaciones

**Conceptos Clave:**

- ✅ **Type annotations**: `variable: Type`
- ✅ **Type inference**: TypeScript infiere tipos automáticamente
- ✅ **Tipos primitivos**: `string`, `number`, `boolean`, `null`, `undefined`
- ✅ **Tipos de objeto**: `{ prop: string }`
- ✅ **Arrays**: `string[]` o `Array<string>`
- ✅ **Tuplas**: `[string, number]` - arrays con longitud fija

**Ejemplos del código:**

```typescript
const fromUrls: (getter: Getter, urls: (string | URL)[]) => Promise<[Recipe[], URL[]]>;
const diagnosesMap: Map<string, string[]> = new Map<string, string[]>();
const url: URL;
const data: ArrayBuffer;
```

**Qué estudiar:**

- Sintaxis de anotaciones de tipo
- Type inference básico
- Tipos primitivos y objetos
- Arrays y tuplas

---

### 2.2 Union Types (`|`)

**Conceptos Clave:**

- ✅ **Union types**: Un valor puede ser de uno de varios tipos
- ✅ **Type narrowing**: Reducir el tipo usando type guards
- ✅ **Sintaxis**: `string | number | boolean`

**Ejemplos del código:**

```typescript
urls: (string | URL)[]
Promise<Recipe | URL>
current: Recipe | URL
undefined !== diagnosisInformation.description
```

**Qué estudiar:**

- Sintaxis de union types
- Type narrowing con `typeof`, `instanceof`
- Discriminated unions

**Ejercicios prácticos:**

- Crear funciones que acepten múltiples tipos
- Usar type guards para narrow types
- Implementar discriminated unions

---

### 2.3 Intersection Types (`&`)

**Conceptos Clave:**

- ✅ **Intersection types**: Un valor debe cumplir con todos los tipos
- ✅ **Sintaxis**: `TypeA & TypeB`
- ✅ **Útil para**: Combinar interfaces, extender tipos

**Ejemplos del código:**

```typescript
Partial<Omit<OspsaMedicine, 'droga' | 'nombreComercial' | 'presentacion'>> &
  Pick<OspsaMedicine, 'droga' | 'nombreComercial' | 'presentacion'>;
```

**Qué estudiar:**

- Sintaxis de intersection types
- Diferencia con union types
- Casos de uso

---

### 2.4 Type Guards

**Conceptos Clave:**

- ✅ **Type guards**: Funciones que verifican el tipo en tiempo de ejecución
- ✅ **Narrowing**: Reducen el tipo de una variable
- ✅ **`typeof`**: Para tipos primitivos
- ✅ **`instanceof`**: Para clases
- ✅ **Type predicates**: `value is Type`

**Ejemplos del código:**

```typescript
// Type narrowing con instanceof
!(current instanceof URL) ? [current] : [];
current instanceof URL
  ? [current]
  : []

      // Type predicate
      .filter(
        (unitInfo: DispensingUnitInformation | undefined): unitInfo is DispensingUnitInformation =>
          undefined !== unitInfo?.drug.name,
      );

// typeof
'string' === typeof r;
```

**Qué estudiar:**

- `typeof` operator
- `instanceof` operator
- Type predicates (`value is Type`)
- Custom type guards
- Type narrowing en condicionales

**Ejercicios prácticos:**

- Crear type guards personalizados
- Usar type guards en funciones
- Narrow types en condicionales

---

### 2.5 Generics (`<T>`)

**Conceptos Clave:**

- ✅ **Generics**: Tipos parametrizados, como funciones pero para tipos
- ✅ **Reutilización de código**: Escribir código que funciona con múltiples tipos
- ✅ **Type safety**: Mantener type safety sin perder flexibilidad
- ✅ **Sintaxis**: `<T>`, `<T extends Constraint>`, `<T, U>`

**Ejemplos del código:**

```typescript
// Generic en función
const idPromise: <T>(value: T) => Promise<T>

// Generic en clase
class Parser {
  // ...
}

// Generic en tipo
type GetterResult = {
  data: ArrayBuffer;
  cacheHit: boolean;
}

// Generic constraints
array_group<T>(items: T[], keyFn: (item: T) => string)
```

**Qué estudiar:**

- Sintaxis básica de generics
- Generic functions
- Generic classes
- Generic constraints (`extends`)
- Multiple type parameters
- Default type parameters

**Ejercicios prácticos:**

- Crear una función genérica simple
- Implementar una clase genérica (ej: `Box<T>`)
- Usar constraints para limitar tipos
- Crear funciones con múltiples type parameters

---

### 2.6 Utility Types

**Conceptos Clave:**

- ✅ **Utility types**: Tipos predefinidos que transforman otros tipos
- ✅ **`Partial<T>`**: Hace todas las propiedades opcionales
- ✅ **`Required<T>`**: Hace todas las propiedades requeridas
- ✅ **`Pick<T, K>`**: Selecciona propiedades específicas
- ✅ **`Omit<T, K>`**: Omite propiedades específicas
- ✅ **`Readonly<T>`**: Hace todas las propiedades readonly

**Ejemplos del código:**

```typescript
Partial<Omit<OspsaMedicine, 'droga' | 'nombreComercial' | 'presentacion'>> &
  Pick<OspsaMedicine, 'droga' | 'nombreComercial' | 'presentacion'>;
```

**Qué estudiar:**

- `Partial<T>`
- `Required<T>`
- `Pick<T, K>`
- `Omit<T, K>`
- `Readonly<T>`
- `Record<K, V>`
- `Exclude<T, U>`
- `Extract<T, U>`
- `NonNullable<T>`

**Ejercicios prácticos:**

- Usar `Partial` para crear tipos opcionales
- Usar `Pick` y `Omit` para crear tipos derivados
- Combinar utility types

---

### 2.7 Type Aliases vs Interfaces

**Conceptos Clave:**

- ✅ **`type`**: Alias para un tipo (puede ser cualquier tipo)
- ✅ **`interface`**: Define la forma de un objeto (solo objetos)
- ✅ **Extensión**: Interfaces con `extends`, types con `&`
- ✅ **Cuándo usar cada una**: Interfaces para objetos, types para unions/intersections

**Ejemplos del código:**

```typescript
// Type alias
type RecipeParseResults = {
  altura?: number | undefined;
  apellido?: string;
  // ...
};

// Interface (probablemente en types.ts)
interface Recipe {
  id: string;
  // ...
}
```

**Qué estudiar:**

- Diferencia entre `type` e `interface`
- Extensión de interfaces
- Extensión de types
- Cuándo usar cada uno
- Declaration merging (solo interfaces)

---

### 2.8 Optional Properties (`?`)

**Conceptos Clave:**

- ✅ **Optional properties**: Propiedades que pueden ser `undefined`
- ✅ **Sintaxis**: `prop?: Type` o `prop: Type | undefined`
- ✅ **Optional chaining**: `obj?.prop?.method()`
- ✅ **Nullish coalescing**: `value ?? defaultValue`

**Ejemplos del código:**

```typescript
altura?: number | undefined
email?: string[]
phone?: string[]
undefined !== diagnosisInformation.description
diagnosisInformation.icd10?.length ?? 0
```

**Qué estudiar:**

- Sintaxis de optional properties
- Optional chaining (`?.`)
- Nullish coalescing (`??`)
- Diferencia entre `undefined` y `null`

**Ejercicios prácticos:**

- Crear interfaces con propiedades opcionales
- Usar optional chaining en código real
- Usar nullish coalescing para valores por defecto

---

### 2.9 Type Assertions (`as`)

**Conceptos Clave:**

- ✅ **Type assertions**: Le dices a TypeScript el tipo de un valor
- ✅ **Sintaxis**: `value as Type` o `<Type>value`
- ✅ **No es type casting**: No convierte el valor, solo le dice a TS el tipo
- ✅ **Usar con cuidado**: Puedes mentirle a TypeScript

**Ejemplos del código:**

```typescript
const misRXRecipe = StrictJSON.parse(decode(data)) as MisRXRecipe;
const rctaRecipe = StrictJSON.parse(decode(data)) as RctaRecipe;
const [hash]: [string] = Array.from(hashes.values()) as [string];
```

**Qué estudiar:**

- Sintaxis de type assertions
- Cuándo usar type assertions
- Diferencia con type guards
- Riesgos de type assertions

**Ejercicios prácticos:**

- Usar type assertions cuando sea necesario
- Comparar con type guards
- Entender cuándo es seguro usar `as`

---

### 2.10 Mapped Types

**Conceptos Clave:**

- ✅ **Mapped types**: Crear nuevos tipos basados en otros tipos
- ✅ **Sintaxis**: `{ [K in keyof T]: T[K] }`
- ✅ **Útil para**: Transformar tipos de forma programática

**Qué estudiar:**

- Sintaxis básica de mapped types
- `keyof` operator
- `in` operator
- Crear utility types personalizados

---

### 2.11 Conditional Types

**Conceptos Clave:**

- ✅ **Conditional types**: Tipos que dependen de condiciones
- ✅ **Sintaxis**: `T extends U ? X : Y`
- ✅ **Útil para**: Tipos que cambian según condiciones

**Qué estudiar:**

- Sintaxis de conditional types
- `extends` en conditional types
- Inferencia en conditional types
- Casos de uso avanzados

---

## 3. Programación Asíncrona

### 3.1 Promises

**Conceptos Clave:**

- ✅ **Promise**: Representa un valor que estará disponible en el futuro
- ✅ **Estados**: `pending`, `fulfilled`, `rejected`
- ✅ **`.then()`**: Maneja el resultado exitoso
- ✅ **`.catch()`**: Maneja errores
- ✅ **`.finally()`**: Se ejecuta siempre

**Ejemplos del código:**

```typescript
Promise.all(parsers.map((parser: Parser): Promise<(Recipe | URL)[]> => filterByParser(urls, parser)));
```

**Qué estudiar:**

- Crear Promises
- `.then()`, `.catch()`, `.finally()`
- `Promise.all()` - espera todas las promesas
- `Promise.race()` - espera la primera
- `Promise.allSettled()` - espera todas sin importar resultado
- Chaining de promises

**Ejercicios prácticos:**

- Crear funciones que retornen Promises
- Usar `Promise.all` para operaciones paralelas
- Manejar errores con `.catch()`

---

### 3.2 async/await

**Conceptos Clave:**

- ✅ **`async`**: Marca una función como asíncrona (retorna Promise)
- ✅ **`await`**: Espera a que una Promise se resuelva
- ✅ **Sintaxis más limpia**: Alternativa a `.then()/.catch()`
- ✅ **Error handling**: Usar `try/catch`

**Ejemplos del código:**

```typescript
const fromUrls: (getter: Getter, urls: (string | URL)[]) => Promise<[Recipe[], URL[]]> = async (
  getter: Getter,
  urls: (string | URL)[],
): Promise<[Recipe[], URL[]]> => {
  // ...
  return (await Promise.all(parsers.map(...)))
}

public readonly parse: (url: URL) => Promise<Recipe> = async (url: URL): Promise<Recipe> => {
  const getterURL: string = (await this.mangleURL(url)).toString();
  const rawData: GetterResult = await this.getter.get(getterURL, { log: true });
  const recipe: Recipe = await this.doParse(rawData.data, url);
  // ...
}
```

**Qué estudiar:**

- Sintaxis de `async/await`
- Funciones async retornan Promises
- `await` solo funciona en funciones async
- Error handling con `try/catch`
- `await` en loops
- Paralelismo vs secuencialidad

**Ejercicios prácticos:**

- Convertir código con `.then()` a `async/await`
- Manejar errores con `try/catch`
- Usar `Promise.all` con `await` para paralelismo

---

### 3.3 Promise.all y Paralelismo

**Conceptos Clave:**

- ✅ **`Promise.all()`**: Ejecuta múltiples promises en paralelo
- ✅ **Falla rápido**: Si una falla, todas fallan
- ✅ **Orden preservado**: Resultados en el mismo orden que las promises
- ✅ **Útil para**: Operaciones independientes que se pueden hacer en paralelo

**Ejemplos del código:**

```typescript
return (
  await Promise.all(parsers.map((parser: Parser): Promise<(Recipe | URL)[]> => filterByParser(urls, parser)))
).flat();
```

**Qué estudiar:**

- `Promise.all()` - todas deben cumplirse
- `Promise.allSettled()` - espera todas sin importar resultado
- `Promise.race()` - primera que se cumple
- Paralelismo vs secuencialidad
- Cuándo usar cada uno

**Ejercicios prácticos:**

- Hacer múltiples requests HTTP en paralelo
- Comparar `Promise.all` vs secuencial con `await`
- Usar `Promise.allSettled` para operaciones que pueden fallar

---

### 3.4 Error Handling en Async Code

**Conceptos Clave:**

- ✅ **`try/catch`**: Maneja errores en código async
- ✅ **`.catch()`**: Maneja errores en promises
- ✅ **Error propagation**: Errores se propagan en la cadena de promises
- ✅ **Re-throwing**: Relanzar errores después de logging

**Ejemplos del código:**

```typescript
parser
  .parse(new URL(url))
  .then((recipe: Recipe): Recipe => remapDiagnoses(recipe))
  .catch((): URL => new URL(url));
```

**Qué estudiar:**

- `try/catch` con `async/await`
- `.catch()` en promises
- Error propagation
- Custom error classes
- Error handling en `Promise.all`

---

## 4. Funciones de Orden Superior y Programación Funcional

### 4.1 Funciones como Valores de Primera Clase

**Conceptos Clave:**

- ✅ **First-class functions**: Las funciones son valores que se pueden pasar, retornar, almacenar
- ✅ **Function expressions**: `const fn = () => {}`
- ✅ **Arrow functions**: `() => {}`
- ✅ **Higher-order functions**: Funciones que toman o retornan funciones

**Ejemplos del código:**

```typescript
protected mangleURL: (url: URL) => Promise<URL> = idPromise<URL>;
const remapDiagnosis: (diagnosisInformation: DiagnosisInformation) => DiagnosisInformation
```

**Qué estudiar:**

- Arrow functions vs function declarations
- Funciones como parámetros
- Funciones como valores de retorno
- Closures

---

### 4.2 Array Methods: map, filter, reduce

**Conceptos Clave:**

- ✅ **`.map()`**: Transforma cada elemento del array
- ✅ **`.filter()`**: Filtra elementos que cumplen condición
- ✅ **`.reduce()`**: Reduce array a un solo valor
- ✅ **`.flat()`**: Aplana arrays anidados
- ✅ **`.flatMap()`**: Map + flat en uno

**Ejemplos del código:**

```typescript
// map
urls.map((url: string | URL): Promise<Recipe | URL> => parser.parse(...))

// filter
urls.filter((url: string | URL): boolean => parser.isOurURL(new URL(url)))

// reduce
.reduce(
  ([previousRecipes, previousUrls]: [Recipe[], URL[]], current: Recipe | URL): [Recipe[], URL[]] => [
    [...previousRecipes, ...(!(current instanceof URL) ? [current] : [])],
    [...previousUrls, ...(current instanceof URL ? [current] : [])],
  ],
  [[], []],
)

// flatMap
.flatMap((contents: string): [string, string[]][] => ...)
```

**Qué estudiar:**

- `.map()` - transformación
- `.filter()` - filtrado
- `.reduce()` - reducción/acumulación
- `.flat()` - aplanar
- `.flatMap()` - map + flat
- `.find()` - encontrar primer elemento
- `.some()` - alguno cumple condición
- `.every()` - todos cumplen condición
- Chaining de métodos

**Ejercicios prácticos:**

- Transformar arrays con `.map()`
- Filtrar arrays con `.filter()`
- Acumular valores con `.reduce()`
- Combinar múltiples métodos

---

### 4.3 Inmutabilidad

**Conceptos Clave:**

- ✅ **Inmutabilidad**: No modificar datos existentes, crear nuevos
- ✅ **Spread operator**: `[...array, newItem]`
- ✅ **Object spread**: `{ ...obj, newProp: value }`
- ✅ **Beneficios**: Predictibilidad, debugging más fácil

**Ejemplos del código:**

```typescript
[...previousRecipes, ...(!(current instanceof URL) ? [current] : [])]
[...previousUrls, ...(current instanceof URL ? [current] : [])]
```

**Qué estudiar:**

- Spread operator en arrays
- Spread operator en objetos
- Inmutabilidad vs mutación
- Beneficios de la inmutabilidad

---

### 4.4 Destructuring

**Conceptos Clave:**

- ✅ **Array destructuring**: `const [first, second] = array`
- ✅ **Object destructuring**: `const { prop1, prop2 } = obj`
- ✅ **Rest operator**: `const [first, ...rest] = array`
- ✅ **Default values**: `const { prop = defaultValue } = obj`

**Ejemplos del código:**

```typescript
const [recipes, failedUrls]: [Recipe[], URL[]] = await fromUrls(getter, recipesUrl);
const { groups }: RegExpExecArray = e as RegExpExecArray & { groups: { [key: string]: string } };
```

**Qué estudiar:**

- Array destructuring
- Object destructuring
- Rest operator
- Default values
- Nested destructuring

---

### 4.5 Closures

**Conceptos Clave:**

- ✅ **Closure**: Función que tiene acceso a variables de su scope externo
- ✅ **Lexical scoping**: Acceso a variables del scope donde se definió
- ✅ **Útil para**: Encapsulación, factory functions, callbacks

**Ejemplos del código:**

```typescript
const filterByParser: (urls: (string | URL)[], parser: Parser) => Promise<(Recipe | URL)[]> = (
  urls: (string | URL)[],
  parser: Parser,
): Promise<(Recipe | URL)[]> =>
  Promise.all(
    urls
      .filter((url: string | URL): boolean => parser.isOurURL(new URL(url))) // closure sobre parser
      .map((url: string | URL): Promise<Recipe | URL> => parser.parse(...)) // closure sobre parser
  )
```

**Qué estudiar:**

- Qué son closures
- Lexical scoping
- Casos de uso
- Memory leaks con closures

---

## 5. Patrones de Diseño

### 5.1 Template Method Pattern

**Conceptos Clave:**

- ✅ **Template Method**: Define el esqueleto de un algoritmo en la clase base
- ✅ **Hooks**: Métodos abstractos que las subclases implementan
- ✅ **Reutilización**: Código común en la clase base, específico en subclases

**Ejemplos del código:**

```typescript
// Clase base define el template
abstract class Parser {
  public readonly parse: (url: URL) => Promise<Recipe> = async (url: URL): Promise<Recipe> => {
    // Template method - define el flujo
    if (!this.isOurURL(url)) throw new ParserURLError(url, this.name);
    const getterURL = (await this.mangleURL(url)).toString();
    const rawData = await this.getter.get(getterURL, { log: true });
    const recipe = await this.doParse(rawData.data, url); // Hook method
    // ...
  };

  // Hook methods - implementados por subclases
  protected abstract doParse: (data: ArrayBuffer, url: URL) => Promise<Recipe>;
}
```

**Qué estudiar:**

- Template Method Pattern
- Cuándo usarlo
- Beneficios
- Relación con herencia

---

### 5.2 Strategy Pattern

**Conceptos Clave:**

- ✅ **Strategy**: Define una familia de algoritmos intercambiables
- ✅ **Encapsulación**: Cada estrategia está encapsulada
- ✅ **Intercambiabilidad**: Se pueden cambiar estrategias en runtime

**Ejemplos del código:**

```typescript
// Cada parser es una estrategia diferente
const parsers: Parser[] = [new OspsaParser(getter), new MisRXParser(getter), new RctaParser(getter)];

// Se selecciona la estrategia apropiada
parsers.map((parser: Parser) => filterByParser(urls, parser));
```

**Qué estudiar:**

- Strategy Pattern
- Cuándo usarlo
- Diferencia con Template Method
- Implementación

---

### 5.3 Factory Pattern

**Conceptos Clave:**

- ✅ **Factory**: Crea objetos sin especificar la clase exacta
- ✅ **Encapsulación**: Oculta la lógica de creación
- ✅ **Flexibilidad**: Fácil agregar nuevos tipos

**Ejemplos del código:**

```typescript
// Factory implícito - fromUrls crea instancias
const parsers: Parser[] = [new OspsaParser(getter), new MisRXParser(getter), new RctaParser(getter)];
```

**Qué estudiar:**

- Factory Pattern
- Simple Factory
- Factory Method
- Abstract Factory

---

## 6. Manejo de Errores

### 6.1 Try/Catch

**Conceptos Clave:**

- ✅ **`try`**: Bloque de código que puede lanzar errores
- ✅ **`catch`**: Maneja errores lanzados
- ✅ **`finally`**: Se ejecuta siempre
- ✅ **Error objects**: `Error`, custom errors

**Ejemplos del código:**

```typescript
try {
  hashes = this.#hashes(pdfParseResults);
} catch (e) {
  console.error(e);
  return url;
}
```

**Qué estudiar:**

- Sintaxis de `try/catch/finally`
- Lanzar errores con `throw`
- Custom error classes
- Error propagation

---

### 6.2 Custom Error Classes

**Conceptos Clave:**

- ✅ **Extender Error**: Crear clases de error personalizadas
- ✅ **Propiedades adicionales**: Agregar información al error
- ✅ **Type safety**: TypeScript conoce el tipo del error

**Ejemplos del código:**

```typescript
class ParserError extends Error {}

class ParserRecipeError extends ParserError {}

class ParserURLError extends ParserError {
  public get parserName(): string {
    return this.#parserName;
  }
  public get url(): URL {
    return this.#url;
  }

  #parserName: string;
  #url: URL;

  constructor(url: URL, parserName: string) {
    super(`URL ${url.toString()} is not valid for ${parserName} parser`);
    this.name = 'ParserURLError';
    this.#url = url;
    this.#parserName = parserName;
  }
}
```

**Qué estudiar:**

- Extender la clase `Error`
- Agregar propiedades personalizadas
- `instanceof` para verificar tipo de error
- Error handling específico por tipo

---

### 6.3 Error Handling en Promises

**Conceptos Clave:**

- ✅ **`.catch()`**: Maneja errores en promises
- ✅ **Error propagation**: Errores se propagan en la cadena
- ✅ **`Promise.reject()`**: Rechazar una promise

**Ejemplos del código:**

```typescript
parser
  .parse(new URL(url))
  .then((recipe: Recipe): Recipe => remapDiagnoses(recipe))
  .catch((): URL => new URL(url)); // Convierte error en URL
```

**Qué estudiar:**

- `.catch()` en promises
- Error handling en `async/await`
- `Promise.reject()`
- Error propagation

---

## 7. Estructuras de Datos Avanzadas

### 7.1 Map

**Conceptos Clave:**

- ✅ **Map**: Estructura clave-valor
- ✅ **Claves de cualquier tipo**: No solo strings
- ✅ **Métodos**: `.get()`, `.set()`, `.has()`, `.delete()`, `.clear()`
- ✅ **Iteración**: `.forEach()`, `for...of`

**Ejemplos del código:**

```typescript
const diagnosesMap: Map<string, string[]> = new Map<string, string[]>();
diagnosesMap.get(normalizeText(diagnosisInformation.description));
kairosNameAndPresentationToAlfaBetaKey.get(tradeName)?.get(presentation);
```

**Qué estudiar:**

- Crear y usar Maps
- Métodos de Map
- Iteración sobre Maps
- Diferencia con objetos planos
- Cuándo usar Map vs Object

**Ejercicios prácticos:**

- Crear un Map y agregar/obtener valores
- Iterar sobre un Map
- Comparar Map con objeto plano

---

### 7.2 Set

**Conceptos Clave:**

- ✅ **Set**: Colección de valores únicos
- ✅ **Sin duplicados**: Automáticamente elimina duplicados
- ✅ **Métodos**: `.add()`, `.has()`, `.delete()`, `.clear()`
- ✅ **Iteración**: `.forEach()`, `for...of`

**Ejemplos del código:**

```typescript
new Set<string>(array_from_entries(...))
new Set<number>(keys)
```

**Qué estudiar:**

- Crear y usar Sets
- Métodos de Set
- Eliminación de duplicados
- Operaciones de conjunto (union, intersection, difference)
- Cuándo usar Set vs Array

---

### 7.3 WeakMap y WeakSet

**Conceptos Clave:**

- ✅ **WeakMap/WeakSet**: Versiones "débiles" de Map/Set
- ✅ **Solo objetos como claves**: No primitivos
- ✅ **Garbage collection**: Permiten que las claves sean recolectadas
- ✅ **No iterables**: No se pueden iterar

**Qué estudiar:**

- Diferencia con Map/Set
- Casos de uso
- Garbage collection
- Limitaciones

---

## 8. Manejo de Archivos y I/O

### 8.1 File System (Node.js)

**Conceptos Clave:**

- ✅ **`fs` module**: Módulo de Node.js para operaciones de archivos
- ✅ **Síncrono vs Asíncrono**: `readFileSync` vs `readFile`
- ✅ **Buffers**: Representación binaria de datos
- ✅ **Encoding**: UTF-8, etc.

**Ejemplos del código:**

```typescript
readFileSync(`${import.meta.dirname}/../../datasets/icd10/out/icd10.json`, { encoding: 'utf-8' });
readFileSync(file, { encoding: 'utf-8' });
readdirSync(directory, { encoding: 'utf-8', withFileTypes: true });
```

**Qué estudiar:**

- `fs.readFile()` / `fs.readFileSync()`
- `fs.writeFile()` / `fs.writeFileSync()`
- `fs.readdir()` / `fs.readdirSync()`
- `fs.mkdir()` / `fs.mkdirSync()`
- Buffers y encoding
- Paths absolutos vs relativos

---

### 8.2 ArrayBuffer y Typed Arrays

**Conceptos Clave:**

- ✅ **ArrayBuffer**: Representación binaria de datos
- ✅ **Typed Arrays**: Vistas tipadas sobre ArrayBuffer
- ✅ **Uint8Array**: Array de bytes sin signo
- ✅ **Conversión**: Buffer ↔ ArrayBuffer ↔ String

**Ejemplos del código:**

```typescript
data: ArrayBuffer;
Buffer.from(copyArrayBuffer(data));
Uint8Array.from(data).buffer;
```

**Qué estudiar:**

- ArrayBuffer
- Typed Arrays (Uint8Array, Int32Array, etc.)
- Buffer (Node.js)
- Conversiones entre formatos
- Manipulación de datos binarios

---

### 8.3 CSV Parsing

**Conceptos Clave:**

- ✅ **CSV**: Comma-Separated Values
- ✅ **Parsing**: Convertir texto CSV a estructuras de datos
- ✅ **Encoding**: UTF-8, manejo de caracteres especiales
- ✅ **Headers**: Primera fila como nombres de columnas

**Ejemplos del código:**

```typescript
readString(contents) as [string, string][]
.map(([diagnosis, icd10s]: [string, string]): [string, string[]] => [
  normalizeText(diagnosis),
  icd10s.split(',').map(normalizeText).filter(...)
])
```

**Qué estudiar:**

- Formato CSV
- Parsing manual vs librerías
- Manejo de comillas y escapes
- Encoding issues

---

## 9. Expresiones Regulares

### 9.1 Fundamentos de Regex

**Conceptos Clave:**

- ✅ **Regex**: Patrones para matching de texto
- ✅ **Literales**: `/pattern/` o `new RegExp('pattern')`
- ✅ **Flags**: `i` (case-insensitive), `g` (global), `v` (unicode sets)
- ✅ **Caracteres especiales**: `.`, `*`, `+`, `?`, `^`, `$`, `|`

**Ejemplos del código:**

```typescript
/https:\/\/misrx\.com\.ar\/receta\?token=[0-9a-z%\-]+/iv
/^Rp(?<rpIndex>\d+)\s(?<monodrug>[^\p{Lower}\d]+)\s(?<presentation>\S.*)\s\((?<tradeName>.+)\)\.\s+Env\.:\s+(?<units>\d+)/v
new RegExp(`${regexQuote(this.#hashURL.toString().replace(/\/+$/gv, ''))}\\/(?<hash>[0-9a-f]+)`, 'gi')
```

**Qué estudiar:**

- Sintaxis básica de regex
- Caracteres especiales
- Quantifiers (`*`, `+`, `?`, `{n}`, `{n,m}`)
- Character classes (`[abc]`, `[0-9]`, `\d`, `\w`, `\s`)
- Anchors (`^`, `$`)
- Alternation (`|`)
- Flags (`i`, `g`, `m`, `v`)

**Ejercicios prácticos:**

- Crear regex para validar emails
- Crear regex para extraer números
- Crear regex para validar URLs

---

### 9.2 Grupos de Captura

**Conceptos Clave:**

- ✅ **Grupos**: `(pattern)` - capturan parte del match
- ✅ **Named groups**: `(?<name>pattern)` - grupos con nombre
- ✅ **Non-capturing groups**: `(?:pattern)` - no capturan
- ✅ **Backreferences**: `\1`, `\2` - referencian grupos anteriores

**Ejemplos del código:**

```typescript
/^Rp(?<rpIndex>\d+)\s(?<monodrug>[^\p{Lower}\d]+)\s(?<presentation>\S.*)\s\((?<tradeName>.+)\)\.\s+Env\.:\s+(?<units>\d+)/v;
const { groups } = e as RegExpExecArray & { groups: { [key: string]: string } };
groups.rpIndex;
groups.monodrug;
```

**Qué estudiar:**

- Grupos de captura
- Named groups
- Non-capturing groups
- Acceso a grupos en código
- Backreferences

**Ejercicios prácticos:**

- Extraer partes de una fecha con grupos
- Usar named groups para legibilidad
- Crear regex con backreferences

---

### 9.3 Métodos de Regex

**Conceptos Clave:**

- ✅ **`.test()`**: Verifica si hay match (retorna boolean)
- ✅ **`.exec()`**: Encuentra un match (retorna match object o null)
- ✅ **`.match()`**: Encuentra matches (retorna array o null)
- ✅ **`.matchAll()`**: Encuentra todos los matches (retorna iterator)
- ✅ **`.replace()`**: Reemplaza matches
- ✅ **`.search()`**: Encuentra índice del primer match

**Ejemplos del código:**

```typescript
/pattern/iv.test(url.toString());
l.href.matchAll(regexp).map((m: RegExpExecArray): string => (m.groups as { hash: string }).hash);
```

**Qué estudiar:**

- `.test()` - verificación rápida
- `.exec()` - match único con grupos
- `.match()` - matches simples
- `.matchAll()` - todos los matches con grupos
- `.replace()` - reemplazo
- `.search()` - encontrar posición

**Ejercicios prácticos:**

- Validar strings con `.test()`
- Extraer información con `.match()` o `.matchAll()`
- Reemplazar texto con `.replace()`

---

## 10. Testing y Debugging

### 10.1 Fundamentos de Testing

**Conceptos Clave:**

- ✅ **Unit tests**: Prueban funciones/clases individuales
- ✅ **Integration tests**: Prueban interacción entre componentes
- ✅ **Test structure**: Arrange, Act, Assert
- ✅ **Assertions**: Verificar que el código funciona correctamente

**Qué estudiar:**

- Estructura de tests
- Escribir assertions
- Test cases y edge cases
- Mocks y stubs

---

### 10.2 Debugging

**Conceptos Clave:**

- ✅ **`console.log()`**: Logging básico
- ✅ **`console.error()`**: Logging de errores
- ✅ **Debugger**: Breakpoints en código
- ✅ **Stack traces**: Rastrear origen de errores

**Ejemplos del código:**

```typescript
console.log(`Key ${k} missing in parse results.`);
console.error(e);
```

**Qué estudiar:**

- Uso de `console.log`, `console.error`, `console.warn`
- Debugger en navegador/IDE
- Stack traces
- Logging estructurado

---

## 📖 Recursos Recomendados

### Libros

- **"You Don't Know JS"** (Kyle Simpson) - JavaScript profundo
- **"Effective TypeScript"** (Dan Vanderkam) - TypeScript avanzado
- **"Design Patterns: Elements of Reusable Object-Oriented Software"** (Gang of Four) - Patrones de diseño

### Documentación Oficial

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [MDN Web Docs](https://developer.mozilla.org/) - JavaScript reference
- [Node.js Documentation](https://nodejs.org/docs/)

### Cursos Online

- TypeScript Deep Dive
- JavaScript.info
- FreeCodeCamp

### Práctica

- **LeetCode** - Algoritmos y estructuras de datos
- **Codewars** - Ejercicios de programación
- **Type Challenges** - Ejercicios de TypeScript

---

## 🎯 Plan de Estudio Sugerido

### Semana 1-2: Fundamentos

- OOP básico (clases, herencia, encapsulación)
- TypeScript básico (tipos, interfaces, type annotations)
- Promises y async/await básico

### Semana 3-4: Intermedio

- Clases abstractas y override
- Generics básicos
- Array methods (map, filter, reduce)
- Type guards

### Semana 5-6: Avanzado

- Generics avanzados y utility types
- Patrones de diseño (Template Method, Strategy)
- Expresiones regulares
- Estructuras de datos (Map, Set)

### Semana 7-8: Especialización

- TypeScript avanzado (conditional types, mapped types)
- Programación funcional avanzada
- Manejo de errores robusto
- Testing

---

## ✅ Checklist de Competencias

Marca cuando domines cada concepto:

### OOP

- [ ] Clases y instancias
- [ ] Modificadores de acceso (public, protected, private, #)
- [ ] Propiedades estáticas
- [ ] Getters y setters
- [ ] Herencia y `extends`
- [ ] Clases abstractas
- [ ] Override de métodos
- [ ] Encapsulación

### TypeScript

- [ ] Tipos básicos y anotaciones
- [ ] Union types (`|`)
- [ ] Intersection types (`&`)
- [ ] Type guards
- [ ] Generics básicos
- [ ] Utility types (Partial, Pick, Omit)
- [ ] Optional properties (`?`)
- [ ] Type assertions (`as`)

### Asíncrono

- [ ] Promises
- [ ] async/await
- [ ] Promise.all, Promise.race
- [ ] Error handling en async code

### Funcional

- [ ] Arrow functions
- [ ] Array methods (map, filter, reduce)
- [ ] Inmutabilidad
- [ ] Destructuring
- [ ] Closures

### Otros

- [ ] Expresiones regulares básicas
- [ ] Map y Set
- [ ] File I/O básico
- [ ] Manejo de errores
- [ ] Patrones de diseño básicos

---
