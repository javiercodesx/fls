# Análisis del Sistema de Detección de Fraude Farmacéutico

## Tabla de Contenidos

1. [Introducción](#introducción)
2. [Lógica General del Sistema](#lógica-general-del-sistema)
3. [Conceptos Clave](#conceptos-clave)
4. [Por Qué Matchear Drogas con Códigos ICD, Componentes, etc.](#por-qué-matchear-drogas-con-códigos-icd-componentes-etc)
5. [Análisis Detallado: `rcta-to-specialty/index.ts`](#análisis-detallado-rcta-to-specialtyindexts)
6. [Flujo Completo del Sistema](#flujo-completo-del-sistema)
7. [Ejemplos Prácticos](#ejemplos-prácticos)

---

## Introducción

Este documento explica la lógica y funcionamiento del sistema de detección de fraude farmacéutico, enfocándose en:

1. **Por qué** se realizan matcheos entre drogas, códigos ICD-10, especialidades médicas, componentes, etc.
2. **Cómo** funciona específicamente el archivo `rcta-to-specialty/index.ts`
3. **Qué** problemas de fraude se detectan con estos matcheos

---

## Lógica General del Sistema

### El Problema de Fraude Farmacéutico

En el sistema de salud, especialmente en obras sociales y prepagas, existen múltiples formas de fraude relacionadas con recetas médicas:

#### Tipos de Fraude Detectados

1. **Medicamentos prescritos sin diagnóstico válido**
   - Un médico prescribe un medicamento sin un diagnóstico que lo justifique
   - Ejemplo: Prescribir insulina sin diagnóstico de diabetes

2. **Medicamentos prescritos por especialistas incorrectos**
   - Un médico de una especialidad prescribe medicamentos que típicamente maneja otra especialidad
   - Ejemplo: Un pediatra prescribiendo medicamentos de cardiología para adultos

3. **Interacciones peligrosas entre medicamentos**
   - Combinaciones de medicamentos que pueden causar efectos adversos graves
   - Ejemplo: Anticoagulantes con antiinflamatorios no esteroideos

4. **Dosificaciones incorrectas**
   - Medicamentos prescritos con dosis que no corresponden a la presentación disponible
   - Ejemplo: Prescribir 500mg cuando solo existe presentación de 250mg

5. **Precios incorrectos o inflados**
   - Medicamentos dispensados a precios que no corresponden
   - Ejemplo: Cobrar precio de marca cuando se dispensó genérico

6. **Medicamentos sin diagnóstico respaldatorio**
   - Medicamentos prescritos sin ningún diagnóstico asociado en la receta

### Objetivo del Sistema

El sistema analiza recetas médicas y asigna un **score de sospecha** basado en múltiples validaciones. Cuanto mayor el score, más probable es que haya fraude o error.

---

## Conceptos Clave

Para entender el sistema, es fundamental conocer estos conceptos:

### 1. RCTA (Registro de Códigos Terapéuticos Argentinos)

**¿Qué es?**
- Código único que identifica un medicamento o combinación de medicamentos en Argentina
- Es el identificador estándar usado en el sistema de salud argentino

**Ejemplos:**
- `PARACETAMOL` - Medicamento simple
- `PARACETAMOL+CODEINA` - Medicamento compuesto (combinación)
- `METFORMINA` - Otro medicamento simple

**Características:**
- Puede ser **simple** (un solo medicamento) o **compuesto** (varios medicamentos separados por `+`)
- Se normaliza y limpia para evitar variaciones (mayúsculas/minúsculas, acentos, espacios, etc.)

**Uso en el sistema:**
- Se usa como clave para buscar información sobre el medicamento
- Permite matchear medicamentos con diagnósticos, especialidades, precios, etc.

### 2. ICD-10 (Clasificación Internacional de Enfermedades, 10ª Revisión)

**¿Qué es?**
- Sistema de codificación estándar internacional para diagnósticos médicos
- Cada código representa una enfermedad, condición o síntoma específico

**Ejemplos:**
- `E11` - Diabetes mellitus tipo 2
- `I10` - Hipertensión esencial (primaria)
- `J44` - Otra enfermedad pulmonar obstructiva crónica
- `K59.0` - Estreñimiento

**Estructura:**
- Código alfanumérico (letra + números)
- Puede tener subcategorías (ej: `K59.0`)
- Los primeros 3 caracteres suelen ser suficientes para la mayoría de validaciones

**Uso en el sistema:**
- Permite validar si un medicamento es apropiado para un diagnóstico
- Ejemplo: Si hay diagnóstico `E11` (diabetes), se espera que los medicamentos sean para diabetes (insulina, metformina, etc.)

### 3. Especialidad Médica

**¿Qué es?**
- Área de especialización de un médico
- Indica en qué campo de la medicina se especializa el profesional

**Ejemplos:**
- `CARDIOLOGIA` - Especialista en corazón y sistema circulatorio
- `ENDOCRINOLOGIA` - Especialista en hormonas y metabolismo
- `PEDIATRIA` - Especialista en niños
- `CLINICA_MEDICA` - Médico clínico general
- `TRAUMATOLOGIA` - Especialista en huesos y articulaciones

**Uso en el sistema:**
- Permite validar si un médico de cierta especialidad suele prescribir ciertos medicamentos
- Ejemplo: Un cardiólogo prescribiendo insulina (medicamento de endocrinología) es sospechoso

### 4. ATC (Anatomical Therapeutic Chemical Classification System)

**¿Qué es?**
- Sistema de clasificación de medicamentos desarrollado por la OMS
- Clasifica medicamentos por:
  - **A**nátomo (sistema del cuerpo)
  - **T**erapéutico (uso terapéutico)
  - **C**hemical (grupo químico)

**Ejemplos:**
- `A10BA02` - Metformina (para diabetes)
  - `A10` = Medicamentos para diabetes
  - `A10B` = Medicamentos hipoglucemiantes
  - `A10BA` = Biguanidas
  - `A10BA02` = Metformina específicamente

**Uso en el sistema:**
- Facilita el mapeo entre medicamentos y diagnósticos
- Permite encontrar relaciones indirectas: Medicamento → ATC → ICD-10

### 5. Componentes / Principios Activos

**¿Qué es?**
- El ingrediente activo real de un medicamento
- Los nombres comerciales pueden variar, pero el principio activo es el mismo

**Ejemplos:**
- Nombre comercial: `DOLAC`, `TYLENOL`, `PANADOL`
- Principio activo: `PARACETAMOL`

**Uso en el sistema:**
- Normaliza diferentes nombres comerciales al mismo principio activo
- Permite comparar medicamentos que son equivalentes pero tienen nombres diferentes

---

## Por Qué Matchear Drogas con Códigos ICD, Componentes, etc.

### Matcheo: Droga ↔ ICD-10 (Diagnóstico)

#### Objetivo
Detectar si un medicamento prescrito es apropiado para el diagnóstico del paciente.

#### ¿Por qué es importante?
Un medicamento debe estar relacionado con el diagnóstico del paciente. Si no hay relación, puede ser:
- **Error médico**: El médico se equivocó
- **Fraude**: Se está prescribiendo un medicamento innecesario para generar facturación

#### Cómo funciona
1. Se tiene un mapeo: `Droga → [ICD-10 válidos]`
2. Cuando se analiza una receta:
   - Se extrae el medicamento prescrito
   - Se extraen los diagnósticos (ICD-10) del paciente
   - Se verifica si el medicamento está en la lista de medicamentos válidos para esos diagnósticos

#### Categorías de Resultado
- **Categoría 0**: Combinación medicamento/diagnóstico no requiere revisión (válida)
- **Categoría 1**: Combinación medicamento/diagnóstico requiere revisión (sospechosa)
- **Categoría 2**: Medicación sin diagnóstico respaldatorio (muy sospechosa)

#### Ejemplo Práctico
```
Receta:
- Medicamento: INSULINA
- Diagnóstico: E11 (Diabetes tipo 2)

Análisis:
- INSULINA está en la lista de medicamentos válidos para E11
- Resultado: Categoría 0 (válido)
```

```
Receta:
- Medicamento: INSULINA
- Diagnóstico: I10 (Hipertensión)

Análisis:
- INSULINA NO está en la lista de medicamentos válidos para I10
- Resultado: Categoría 2 (muy sospechoso - requiere revisión)
```

### Matcheo: Droga ↔ Especialidad

#### Objetivo
Detectar si un médico de cierta especialidad suele prescribir ciertos medicamentos.

#### ¿Por qué es importante?
Cada especialidad médica tiene medicamentos que maneja frecuentemente. Si un médico de una especialidad prescribe medicamentos de otra, puede ser:
- **Legítimo**: Casos especiales o interconsultas
- **Sospechoso**: El médico no tiene la especialización adecuada o hay fraude

#### Cómo funciona
1. Se tiene un mapeo: `Droga → Especialidad → Score (1-5)`
2. Cuando se analiza una receta:
   - Se extrae la especialidad del médico
   - Se extrae el medicamento prescrito
   - Se consulta el score en el mapeo
   - Score alto (4-5) = sospechoso

#### Sistema de Scoring
- **Score 1**: Combinación irrelevante (no hay relación clara)
- **Score 2**: Combinación frecuente (especialidad suele prescribir este medicamento)
- **Score 3**: Combinación poco frecuente (puede ser legítimo pero poco común)
- **Score 4**: Combinación especialidad/medicamento - revisión recomendada
- **Score 5**: Combinación especialidad/medicamento - requiere revisión (muy sospechoso)

#### Ejemplo Práctico
```
Receta:
- Médico: Especialista en CARDIOLOGIA
- Medicamento: ATENOLOL (medicamento para hipertensión/cardíaco)

Análisis:
- ATENOLOL + CARDIOLOGIA tiene score 2 (frecuente)
- Resultado: Válido
```

```
Receta:
- Médico: Especialista en PEDIATRIA
- Medicamento: WARFARINA (anticoagulante, típico de cardiología/hepatología)

Análisis:
- WARFARINA + PEDIATRIA tiene score 5 (muy sospechoso)
- Resultado: Requiere revisión urgente
```

### Matcheo: Droga ↔ Droga (Interacciones)

#### Objetivo
Detectar interacciones peligrosas entre medicamentos prescritos en la misma receta.

#### ¿Por qué es importante?
Algunas combinaciones de medicamentos pueden ser peligrosas o incluso mortales. Ejemplos:
- Anticoagulantes + antiinflamatorios = riesgo de sangrado
- Ciertos antibióticos + alcohol = efectos tóxicos

#### Cómo funciona
1. Se tiene un mapeo: `Droga A → Droga B → Tipo de interacción`
2. Cuando se analiza una receta:
   - Se extraen todos los medicamentos
   - Se verifica si hay interacciones conocidas entre ellos
   - Se marca como sospechoso si hay interacciones peligrosas

#### Ejemplo Práctico
```
Receta:
- Medicamento 1: WARFARINA (anticoagulante)
- Medicamento 2: IBUPROFENO (antiinflamatorio)

Análisis:
- WARFARINA + IBUPROFENO tiene interacción peligrosa (riesgo de sangrado)
- Resultado: Muy sospechoso - requiere revisión médica
```

### Matcheo: Componentes / Normalización de Nombres

#### Objetivo
Normalizar diferentes nombres comerciales al mismo principio activo.

#### ¿Por qué es importante?
Un mismo medicamento puede tener múltiples nombres comerciales:
- `DOLAC` = `PARACETAMOL`
- `TYLENOL` = `PARACETAMOL`
- `PANADOL` = `PARACETAMOL`

Sin normalización, el sistema no podría reconocer que son el mismo medicamento.

#### Cómo funciona
1. Se tiene un mapeo: `Nombre Comercial → Principio Activo (RCTA)`
2. Cuando se analiza una receta:
   - Se normaliza el nombre comercial al RCTA
   - Se usa el RCTA para todas las validaciones

#### Ejemplo Práctico
```
Receta:
- Medicamento prescrito: "DOLAC 500mg"
- Diagnóstico: E11 (Diabetes)

Análisis:
1. "DOLAC" se normaliza a "PARACETAMOL"
2. Se verifica si PARACETAMOL es válido para E11
3. PARACETAMOL no es típico para diabetes
4. Resultado: Sospechoso
```

### Matcheo: Droga ↔ Precio

#### Objetivo
Detectar si el precio de un medicamento es razonable.

#### ¿Por qué es importante?
Puede haber fraude por:
- Precios inflados
- Cobrar precio de marca cuando se dispensó genérico
- Precios que no corresponden a la presentación

#### Cómo funciona
1. Se tiene un mapeo: `Droga + Presentación → Precio esperado`
2. Cuando se analiza una receta:
   - Se compara el precio dispensado con el precio esperado
   - Si hay gran diferencia, se marca como sospechoso

### Matcheo: Droga ↔ Dosificación / Unidades

#### Objetivo
Detectar si la dosificación prescrita corresponde a las presentaciones disponibles.

#### ¿Por qué es importante?
Puede haber errores o fraudes por:
- Prescribir dosis que no existen en el mercado
- Prescribir más unidades de las necesarias
- Inconsistencias entre lo prescrito y lo dispensado

---

## Análisis Detallado: `rcta-to-specialty/index.ts`

### Propósito del Archivo

Este archivo genera un **mapeo de códigos RCTA a especialidades médicas** con un sistema de scoring (1-5) que indica qué tan común es que una especialidad prescriba cierto medicamento.

**Input:**
- Lista de códigos RCTA limpios/normalizados
- Datos de especialidades y medicamentos de OSOSS (obra social)

**Output:**
- Archivo JSON: `rcta-to-specialty.json`
- Estructura: `{ "RCTA": { "ESPECIALIDAD": score } }`

**Uso posterior:**
- Este JSON es consumido por el analizador `drug-specialty` para validar recetas

### Código Paso a Paso

#### Paso 1: Función de Conversión de Score

```typescript
const scoreToInt: (score: string) => number = (score: string): number => {
  return (
    {
      A: 1,
      B: 2,
      C: 3,
      D: 4,
      E: 5,
    }[score] ?? 0
  );
};
```

**¿Qué hace?**
- Convierte un score en letra (A, B, C, D, E) a número (1, 2, 3, 4, 5)
- A = 1 (más común/irrelevante)
- E = 5 (muy sospechoso/requiere revisión)
- Si no encuentra la letra, retorna 0

**Ejemplo:**
- Input: `"B"` → Output: `2`
- Input: `"E"` → Output: `5`

#### Paso 2: Cargar Datos de Especialidades y Medicamentos

```typescript
const drugNameToSpecialtyToScore: Map<string, Map<string, number>> = new Map();
for (const [specialty, drugName, , score] of readRaw(
  `${import.meta.dirname}/../../datasources/specialty-medications-ososs/out/specialty-medications-ososs.csv`,
) as [string, string, string, string, string, string, string, string, string][]) {
  drugNameToSpecialtyToScore.set(
    drugName,
    (drugNameToSpecialtyToScore.get(drugName) ?? new Map<string, number>()).set(specialty, scoreToInt(score)),
  );
}
```

**¿Qué hace?**
1. Lee un archivo CSV con datos de especialidades y medicamentos
2. Estructura del CSV: `[especialidad, nombreDroga, ..., score]`
3. Construye un mapa anidado: `droga → especialidad → score`

**Estructura resultante:**
```typescript
Map {
  "PARACETAMOL" => Map {
    "PEDIATRIA" => 2,
    "CLINICA_MEDICA" => 1,
    "TRAUMATOLOGIA" => 2
  },
  "INSULINA" => Map {
    "ENDOCRINOLOGIA" => 1,
    "CLINICA_MEDICA" => 2
  }
}
```

**Ejemplo de datos del CSV:**
```
PEDIATRIA,PARACETAMOL,...,B
CLINICA_MEDICA,PARACETAMOL,...,A
ENDOCRINOLOGIA,INSULINA,...,A
```

#### Paso 3: Extraer Lista de Especialidades

```typescript
const specialties: Set<string> = new Set<string>(
  Array.from(drugNameToSpecialtyToScore.values()).flatMap((specialtyToScore: Map<string, number>): string[] =>
    Array.from(specialtyToScore.keys()),
  ),
);
```

**¿Qué hace?**
- Extrae todas las especialidades únicas del mapa anterior
- Crea un Set para evitar duplicados

**Resultado:**
```typescript
Set {
  "PEDIATRIA",
  "CLINICA_MEDICA",
  "ENDOCRINOLOGIA",
  "CARDIOLOGIA",
  ...
}
```

#### Paso 4: Cargar Códigos RCTA Limpios

```typescript
const cleanRcta: Set<string> = new Set<string>(
  readStringPairsAsMap(`${import.meta.dirname}/../rcta/out/rcta-composed-to-rcta-composed-clean.csv`).values(),
).difference(new Set<string>(['']));
```

**¿Qué hace?**
1. Lee un archivo CSV que mapea RCTA compuestos a RCTA compuestos limpios
2. Extrae todos los valores (los RCTA limpios)
3. Filtra valores vacíos

**Ejemplo del CSV:**
```
RCTA_ORIGINAL,RCTA_LIMPIO
paracetamol+codeina,PARACETAMOL+CODEINA
ibuprofeno 600,IBUPROFENO
```

**Resultado:**
```typescript
Set {
  "PARACETAMOL+CODEINA",
  "IBUPROFENO",
  "METFORMINA",
  ...
}
```

#### Paso 5: Mapear Cada RCTA a Especialidades

```typescript
const rctaToSpecialty: Map<string, Map<string, number>> = new Map<string, Map<string, number>>();

for (const rcta of cleanRcta) {
  for (const specialty of specialties) {
    let score: number | undefined = drugNameToSpecialtyToScore.get(rcta)?.get(specialty);
    // ... lógica de cálculo de score ...
  }
}
```

**¿Qué hace?**
- Para cada RCTA y cada especialidad, busca un score
- Si no encuentra score directo, intenta otras estrategias (ver siguiente paso)

#### Paso 6: Manejo de RCTA Compuestos (con `+`)

```typescript
if (!defined(score)) {
  score = Math.min(
    ...rcta
      .split('+')
      .map((rctaPart: string): number | undefined => drugNameToSpecialtyToScore.get(rctaPart)?.get(specialty))
      .filter(defined),
  );
  if (Infinity === score) {
    score = undefined;
  }
}
```

**¿Qué hace?**
1. Si no encuentra score directo para el RCTA completo
2. Y el RCTA es compuesto (contiene `+`), lo separa en partes
3. Busca score para cada parte individual
4. Toma el **mínimo** (más restrictivo/conservador)
5. Si no encuentra ningún score (resultado es `Infinity`), deja `undefined`

**Ejemplo:**
```
RCTA: "PARACETAMOL+CODEINA"
Especialidad: "PEDIATRIA"

1. Busca score para "PARACETAMOL+CODEINA" completo → No existe
2. Separa: ["PARACETAMOL", "CODEINA"]
3. Busca:
   - "PARACETAMOL" + "PEDIATRIA" → score 2
   - "CODEINA" + "PEDIATRIA" → score 3
4. Toma mínimo: min(2, 3) = 2
5. Resultado: score = 2
```

**¿Por qué el mínimo?**
- Si una parte del medicamento compuesto es muy sospechosa (score alto), toda la combinación debe ser sospechosa
- Es más conservador y seguro para detectar fraudes

#### Paso 7: Guardar Resultado Final

```typescript
rctaToSpecialty.set(rcta, (rctaToSpecialty.get(rcta) ?? new Map<string, number>()).set(specialty, score ?? 0));
```

**¿Qué hace?**
- Guarda el score calculado en el mapa final
- Si no hay score, usa 0 (desconocido)

#### Paso 8: Escribir Archivo JSON

```typescript
writeFileSync(
  `${import.meta.dirname}/out/rcta-to-specialty.json`,
  StrictJSON.stringify(
    normalizeJSONLike(
      Object.fromEntries(
        Array.from(
          rctaToSpecialty.entries(),
          ([rcta, specialtyToScore]: [string, Map<string, number>]): [string, { [_: string]: number }] => [
            rcta,
            Object.fromEntries(specialtyToScore.entries()),
          ],
        ),
      ),
    ),
    undefined,
    2,
  ),
  { encoding: 'utf-8', flush: true },
);
```

**¿Qué hace?**
1. Convierte el Map anidado a un objeto JSON
2. Normaliza el JSON (formato consistente)
3. Escribe el archivo con indentación de 2 espacios

**Estructura del JSON resultante:**
```json
{
  "PARACETAMOL": {
    "PEDIATRIA": 2,
    "CLINICA_MEDICA": 1,
    "TRAUMATOLOGIA": 2
  },
  "PARACETAMOL+CODEINA": {
    "PEDIATRIA": 2,
    "CLINICA_MEDICA": 1,
    "TRAUMATOLOGIA": 2
  },
  "INSULINA": {
    "ENDOCRINOLOGIA": 1,
    "CLINICA_MEDICA": 2
  }
}
```

### Ejemplo Completo de Ejecución

#### Input

**Archivo `specialty-medications-ososs.csv`:**
```csv
PEDIATRIA,PARACETAMOL,col3,col4,B
CLINICA_MEDICA,PARACETAMOL,col3,col4,A
PEDIATRIA,CODEINA,col3,col4,C
CLINICA_MEDICA,CODEINA,col3,col4,B
ENDOCRINOLOGIA,INSULINA,col3,col4,A
```

**Archivo `rcta-composed-to-rcta-composed-clean.csv`:**
```csv
original,clean
paracetamol,PARACETAMOL
codeina,CODEINA
paracetamol+codeina,PARACETAMOL+CODEINA
insulina,INSULINA
```

#### Procesamiento

1. **Carga de datos de especialidades:**
   ```typescript
   drugNameToSpecialtyToScore = Map {
    "PARACETAMOL" => Map {
      "PEDIATRIA" => 2,
      "CLINICA_MEDICA" => 1
    },
    "CODEINA" => Map {
      "PEDIATRIA" => 3,
      "CLINICA_MEDICA" => 2
    },
    "INSULINA" => Map {
      "ENDOCRINOLOGIA" => 1
    }
  }
  ```

2. **RCTA limpios:**
   ```typescript
   cleanRcta = Set {
     "PARACETAMOL",
     "CODEINA",
     "PARACETAMOL+CODEINA",
     "INSULINA"
   }
   ```

3. **Especialidades:**
   ```typescript
   specialties = Set {
     "PEDIATRIA",
     "CLINICA_MEDICA",
     "ENDOCRINOLOGIA"
   }
   ```

4. **Mapeo para "PARACETAMOL":**
   - `PEDIATRIA`: Score directo = 2 ✓
   - `CLINICA_MEDICA`: Score directo = 1 ✓
   - `ENDOCRINOLOGIA`: No hay score → 0

5. **Mapeo para "PARACETAMOL+CODEINA":**
   - `PEDIATRIA`: 
     - No hay score directo
     - Separa: ["PARACETAMOL", "CODEINA"]
     - PARACETAMOL + PEDIATRIA = 2
     - CODEINA + PEDIATRIA = 3
     - Mínimo = 2 ✓
   - `CLINICA_MEDICA`:
     - No hay score directo
     - Separa: ["PARACETAMOL", "CODEINA"]
     - PARACETAMOL + CLINICA_MEDICA = 1
     - CODEINA + CLINICA_MEDICA = 2
     - Mínimo = 1 ✓

#### Output

**Archivo `rcta-to-specialty.json`:**
```json
{
  "PARACETAMOL": {
    "PEDIATRIA": 2,
    "CLINICA_MEDICA": 1,
    "ENDOCRINOLOGIA": 0
  },
  "CODEINA": {
    "PEDIATRIA": 3,
    "CLINICA_MEDICA": 2,
    "ENDOCRINOLOGIA": 0
  },
  "PARACETAMOL+CODEINA": {
    "PEDIATRIA": 2,
    "CLINICA_MEDICA": 1,
    "ENDOCRINOLOGIA": 0
  },
  "INSULINA": {
    "PEDIATRIA": 0,
    "CLINICA_MEDICA": 0,
    "ENDOCRINOLOGIA": 1
  }
}
```

### Uso Posterior del Archivo Generado

Este JSON es consumido por el analizador `drug-specialty` (`src/analyses/recipes/drug-specialty/index.ts`):

1. **Cuando se analiza una receta:**
   - Se extrae la especialidad del médico
   - Se extrae el RCTA del medicamento prescrito
   - Se consulta el score en `rcta-to-specialty.json`

2. **Decisión:**
   - Score 1-2: Válido (común)
   - Score 3: Revisar (poco común pero puede ser legítimo)
   - Score 4-5: Sospechoso (requiere revisión)

3. **Ejemplo de uso:**
   ```typescript
   // En drug-specialty/index.ts
   const specialty = recipe.physician.professional.license.specialty; // "PEDIATRIA"
   const drug = recipe.medical.medicine[0].drug.name; // "PARACETAMOL+CODEINA"
   
   const score = rctaToSpecialty.get(drug)?.get(specialty); // 2
   
   if (score >= 4) {
     // Marcar como sospechoso
   }
   ```

---

## Flujo Completo del Sistema

### 1. Entrada: Recetas Médicas

Las recetas pueden venir de diferentes fuentes:
- **OSPSA**: Obra Social de Personal de la Actividad
- **MisRX**: Sistema de recetas electrónicas
- **RCTA**: API de códigos terapéuticos

Cada receta contiene:
- Información del paciente (edad, sexo, diagnóstico)
- Información del médico (especialidad, matrícula)
- Medicamentos prescritos (nombre, dosis, cantidad)
- Información de dispensación (farmacia, precio, fecha)

### 2. Parsing: Conversión a Estructura Unificada

Los parsers (`OspsaParser`, `MisRXParser`, `RctaParser`) convierten las recetas a una estructura común `Recipe`:

```typescript
type Recipe = {
  patient: PatientInformation;
  physician: PhysicianInformation;
  medical: MedicalInformation;
  dispensing: DispensingInformation;
  // ...
};
```

### 3. Normalización

- Nombres de medicamentos se normalizan a RCTA
- Diagnósticos se normalizan a ICD-10
- Especialidades se normalizan a formato estándar

### 4. Análisis con Múltiples Scorers

El sistema ejecuta múltiples analizadores en etapas:

#### Etapa 1: Validaciones Básicas
- `drug-diagnosis`: ¿Medicamento corresponde al diagnóstico?
- `drug-specialty`: ¿Especialidad suele prescribir este medicamento?
- `drug-drug`: ¿Hay interacciones peligrosas?
- `drug-price`: ¿El precio es razonable?
- `drug-units`: ¿Las unidades son correctas?
- Y más...

#### Etapa 2: Validaciones de Consistencia
- `dispense-match-prescribed-price`: ¿Precio dispensado = precio prescrito?
- `dispense-match-prescribed-dosage`: ¿Dosificación dispensada = dosificación prescrita?

#### Etapa 3: Detección de Patrones Sospechosos (Prescripción)
- `suspicion-prescribed`: Detecta patrones anómalos en la prescripción

#### Etapa 4: Detección de Patrones Sospechosos (Dispensación)
- `suspicion-dispensed`: Detecta patrones anómalos en la dispensación

### 5. Resultados

Cada receta recibe:
- **Score general**: Número que indica nivel de sospecha
- **Metadatos**: Detalles de cada validación
- **Missing data**: Información faltante que impidió validaciones

### 6. Reportes

Se generan reportes por:
- **Paciente**: Todas las recetas de un paciente
- **Médico**: Todas las recetas de un médico
- **Farmacia**: Todas las recetas dispensadas en una farmacia

---

## Ejemplos Prácticos

### Ejemplo 1: Detección de Medicamento sin Diagnóstico

**Receta:**
```json
{
  "patient": {
    "diagnosis": []  // Sin diagnóstico
  },
  "medicine": [
    {
      "drug": { "name": "INSULINA" }
    }
  ]
}
```

**Análisis:**
1. `drug-diagnosis` detecta: INSULINA sin diagnóstico
2. Resultado: **Categoría 2** (muy sospechoso)
3. Mensaje: "Medicación sin diagnóstico respaldatorio, consultar médico"

### Ejemplo 2: Detección de Especialidad Incorrecta

**Receta:**
```json
{
  "physician": {
    "professional": {
      "license": {
        "specialty": "PEDIATRIA"
      }
    }
  },
  "medicine": [
    {
      "drug": { "name": "WARFARINA" }  // Anticoagulante típico de cardiología
    }
  ]
}
```

**Análisis:**
1. `drug-specialty` consulta: `rcta-to-specialty.json`
2. WARFARINA + PEDIATRIA = score 5
3. Resultado: **Muy sospechoso** - requiere revisión
4. Mensaje: "Combinación especialidad y medicamento/os, requiere revisión"

### Ejemplo 3: Detección de Interacción Peligrosa

**Receta:**
```json
{
  "medicine": [
    {
      "drug": { "name": "WARFARINA" }  // Anticoagulante
    },
    {
      "drug": { "name": "IBUPROFENO" }  // Antiinflamatorio
    }
  ]
}
```

**Análisis:**
1. `drug-drug` detecta: WARFARINA + IBUPROFENO = interacción peligrosa
2. Resultado: **Muy sospechoso**
3. Mensaje: "Interacción peligrosa detectada - riesgo de sangrado"

### Ejemplo 4: Medicamento Compuesto

**Receta:**
```json
{
  "physician": {
    "professional": {
      "license": {
        "specialty": "PEDIATRIA"
      }
    }
  },
  "medicine": [
    {
      "drug": { "name": "PARACETAMOL+CODEINA" }
    }
  ]
}
```

**Análisis:**
1. `drug-specialty` consulta: `rcta-to-specialty.json`
2. No encuentra score directo para "PARACETAMOL+CODEINA"
3. Separa: ["PARACETAMOL", "CODEINA"]
4. Busca:
   - PARACETAMOL + PEDIATRIA = 2
   - CODEINA + PEDIATRIA = 3
5. Toma mínimo: 2
6. Resultado: **Válido** (score 2 = frecuente)

---

## Resumen

### ¿Por qué estos matcheos?

Los matcheos entre drogas, códigos ICD-10, especialidades, componentes, etc. permiten:

1. **Validar coherencia médica**: Un medicamento debe corresponder al diagnóstico
2. **Detectar especialidades incorrectas**: Un médico debe prescribir medicamentos de su especialidad
3. **Prevenir interacciones peligrosas**: Algunas combinaciones de medicamentos son peligrosas
4. **Normalizar datos**: Diferentes nombres comerciales deben tratarse como el mismo medicamento
5. **Detectar fraudes**: Patrones anómalos pueden indicar fraude

### ¿Cómo funciona `rcta-to-specialty`?

1. **Carga datos** de especialidades y medicamentos de OSOSS
2. **Obtiene RCTA limpios** de un dataset procesado
3. **Mapea cada RCTA a especialidades** con scores (1-5)
4. **Maneja RCTA compuestos** separándolos y tomando el score mínimo
5. **Genera JSON** que será usado por el analizador `drug-specialty`

### Flujo de Datos

```
specialty-medications-ososs.csv
    ↓
drugNameToSpecialtyToScore (Map)
    ↓
rcta-composed-to-rcta-composed-clean.csv
    ↓
cleanRcta (Set)
    ↓
rctaToSpecialty (Map) ← Cálculo con lógica de compuestos
    ↓
rcta-to-specialty.json
    ↓
drug-specialty/index.ts (Analizador)
    ↓
Score de sospecha en recetas
```

---

## Referencias

- **RCTA**: Registro de Códigos Terapéuticos Argentinos
- **ICD-10**: Clasificación Internacional de Enfermedades, 10ª Revisión
- **ATC**: Anatomical Therapeutic Chemical Classification System
- **OSOSS**: Obra Social (fuente de datos de especialidades)
- **OSPSA**: Obra Social de Personal de la Actividad

---

*Documento generado para explicar el sistema de detección de fraude farmacéutico*

