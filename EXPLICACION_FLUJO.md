# Explicación Completa del Flujo: `pnpx tsx src/reports/ososs/index.ts ai`

## PARTE 1: ¿Por qué necesitas `loadDrugToIcd10` y lectura dinámica?

### El Problema del Cache de Módulos en Node.js/TypeScript

En Node.js (y por extensión TypeScript compilado), cuando importas un módulo, el código de **nivel superior** (top-level) se ejecuta **UNA SOLA VEZ** cuando el módulo se carga por primera vez. Después, el módulo se cachea y nunca se vuelve a ejecutar ese código de nivel superior.

#### Ejemplo del Problema (ANTES del cambio):

```typescript
// src/analyses/recipes/drug-diagnosis/index.ts

// ❌ PROBLEMA: Esto se ejecuta UNA SOLA VEZ cuando el módulo se importa por primera vez
const drugToIcd10: Map<string, Map<string, Category>> = new Map(
  Array.from(
    array_categorize([
      // ... datos del JSON base ...
      ...readFilesSorted(`${import.meta.dirname}/missing`).map(...)  // ← Se lee UNA VEZ
    ])
  )
);

const scorer: Scorer = (recipes: Recipe[]) => {
  // Usa drugToIcd10 que fue construido UNA VEZ al inicio
  const icd10s = drugToIcd10.get(drug);
  // ...
}
```

**¿Qué pasa cuando ejecutas el flujo?**

1. **Primera ejecución de `analyzeUrls()`:**
   - Node.js importa el módulo `drug-diagnosis/index.ts` por primera vez
   - Se ejecuta el código de nivel superior: `const drugToIcd10 = ...`
   - `readFilesSorted()` lee los archivos CSV que existen en ese momento (ej: 7 archivos)
   - Se construye el Map con esos 7 archivos
   - El módulo se cachea en memoria
   - El scorer usa ese Map cacheado

2. **AI procesa y escribe nuevos overrides:**
   - `writeOverrides()` escribe un nuevo archivo CSV: `20251106203530.csv`
   - Ahora hay 8 archivos en la carpeta `missing/`

3. **Segunda ejecución de `analyzeUrls()`:**
   - Node.js **NO vuelve a importar** el módulo (está cacheado)
   - El código de nivel superior **NO se vuelve a ejecutar**
   - `drugToIcd10` sigue siendo el mismo Map de la primera ejecución (con solo 7 archivos)
   - El scorer usa el Map viejo que **NO incluye** el nuevo archivo de AI
   - ❌ **Los datos de OpenAI NO se usan**

### La Solución: Lectura Dinámica

#### Cómo funciona AHORA (DESPUÉS del cambio):

```typescript
// ✅ SOLUCIÓN: Esto es una función, NO se ejecuta al importar el módulo
const loadDrugToIcd10: () => Map<string, Map<string, Category>> = () => {
  // Esta función se ejecuta CADA VEZ que se llama
  return new Map(
    Array.from(
      array_categorize([
        // ... datos del JSON base ...
        ...readFilesSorted(`${import.meta.dirname}/missing`).map(...)  // ← Se lee CADA VEZ
      ])
    )
  );
};

const scorer: Scorer = (recipes: Recipe[]) => {
  // ✅ Llama a la función CADA VEZ que se ejecuta el scorer
  const drugToIcd10 = loadDrugToIcd10();  // ← Lee archivos frescos cada vez
  const icd10s = drugToIcd10.get(drug);
  // ...
}
```

**¿Qué pasa ahora cuando ejecutas el flujo?**

1. **Primera ejecución de `analyzeUrls()`:**
   - Node.js importa el módulo (solo define la función, NO la ejecuta)
   - El scorer se ejecuta y llama `loadDrugToIcd10()`
   - `readFilesSorted()` lee los archivos CSV actuales (7 archivos)
   - Se construye el Map con esos 7 archivos
   - El scorer usa ese Map

2. **AI procesa y escribe nuevos overrides:**
   - `writeOverrides()` escribe un nuevo archivo CSV: `20251106203530.csv`
   - Ahora hay 8 archivos en la carpeta `missing/`

