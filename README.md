# Explicación del Flujo Completo: `pnpx tsx src/reports/ososs/index.ts ai s3`

Este documento explica detalladamente qué sucede cuando se ejecuta el comando `pnpx tsx src/reports/ososs/index.ts ai s3`, desde el análisis inicial hasta la subida a S3.

---

## 📋 Tabla de Contenidos

1. [Inicio y Detección de Argumentos](#1-inicio-y-detección-de-argumentos)
2. [Análisis Inicial de URLs](#2-análisis-inicial-de-urls)
3. [Procesamiento con IA (si está habilitado)](#3-procesamiento-con-ia-si-está-habilitado)
4. [Mapeo de Nombres](#4-mapeo-de-nombres)
5. [Procesamiento por Etapas con OpenAI](#5-procesamiento-por-etapas-con-openai)
6. [Guardado de Resultados de IA](#6-guardado-de-resultados-de-ia)
7. [Re-análisis con Datos Enriquecidos](#7-re-análisis-con-datos-enriquecidos)
8. [Generación de Reportes CSV](#8-generación-de-reportes-csv)
9. [Compresión en ZIP](#9-compresión-en-zip)
10. [Subida a S3 (si está habilitado)](#10-subida-a-s3-si-está-habilitado)

---

## 1. Inicio y Detección de Argumentos

**Archivo:** `src/reports/ososs/index.ts`

Cuando se ejecuta el comando, el script comienza leyendo las URLs desde el archivo de entrada:

```typescript
const urls: string[] = readFileLinesSorted(`${import.meta.dirname}/in`);
```

Luego, se llama a `processAnalysis` desde `config.ts`:

```typescript
const analysisResult: AnalysisResult = await processAnalysis(urls, config, 'ososs');
```

**Archivo:** `src/reports/config.ts`

En `config.ts`, se detectan los argumentos del comando:

```typescript
const hasArgument: (pattern: RegExp) => boolean = (pattern: RegExp): boolean =>
  pattern.test(process.argv.slice(2).join(' '));

const shouldUseAI: () => boolean = (): boolean => hasArgument(/\b(?:openai|ai)\b/iv);
const shouldUploadToS3: () => boolean = (): boolean => hasArgument(/\bs3\b/iv);
```

- `process.argv.slice(2)` obtiene los argumentos: `['ai', 's3']`
- `shouldUseAI()` detecta "ai" o "openai" → **true**
- `shouldUploadToS3()` detecta "s3" → **true**

---

## 2. Análisis Inicial de URLs

**Archivo:** `src/reports/config.ts` → `processAnalysis()`

```typescript
let analysisResult: AnalysisResult = await analyzeUrls(urls, config);
```

**Archivo:** `src/analyses/index.ts` → `analyzeUrls()`

Este proceso realiza:

1. **Parseo de URLs:**
   - Lee las URLs desde el archivo `src/reports/ososs/in`
   - Usa `Getter` para obtener las recetas (desde cache o web)
   - Parsea cada URL y extrae la información de las recetas

2. **Ejecución de Scorers:**
   - `runAllScorers()` ejecuta todos los scorers en diferentes etapas (stages)
   - Cada scorer analiza las recetas y genera:
     - **Resultados:** Metadatos y scores para cada receta
     - **Missing:** Datos faltantes que no se pudieron encontrar

3. **Estructura de Missing:**
   ```typescript
   AnyMissing = Map<string, Map<string, unknown[]>>
   // Ejemplo:
   // {
   //   "recipe-id-1": {
   //     "drug--diagnosis": [{drug: "alprazolam", icd10: "I61"}, ...],
   //     "drug--specialty": [{drug: "alprazolam", specialty: "medicina"}, ...],
   //     ...
   //   },
   //   ...
   // }
   ```

4. **Extracción de Datos:**
   - Extrae datos agregados por paciente, farmacia y médico
   - Retorna `AnalysisResult` con:
     - `missing`: Todos los datos faltantes
     - `missingUrls`: URLs que no se pudieron parsear
     - `recipes`: Todas las recetas parseadas
     - `results`: Metadatos agregados

---

## 3. Procesamiento con IA (si está habilitado)

**Archivo:** `src/reports/config.ts` → `processAnalysis()`

Como `shouldUseAI()` retorna `true`, se ejecuta:

```typescript
if (shouldUseAI()) {
  analysisResult = await processMissingWithAI(analysisResult, clientName, urls, config);
}
```

### 3.1. Guardado Temporal de Missing

**Archivo:** `src/reports/config.ts` → `processMissingWithAI()`

```typescript
const tempMissingDir: string = `${import.meta.dirname}/${clientName}/out/.temp-missing-${getISOTimestamp()}`;
mkdirSync(`${tempMissingDir}/missing`, { recursive: true });
writeMissingReport(`${tempMissingDir}/missing`, analysisResult.missing);
```

- Crea un directorio temporal: `src/reports/ososs/out/.temp-missing-20251110005613/`
- `writeMissingReport()` genera archivos CSV por cada tipo de missing:
  - `drugDiagnosis.csv` (64 entradas)
  - `drugSpecialty.csv` (16 entradas)
  - `diagnosisSpecialty.csv` (35 entradas)
  - Y otros tipos que no tienen configuración de IA

**Archivo:** `src/reports/generic/missing/index.ts`

Cada archivo CSV contiene las combinaciones únicas de datos faltantes. Por ejemplo, `drugDiagnosis.csv`:
```csv
"drug";"icd10"
"alprazolam";"I61"
"alprazolam";"I63"
"atorvastatin";"E10"
...
```

---

## 4. Mapeo de Nombres

**Archivo:** `src/reports/config.ts`

Hay tres convenciones de nombres diferentes que necesitan mapearse:

### 4.1. Scorer Name (`drug--diagnosis`)
- Nombre interno usado por los scorers
- Definido en: `src/analyses/recipes/drug-diagnosis/index.ts`
- Usado en: `AnyMissing` para identificar qué scorer generó cada missing

### 4.2. Feedback Name (`drugDiagnosis`)
- Nombre de archivo CSV generado por `writeMissingReport`
- Nombre de carpeta en `src/feedback/data/` donde están los prompts
- Usado por `processAllStages` para leer archivos y buscar configuraciones

### 4.3. Scorer Path (`drug-diagnosis`)
- Nombre de carpeta física donde está el scorer
- Ruta: `src/analyses/recipes/drug-diagnosis/`
- Donde se guardan los archivos `missing/` generados por la IA

**Mapeos:**
```typescript
const scorerNameToFeedbackName: Map<string, string> = new Map([
  ['drug--diagnosis', 'drugDiagnosis'],
  ['drug--specialty', 'drugSpecialty'],
  ['diagnosis--specialty', 'diagnosisSpecialty'],
]);

const scorerNameToScorerPath: Map<string, string> = new Map([
  ['drug--diagnosis', 'drug-diagnosis'],
  ['drug--specialty', 'drug-specialty'],
  ['diagnosis--specialty', 'diagnosis-specialty'],
]);
```

---

## 5. Procesamiento por Etapas con OpenAI

**Archivo:** `src/reports/config.ts` → `processMissingWithAI()`

```typescript
const aiResults: Record<string, Record<string, string>[]> = await processAllStages(
  new OpenAI({ apiKey: getEnv('OPENAI_API_KEY') }),
  tempMissingDir,
  1000,
);
```

**Archivo:** `src/feedback/index.ts` → `processAllStages()`

### 5.1. Etapa Inicial (`initialStage`)

Lee todos los archivos CSV del directorio temporal y busca configuraciones:

```typescript
const initialStage = (reportDirectory) => {
  // Lee: reportDirectory/missing/*.csv
  // Para cada archivo (ej: drugDiagnosis.csv):
  //   1. Busca config en: src/feedback/data/drugDiagnosis/config.json
  //   2. Si existe, lee el CSV y lo convierte a formato interno
  //   3. Retorna: { drugDiagnosis: {...}, drugSpecialty: {...}, ... }
}
```

Solo procesa los tipos que tienen configuración en `src/feedback/data/`.

### 5.2. Procesamiento por Etapas (`processStage`)

Itera por etapas (stage 0, 1, 2, ...) hasta que no haya más etapas:

```typescript
for (let stage = 0; !done; stage++) {
  result = await processStage(openAi, stage, result, sleepMs, witness);
}
```

**Para cada tipo de missing (ej: `drugDiagnosis`):**

1. **Logging inicial:**
   ```
   Processing drugDiagnosis (stage 0) with 64 entries...
   ```

2. **Carga de configuración:**
   - Lee `src/feedback/data/drugDiagnosis/config.json`:
     ```json
     {
       "chunkSize": 10,
       "keySeparator": "|",
       "resultKeys": ["drug", "icd10", "score"]
     }
     ```
   - Lee prompts:
     - `src/feedback/data/drugDiagnosis/0.system.txt`
     - `src/feedback/data/drugDiagnosis/0.user.txt`

3. **División en chunks:**
   - Divide las 64 entradas en chunks de 10 (chunkSize)
   - Genera 7 chunks: `[chunk1, chunk2, ..., chunk7]`

4. **Procesamiento de cada chunk:**
   ```
   Processing chunk 1/7 for drugDiagnosis...
   ```
   
   - Interpola el prompt con los datos del chunk
   - Envía a OpenAI (modelo: `gpt-4o-mini`, temperatura: 0.0)
   - Recibe JSON con resultados:
     ```json
     {
       "alprazolam|I61": "0",
       "alprazolam|I63": "1",
       ...
     }
     ```
   - Valida y parsea la respuesta
   
   ```
   Chunk 1/7 for drugDiagnosis complete
   ```
   
   - Espera 1000ms antes del siguiente chunk (rate limiting)

5. **Siguiente etapa (si existe):**
   - Si hay `1.system.txt` y `1.user.txt`, repite el proceso con los resultados de la etapa anterior
   - Continúa hasta que no haya más etapas

### 5.3. Formato Final

Al final, `processAllStages` convierte los resultados a arrays de objetos:

```typescript
{
  drugDiagnosis: [
    { drug: "alprazolam", icd10: "I61", score: "0" },
    { drug: "alprazolam", icd10: "I63", score: "1" },
    ...
  ],
  drugSpecialty: [...],
  diagnosisSpecialty: [...]
}
```

---

## 6. Guardado de Resultados de IA

**Archivo:** `src/reports/config.ts` → `processMissingWithAI()`

Después de obtener los resultados de la IA, se guardan en las carpetas `missing/` de cada scorer:

```typescript
for (const [scorerName, feedbackName] of scorerNameToFeedbackName.entries()) {
  // scorerName = 'drug--diagnosis'
  // feedbackName = 'drugDiagnosis'
  
  const scorerPath = scorerNameToScorerPath.get(scorerName);
  // scorerPath = 'drug-diagnosis'
  
  const aiResult = aiResults[feedbackName];
  // aiResults['drugDiagnosis'] = [{drug: "...", icd10: "...", score: "..."}, ...]
  
  if (defined(scorerPath) && defined(aiResult) && 0 < aiResult.length) {
    const scorerMissingDir = `${import.meta.dirname}/../analyses/recipes/${scorerPath}/missing`;
    // = src/analyses/recipes/drug-diagnosis/missing
    
    // Convierte array de objetos a CSV
    const headers = Object.keys(aiResult[0]);
    const rows = aiResult.map(record => headers.map(header => record[header]));
    
    // Guarda el archivo
    writeRaw(`${scorerMissingDir}/${getISOTimestamp()}.csv`, rows, headers);
    // = src/analyses/recipes/drug-diagnosis/missing/20251110005613.csv
  }
}
```

**Archivos generados:**
- `src/analyses/recipes/drug-diagnosis/missing/20251110005613.csv`
- `src/analyses/recipes/drug-specialty/missing/20251110005613.csv`
- `src/analyses/recipes/diagnosis-specialty/missing/20251110005613.csv`

---

## 7. Re-análisis con Datos Enriquecidos

**Archivo:** `src/reports/config.ts` → `processMissingWithAI()`

```typescript
// Re-run analysis with enriched data
return await analyzeUrls(urls, config);
```

Se ejecuta `analyzeUrls` nuevamente, pero esta vez:

### 7.1. Scorers Modificados

Los scorers fueron modificados para leer archivos `missing/` en tiempo de ejecución:

**Archivo:** `src/analyses/recipes/drug-diagnosis/index.ts`

```typescript
const loadDrugToIcd10 = () => {
  // Lee TODOS los archivos de src/analyses/recipes/drug-diagnosis/missing/
  // Incluyendo el nuevo archivo generado por la IA
  return new Map(...readFilesSorted(`${import.meta.dirname}/missing`)...);
};

const scorer = (recipes) => {
  // Se recarga cada vez que se ejecuta el scorer
  const drugToIcd10Runtime = loadDrugToIcd10();
  
  // Usa los datos enriquecidos para evaluar las recetas
  // Si encuentra una combinación drug+icd10 en los archivos missing,
  // ya no la marca como "missing"
}
```

### 7.2. Resultado del Re-análisis

El nuevo `AnalysisResult` tiene:
- **Menos missing:** Los datos generados por la IA ahora están disponibles
- **Más resultados:** Más recetas tienen scores completos
- **Misma estructura:** Pero con datos más completos

---

## 8. Generación de Reportes CSV

**Archivo:** `src/reports/ososs/index.ts`

Con el `analysisResult` enriquecido, se generan todos los reportes CSV:

### 8.1. Reportes de Missing

```typescript
writeRaw(`${reportBaseDir}/missing/urls.csv`, ...);
writeRaw(`${reportBaseDir}/missing/diagnoses.csv`, ...);
writeMissingReport(`${reportBaseDir}/missing`, analysisResult.missing);
```

### 8.2. Reportes Principales

```typescript
writeRaw(`${reportBaseDir}/recipes.csv`, ...);
writeRaw(`${reportBaseDir}/billing.csv`, ...);
writeRaw(`${reportBaseDir}/stock.csv`, ...);
```

### 8.3. Reportes por Entidad

- **Pacientes:** `patientDrugs.csv`, `patientLaboratories.csv`, `patientProducts.csv`, `patientPharmacies.csv`, `patientTotals.csv`
- **Médicos:** `physicianDrugs.csv`, `physicianLaboratories.csv`, `physicianProducts.csv`, `physicianPharmacies.csv`, `physicianTotals.csv`
- **Farmacias:** `pharmacyDrugs.csv`, `pharmacyLaboratories.csv`, `pharmacyProducts.csv`, `pharmacyPharmacies.csv`, `pharmacyTotals.csv`

**Directorio generado:**
```
src/reports/ososs/out/20251110005617/
├── missing/
│   ├── urls.csv
│   ├── diagnoses.csv
│   ├── drugDiagnosis.csv
│   └── ...
├── recipes.csv
├── billing.csv
├── stock.csv
├── patientDrugs.csv
└── ... (17 archivos CSV en total)
```

---

## 9. Compresión en ZIP

**Archivo:** `src/reports/ososs/index.ts`

```typescript
await zip(
  reportBaseDir,
  `${import.meta.dirname}/out/ososs-${timestamp}.zip`,
  { compression: COMPRESSION_LEVEL.high }
);
```

- Comprime todo el directorio `20251110005617/` en un archivo ZIP
- Archivo generado: `src/reports/ososs/out/ososs-20251110005617.zip`

---

## 10. Subida a S3 (si está habilitado)

**Archivo:** `src/reports/ososs/index.ts`

Como `shouldUploadToS3()` retorna `true`, se ejecuta:

```typescript
if (shouldUploadToS3()) {
  await uploadReportToS3(reportBaseDir, 'ososs');
}
```

**Archivo:** `src/reports/config.ts` → `uploadReportToS3()`

```typescript
const s3Client: S3Client = defaultS3Client();
const s3Prefix: string = getEnv('AWS_S3_BUCKET_NAME').replaceAll(/\/+$/gv, '');

await Promise.all([
  uploadToS3(
    s3Client,
    `${s3Prefix}/billing--ososs.csv`,
    readFileSync(`${reportBaseDir}/billing.csv`)
  ),
  uploadToS3(
    s3Client,
    `${s3Prefix}/recipes--ososs.csv`,
    readFileSync(`${reportBaseDir}/recipes.csv`)
  ),
]);
```

**Proceso:**
1. Crea cliente S3 con credenciales de las variables de entorno
2. Lee `billing.csv` y `recipes.csv` del directorio del reporte
3. Sube ambos archivos a S3 en paralelo:
   - `s3://bucket-name/billing--ososs.csv`
   - `s3://bucket-name/recipes--ososs.csv`

---

## 📊 Resumen del Flujo Completo

```
1. Ejecución: pnpx tsx src/reports/ososs/index.ts ai s3
   ↓
2. Detección de argumentos: ai=true, s3=true
   ↓
3. Análisis inicial: analyzeUrls() → identifica missing
   ↓
4. Procesamiento con IA:
   ├─ Guarda missing en directorio temporal
   ├─ processAllStages() procesa con OpenAI
   ├─ Guarda resultados en carpetas missing/ de scorers
   └─ Re-ejecuta analyzeUrls() con datos enriquecidos
   ↓
5. Generación de reportes CSV (17 archivos)
   ↓
6. Compresión en ZIP
   ↓
7. Subida a S3 (billing.csv y recipes.csv)
   ↓
8. ✅ Proceso completo
```

---

## 🔑 Puntos Clave

1. **Mapeo de nombres:** Conecta tres convenciones diferentes (scorer name, feedback name, scorer path)
2. **Lectura en tiempo de ejecución:** Los scorers recargan archivos `missing/` cada vez que se ejecutan
3. **Procesamiento por etapas:** La IA puede procesar en múltiples etapas si hay configuraciones adicionales
4. **Chunking:** Los datos se dividen en chunks para evitar límites de tokens de OpenAI
5. **Rate limiting:** Espera 1 segundo entre chunks para evitar exceder límites de API
6. **Subida selectiva:** Solo se suben `billing.csv` y `recipes.csv` a S3, no todos los archivos

---

## 📝 Notas Adicionales

- Si un scorer no tiene configuración de IA, simplemente se omite del procesamiento
- Los errores de OpenAI se capturan y registran, pero no detienen el proceso completo

---

## 🗂️ Gestión de Archivos: Temporales y Acumulativos

### Archivos Temporales (`.temp-missing-*`)

**Ubicación:** `src/reports/ososs/out/.temp-missing-20251110005613/`

**¿Qué son?**
Estos directorios se crean temporalmente para almacenar los missing antes de procesarlos con IA. Contienen los archivos CSV generados por `writeMissingReport()` que luego son leídos por `processAllStages()`.

**¿Se borran automáticamente?**
**NO.** Actualmente el código no elimina estos directorios después del procesamiento. Son "temporales" en el sentido de que:
- Solo se usan durante el procesamiento con IA
- No son parte del reporte final
- Se pueden eliminar manualmente sin afectar el funcionamiento

**¿Por qué no se borran automáticamente?**
- Permiten debugging: puedes revisar qué missing se enviaron a la IA
- Permiten re-procesamiento: si hay un error, puedes reutilizar los mismos datos
- No ocupan mucho espacio (solo CSVs de texto)

**Recomendación:**
Si quieres limpiarlos automáticamente, podrías agregar al final de `processMissingWithAI()`:
```typescript
import { rmSync } from 'node:fs';
// ... después de guardar los resultados
rmSync(tempMissingDir, { recursive: true, force: true });
```

### Archivos en `missing/` de los Scorers

**Ubicación:** `src/analyses/recipes/drug-diagnosis/missing/20251110005613.csv`

**¿Qué son?**
Estos son los archivos generados por la IA que contienen los datos enriquecidos. Se guardan en las carpetas `missing/` de cada scorer para que sean leídos en futuros análisis.

**¿Se acumulan?**
**SÍ.** Cada vez que se ejecuta el procesamiento con IA, se crea un nuevo archivo con un timestamp único:
- `20251110005613.csv` (primera ejecución)
- `20251110005704.csv` (segunda ejecución)
- `20251110005815.csv` (tercera ejecución)
- ...

**¿Por qué se acumulan?**
1. **Historial:** Permite ver qué datos se generaron en cada ejecución
2. **No sobrescribir:** Si un archivo tiene datos buenos, no se pierden con una nueva ejecución
3. **Lectura acumulativa:** Los scorers leen TODOS los archivos en `missing/`, así que:
   - Datos antiguos + Datos nuevos = Base de conocimiento más completa
   - Cada ejecución agrega conocimiento sin perder el anterior

**¿Está bien este funcionamiento?**
**SÍ, es el comportamiento deseado.** Razones:

1. **Base de conocimiento creciente:**
   ```
   Primera ejecución: 10 combinaciones drug+icd10
   Segunda ejecución: +5 nuevas combinaciones
   Tercera ejecución: +3 nuevas combinaciones
   Total disponible: 18 combinaciones
   ```

2. **Los scorers leen todos los archivos:**
   ```typescript
   // En drug-diagnosis/index.ts
   ...readFilesSorted(`${import.meta.dirname}/missing`).map(...)
   // Lee TODOS los CSV en la carpeta missing/
   ```

3. **Ventajas:**
   - Cada ejecución mejora la base de conocimiento
   - No se pierden datos validados anteriormente
   - Permite revisar el historial de generaciones

**Consideraciones:**
- Los archivos se acumulan indefinidamente
- Si hay muchos archivos, el tiempo de lectura puede aumentar ligeramente
- Si necesitas limpiar archivos antiguos, puedes hacerlo manualmente o agregar una lógica de rotación

**Ejemplo de acumulación:**
```
src/analyses/recipes/drug-diagnosis/missing/
├── 20250721000000.csv  (archivo manual anterior)
├── 20250722152600.csv  (archivo manual anterior)
├── 20250918000000.csv  (archivo manual anterior)
├── 20251110005613.csv  (generado por IA - ejecución 1)
├── 20251110005704.csv  (generado por IA - ejecución 2)
└── 20251110005815.csv  (generado por IA - ejecución 3)
```

Todos estos archivos se leen y se combinan cuando el scorer se ejecuta.