3. **Segunda ejecución de `analyzeUrls()`:**
   - El módulo sigue cacheado (pero eso no importa)
   - El scorer se ejecuta y llama `loadDrugToIcd10()` **de nuevo**
   - `readFilesSorted()` lee los archivos CSV **actuales** (8 archivos ahora)
   - Se construye un Map **nuevo** con los 8 archivos
   - El scorer usa el Map nuevo que **SÍ incluye** el archivo de AI
   - ✅ **Los datos de OpenAI SÍ se usan**

### Resumen de la Diferencia

| Aspecto | ANTES (constante) | AHORA (función) |
|---------|------------------|-----------------|
| **Cuándo se ejecuta** | Al importar el módulo (una vez) | Cada vez que se llama al scorer |
| **Cuándo se leen los CSV** | Al inicio del proceso | En cada ejecución del scorer |
| **¿Lee nuevos archivos?** | ❌ No (cacheado) | ✅ Sí (dinámico) |
| **¿Usa datos de AI?** | ❌ No | ✅ Sí |

---

## PARTE 2: Flujo Completo Paso a Paso

### Comando: `pnpx tsx src/reports/ososs/index.ts ai`

### PASO 1: Inicialización del Script

**Archivo:** `src/reports/ososs/index.ts`

1. **Node.js/TSX carga el módulo:**
   - Lee el archivo `src/reports/ososs/index.ts`
   - Ejecuta todos los `import` statements
   - Carga todos los módulos dependientes (pero NO ejecuta funciones todavía)
   - Para `drug-diagnosis/index.ts`: Solo define `loadDrugToIcd10` como función (NO la ejecuta)

2. **Lee configuración:**
   - `readFileLinesSorted()` lee `src/reports/ososs/in` para obtener las URLs
   - Crea el `config` Map con los umbrales de scoring

3. **Prepara funciones:**
   - Define `prepareMissingData()` (no se ejecuta todavía)
   - Define `writeReport()` (no se ejecuta todavía)

### PASO 2: Primera Ejecución de `analyzeUrls()`

**Línea:** `let analysisResult: AnalysisResult = await analyzeUrls(urls, config);`

**Archivo:** `src/analyses/index.ts`

#### 2.1. Inicialización del Getter
```typescript
const getter: Getter = Getter.createLocal();
```
- Crea un Getter que maneja cache local y descargas web
- Configura rutas de cache

#### 2.2. Obtención de Recetas desde URLs
```typescript
const [recipes, missingUrls]: [Recipe[], URL[]] = await fromUrls(getter, urls);
```

**Archivo:** `src/parsers/index.ts`

**Proceso:**
1. Para cada URL en `urls`:
   - El Getter verifica si existe en cache (`cache/api.rcta.me/v1/medicines/...`)
   - Si existe: lee del cache (rápido)
   - Si NO existe: descarga de la web y guarda en cache
   
2. **Parsing de cada respuesta:**
   - Detecta el formato (RCTA, OSPSA, etc.)
   - Llama al parser correspondiente (`src/parsers/rcta/index.ts`, etc.)
   - Convierte JSON/XML a objetos `Recipe` tipados
   - Valida estructura y tipos

3. **Resultado:**
   - `recipes`: Array de objetos `Recipe` parseados
   - `missingUrls`: URLs que fallaron o no se pudieron parsear

#### 2.3. Ejecución de Todos los Scorers
```typescript
const [recipeResult, missing]: [AnyResult, AnyMissing] = runAllScorers(recipes, config);
```

**Archivo:** `src/analyses/recipes/index.ts`

**Proceso:**

1. **`attachVisitId()`:**
   - Agrupa recetas por visita (mismo paciente, misma fecha)
   - Asigna IDs secuenciales a cada visita

2. **Ejecución por Stages (4 stages):**

   **Stage 1:**
   - `diagnosisAge`, `diagnosisSex`, `diagnosisSpecialty`
   - `dispenseMatchDosage`, `dispenseMatchMonodrug`, `dispenseMatchTherapeuticAction`
   - `dispenseOptions`, `dispensePrice`, `dispenseUnits`
   - `drugDiagnosis`, `drugDrug`, `drugOptions`
   - `drugPrice`, `drugUnits`, `drugSpecialty`
   - `drugTherapeuticAction`, `drugVademecum`

   **Stage 2:**
   - `dispenseMatchPrescribedPrice`
   - `dispenseMatchPrescribedDosage`

   **Stage 3:**
   - `suspicionPrescribed`

   **Stage 4:**
   - `suspicionDispensed`

3. **Para cada scorer (ejemplo: `drug-diagnosis`):**

   **Archivo:** `src/analyses/recipes/drug-diagnosis/index.ts`

   a. **Carga de datos:**
   ```typescript
   const drugToIcd10 = loadDrugToIcd10();  // ← LEE ARCHIVOS CSV AQUÍ
   ```
   - Lee el JSON base: `datasets/rcta-to-icd/out/rcta-to-icd.json`
   - Lee TODOS los CSV en `analyses/recipes/drug-diagnosis/missing/` (ej: 7 archivos)
   - Combina ambos en un Map: `drug → Map<icd10, score>`

   b. **Procesamiento de cada receta:**
   - Extrae diagnósticos (ICD10) de la receta
   - Extrae medicamentos de la receta
   - Para cada combinación (drug, icd10):
     - Busca en `drugToIcd10.get(drug)?.get(icd10)`
     - Si encuentra: marca como resuelto con el score
     - Si NO encuentra: marca como missing

   c. **Resultado:**
   - `result`: Map con metadata de cada receta (scores, mensajes)
   - `missing`: Map con pares (drug, icd10) que no se encontraron

4. **Combinación de resultados:**
   - Combina resultados de todos los scorers
   - Combina missing de todos los scorers
   - Retorna `[recipeResult, missing]`

#### 2.4. Extracción de Datos por Entidad
```typescript
const [physicianResult] = extractData__physician(recipes, recipeResult);
const [pharmacyResult] = extractData__pharmacy(recipes, recipeResult);
const [patientResult] = extractData__patient(recipes, recipeResult);
```

**Proceso:**
- Agrupa resultados por médico, farmacia, paciente
- Calcula estadísticas agregadas
- Crea Maps indexados por ID

#### 2.5. Retorno del Resultado
```typescript
return {
  missing,        // Todos los missing encontrados
  missingUrls,    // URLs que fallaron
  recipes,        // Recetas parseadas
  results: {
    patient, pharmacy, physician, recipe
  }
};
```

### PASO 3: Preparación de Missing Data para AI

**Línea:** `const missingData: Record<string, string[][]> = prepareMissingData(analysisResult);`

**Archivo:** `src/reports/ososs/index.ts`

#### 3.1. Lectura de Carpetas Disponibles
```typescript
const feedbackDataDir = `${import.meta.dirname}/../../feedback/data`;
const availableFolders = readdirSync(feedbackDataDir, { withFileTypes: true })
  .filter(dirent => dirent.isDirectory())
  .map(dirent => dirent.name);
```
- Lee qué carpetas existen en `src/feedback/data/`
- Ejemplo: `['diagnoses', 'drugDiagnosis', 'drugSpecialty']`

#### 3.2. Generación de Reportes Solo para Carpetas Existentes
```typescript
for (const folderName of availableFolders) {
  if (folderName === 'diagnoses') {
    // Genera reporte especial para diagnoses
  } else {
    const generator = getReportGenerator(folderName, analysisResult);
    if (generator !== undefined) {
      const report = generator();
      if (report[0].length > 0) {
        missingData[folderName] = report[0];
      }
    }
  }
}
```

**Archivo:** `src/reports/generic/missing/reportGenerators.ts`

- Para cada carpeta que existe en feedback:
  - Busca el generador correspondiente
  - Genera el reporte de missing data
  - Solo incluye tipos que tienen carpeta en feedback

**Resultado:**
```typescript
{
  drugDiagnosis: [
    ['alprazolam', 'I61'],
    ['atorvastatin', 'E10'],
    // ... más filas
  ],
  drugSpecialty: [
    ['alprazolam', 'psiquiatria'],
    // ... más filas
  ]
}
```

### PASO 4: Procesamiento con AI

**Línea:** `const reanalyzedResult = await taskRunner.runFromArgv();`

**Archivo:** `src/reports/argv.settings.ts`

#### 4.1. Detección de Argumentos
```typescript
const argvString = argv.join(' ');
if (/\b(openai|ai)\b/gi.test(argvString)) {
  result = await this.runAITask();
}
```
- Detecta "ai" o "openai" en los argumentos
- Llama a `runAITask()`

#### 4.2. Procesamiento con OpenAI
```typescript
await processMissingData(this.openaiClient, this.missingData, 1000);
```

**Archivo:** `src/feedback/index.ts`

**Proceso detallado:**

1. **`parseMissingData(missingData)`:**
   - Para cada tipo de missing (ej: `drugDiagnosis`):
     - Lee `config.json` de `feedback/data/drugDiagnosis/config.json`
     - Extrae `resultKeys` y `keySeparator`
     - Convierte filas CSV a Records: `{ "alprazolam|I61": "" }`
   - Retorna: `{ drugDiagnosis: { "alprazolam|I61": "", ... } }`

2. **Loop de Stages (0, 1, 2, ... hasta que no haya más stages):**

   **Para cada stage:**
   
   a. **`processStage(openAi, stage, previous, sleepMs, witness)`:**
   
      - Para cada tipo de missing (ej: `drugDiagnosis`):
      
        i. **Carga configuración del stage:**
           - Lee `feedback/data/drugDiagnosis/{stage}.system.txt`
           - Lee `feedback/data/drugDiagnosis/{stage}.user.txt`
           - Lee `feedback/data/drugDiagnosis/config.json`
           - Crea `PromptConfig` con mensajes y configuración
       
        ii. **Divide en chunks:**
           - Divide los records en chunks de tamaño `chunkSize` (ej: 10)
           - Ejemplo: 64 records → 7 chunks
       
        iii. **Para cada chunk:**
            - Interpola el prompt con los datos del chunk
            - Llama a OpenAI API: `openai.chat.completions.create()`
            - Modelo: `gpt-4o-mini`, temperatura: 0.0
            - Espera respuesta JSON
            - Valida y parsea la respuesta
            - Extrae los resultados (ej: `{ "alprazolam|I61": "1" }`)
            - Espera `sleepMs` (1000ms) entre chunks
       
        iv. **Combina resultados:**
           - Combina resultados de todos los chunks
           - Actualiza el record con nuevos valores
           - Si algún chunk procesó, marca `done = false` para continuar
   
   b. **Verifica si hay más stages:**
      - Si `done === false`: hay más stages, continúa
      - Si `done === true`: no hay más stages, termina

3. **Conversión a formato final:**
   ```typescript
   const processedResults = Object.fromEntries(
     Object.entries(result).map(([name, theResult]) => [
       name,
       buildRecords(
         Object.entries(theResult)
           .filter(([, value]) => value.length > 0)  // Solo los que tienen respuesta
           .map(([key, value]) => `${key}${separator}${value}`),
         config.resultKeys,
         config.keySeparator
       )
     ])
   );
   ```
   - Convierte Records de vuelta a arrays de Records
   - Ejemplo: `[{ drug: "alprazolam", icd10: "I61", score: "1" }, ...]`

4. **Escritura de Overrides:**
   ```typescript
   writeOverrides(processedResults);
   ```

   **Archivo:** `src/feedback/index.ts`
   
   **Proceso:**
   - Para cada tipo procesado (ej: `drugDiagnosis`):
     - Genera timestamp: `20251106203530`
     - Convierte nombre: `drugDiagnosis` → `drug-diagnosis` (camelToSnakeCase)
     - Ruta: `src/analyses/recipes/drug-diagnosis/missing/20251106203530.csv`
     - Escribe CSV con headers y filas
     - **Este archivo ahora existe y será leído en la siguiente ejecución**

#### 4.3. Segunda Ejecución de `analyzeUrls()`
```typescript
return await analyzeUrls(this.urls, this.config);
```

**IMPORTANTE:** Esta es la segunda vez que se ejecuta `analyzeUrls()`

**Proceso (similar al PASO 2, pero con diferencias clave):**

1. **Getter y URLs:**
   - Usa cache (más rápido)
   - Obtiene las mismas recetas

2. **Ejecución de Scorers:**
   - **AQUÍ ES DONDE CAMBIA:**
   
   **Para `drug-diagnosis` scorer:**
   ```typescript
   const drugToIcd10 = loadDrugToIcd10();  // ← SE EJECUTA DE NUEVO
   ```
   
   - `readFilesSorted()` lee la carpeta `missing/` **DE NUEVO**
   - Ahora encuentra **8 archivos** (7 anteriores + 1 nuevo de AI)
   - Construye el Map con **TODOS** los 8 archivos
   - El nuevo archivo `20251106203530.csv` contiene los datos de AI
   - Cuando busca `drugToIcd10.get("alprazolam")?.get("I61")`, ahora encuentra el score de AI
   - **Resultado: Menos missing, más pares resueltos**

3. **Resultado:**
   - `missing`: Ahora tiene MENOS elementos (los que AI resolvió ya no están)
   - `recipeResult`: Tiene más pares resueltos con scores de AI

### PASO 5: Escritura de Reportes Finales

**Línea:** `writeReport(reportBaseDir, analysisResult);`

**Archivo:** `src/reports/ososs/index.ts`

**Proceso:**

1. **Crea directorio de salida:**
   ```typescript
   const timestamp = getISOTimestamp();  // "20251106201612"
   const reportBaseDir = `${import.meta.dirname}/out/${timestamp}`;
   mkdirSync(`${reportBaseDir}/missing`, { recursive: true });
   ```

2. **Escribe reportes de missing:**
   - `missing/urls.csv`: URLs que fallaron
   - `missing/diagnoses.csv`: Diagnósticos faltantes
   - `missing/drugDiagnosis.csv`: Pares drug-icd10 faltantes
   - `missing/drugSpecialty.csv`: Pares drug-specialty faltantes
   - ... (todos los tipos de missing)

3. **Escribe reportes de recetas:**
   - `recipes.csv`: Todas las recetas con sus scores
   - `billing.csv`: Facturación agregada
   - `stock.csv`: Stock de medicamentos

4. **Escribe reportes por paciente:**
   - `patientDrugs.csv`
   - `patientLaboratories.csv`
   - `patientProducts.csv`
   - `patientPharmacies.csv`
   - `patientTotals.csv`

5. **Escribe reportes por médico:**
   - `physicianDrugs.csv`
   - `physicianLaboratories.csv`
   - `physicianProducts.csv`
   - `physicianPharmacies.csv`
   - `physicianTotals.csv`

6. **Escribe reportes por farmacia:**
   - `pharmacyDrugs.csv`
   - `pharmacyLaboratories.csv`
   - `pharmacyProducts.csv`
   - `pharmacyTotals.csv`

### PASO 6: Compresión

**Línea:** `await zip(reportBaseDir, ...)`

**Proceso:**
- Usa `zip-a-folder` para comprimir todo el directorio
- Crea: `src/reports/ososs/out/ososs-20251106201612.zip`
- Compresión: `COMPRESSION_LEVEL.high`

---

## Resumen del Flujo Completo

```
1. Carga módulos (define funciones, NO ejecuta)
   ↓
2. Primera analyzeUrls()
   ├─ Getter: Lee URLs (cache/web)
   ├─ Parsers: Convierte a Recipe[]
   ├─ Scorers: Analiza recetas
   │  └─ loadDrugToIcd10() lee 7 archivos CSV
   └─ Retorna: analysisResult con missing
   ↓
3. prepareMissingData()
   ├─ Lee carpetas en feedback/data
   └─ Genera reportes solo para carpetas existentes
   ↓
4. processMissingData() (AI)
   ├─ Parsea missing data
   ├─ Loop de stages con OpenAI
   │  └─ Procesa chunks, llama API, espera respuestas
   ├─ Convierte resultados
   └─ writeOverrides() → Escribe nuevo CSV
   ↓
5. Segunda analyzeUrls()
   ├─ Getter: Lee URLs (cache)
   ├─ Parsers: Convierte a Recipe[]
   ├─ Scorers: Analiza recetas
   │  └─ loadDrugToIcd10() lee 8 archivos CSV (incluye nuevo de AI)
   └─ Retorna: analysisResult con MENOS missing
   ↓
6. writeReport()
   └─ Escribe todos los CSVs finales
   ↓
7. zip()
   └─ Comprime todo en .zip
```

---

## Puntos Clave

1. **Cache de módulos:** Node.js cachea módulos, por eso necesitas lectura dinámica
2. **Dos ejecuciones:** `analyzeUrls()` se ejecuta dos veces (antes y después de AI)
3. **Lectura dinámica:** `loadDrugToIcd10()` se llama en cada ejecución del scorer
4. **Overrides:** Se escriben entre la primera y segunda ejecución
5. **Resultado mejorado:** La segunda ejecución usa los datos de AI y tiene menos missing

