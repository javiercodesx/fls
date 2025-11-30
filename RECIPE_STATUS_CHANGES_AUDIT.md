# Auditoría: Cambio de Estado de Recetas y Medicamentos

## Resumen

Este documento explica en detalle cómo funciona el sistema de cambio de estados de recetas y medicamentos, qué se guarda en la base de datos, y qué funciones se ejecutan en cada escenario.

---

## Tablas de Base de Datos

### 1. `medicine_audits`
Almacena el estado de auditoría de cada medicamento individual.

**Estructura:**
- `id`: ID único del registro
- `recipeId`: ID de la receta
- `medicineIndex`: Índice del medicamento (0-5)
- `status`: Estado (`'aprobada'`, `'observada'`, `'sin_auditar'`)
- `reviewedBy`: Email del usuario que hizo el cambio
- `createdAt`: Fecha de creación del registro
- `updatedAt`: Fecha de última actualización
- `deletedAt`: Fecha de soft-delete (si aplica, actualmente no se usa)

### 2. `recipe_audits`
Almacena el estado de auditoría de la receta completa (calculado automáticamente).

**Estructura:**
- `id`: ID único del registro
- `recipeId`: ID de la receta
- `status`: Estado (`'aprobada'`, `'observada'`)
- `reviewedBy`: Email del usuario que hizo el cambio
- `auditTimeInSeconds`: Tiempo de auditoría en segundos
- `createdAt`: Fecha de creación del registro
- `updatedAt`: Fecha de última actualización
- `deletedAt`: Fecha de soft-delete (cuando la receta está sin auditar)

---

## Flujo de Sincronización

### Regla Fundamental
**El estado de `recipe_audits` se calcula automáticamente basado en el estado de TODOS los medicamentos en `medicine_audits`.**

### Lógica de Cálculo del Estado de la Receta

**Ubicación:** `medicine-audit.service.ts:50` → `calculateRecipeStatusFromMedicines()`

**Reglas:**
1. Se obtienen TODOS los registros de `medicine_audits` para la receta
2. Se filtran los medicamentos con status `'sin_auditar'` (UNAUDITED) - estos se ignoran
3. Si NO hay medicamentos auditados (todos están en `'sin_auditar'` o no hay registros):
   - La receta está **sin auditar** → retorna `null`
4. Si hay medicamentos auditados:
   - Si **AL MENOS UNO** está `'observada'` → la receta está **observada**
   - Si **TODOS** están `'aprobada'` → la receta está **aprobada**
   - Si hay una mezcla → la receta está **sin auditar**

---

## Escenarios Detallados

### Escenario 1: Receta con 3 Medicamentos - Observar Uno

**Situación inicial:**
- Receta: `"2516234848558"`
- Medicamentos: 3 (índices 0, 1, 2)
- Estado inicial: Todos sin auditar

**Acción:** Usuario observa el medicamento índice 0

#### Flujo de Ejecución:

1. **Frontend:** `MedicineAuditModal.tsx:159` → `auditService.rejectMedicine()`
2. **Backend:** `POST /medicine-audits/reject`
3. **Controller:** `medicine-audit.controller.ts:69` → `rejectMedicine()`
4. **Service:** `medicine-audit.service.ts:205` → `rejectMedicine()`

#### Qué se ejecuta:

```typescript
// 1. Buscar registro existente en medicine_audits
const existingAudit = await medicineAuditRepository.findOne({
  where: { recipeId: "2516234848558", medicineIndex: 0 }
});

// 2. Como no existe, crear nuevo registro
const newAudit = medicineAuditRepository.create({
  recipeId: "2516234848558",
  medicineIndex: 0,
  status: "observada",
  reviewedBy: "fabio@gestiar.com.ar"
});

// 3. Guardar en BD
await medicineAuditRepository.save(newAudit);
// → Se crea registro en medicine_audits:
//    id: 63, recipeId: "2516234848558", medicineIndex: 0, 
//    status: "observada", reviewedBy: "fabio@gestiar.com.ar",
//    createdAt: "2025-11-16 18:48:04", updatedAt: "2025-11-16 18:48:04"

// 4. Sincronizar recipe_audits
await syncRecipeAuditStatus("2516234848558", "fabio@gestiar.com.ar");
```

#### Sincronización de `recipe_audits`:

```typescript
// 1. Calcular estado de la receta
const medicineAudits = await getMedicineAudits("2516234848558");
// → [{ recipeId: "2516234848558", medicineIndex: 0, status: "observada" }]

// 2. Filtrar medicamentos auditados (excluir UNAUDITED)
const auditedMedicines = medicineAudits.filter(a => a.status !== "sin_auditar");
// → [{ recipeId: "2516234848558", medicineIndex: 0, status: "observada" }]

// 3. Contar estados
// observedCount = 1, approvedCount = 0

// 4. Como observedCount > 0 → estado = "observada"

// 5. Verificar si existe registro en recipe_audits
const existingAudit = await recipeAuditService.getRecipeAudit("2516234848558");
// → null (no existe)

// 6. Crear nuevo registro
await recipeAuditService.rejectRecipe({
  recipeId: "2516234848558",
  reviewedBy: "fabio@gestiar.com.ar"
});
// → Se crea registro en recipe_audits:
//    id: "d887cdf6-...", recipeId: "2516234848558",
//    status: "observada", reviewedBy: "fabio@gestiar.com.ar",
//    createdAt: "2025-11-16 18:48:00", updatedAt: "2025-11-16 18:48:00"
```

#### Resultado en BD:

**`medicine_audits`:**
```
id: 63
recipeId: "2516234848558"
medicineIndex: 0
status: "observada"
reviewedBy: "fabio@gestiar.com.ar"
createdAt: "2025-11-16 18:48:04"
updatedAt: "2025-11-16 18:48:04"
```

**`recipe_audits`:**
```
id: "d887cdf6-..."
recipeId: "2516234848558"
status: "observada"
reviewedBy: "fabio@gestiar.com.ar"
auditTimeInSeconds: null
createdAt: "2025-11-16 18:48:00"
updatedAt: "2025-11-16 18:48:00"
deletedAt: null
```

---

### Escenario 2: Receta con 3 Medicamentos - Aprobar Todos

**Situación inicial:**
- Receta: `"2516234811123"`
- Medicamentos: 3 (índices 0, 1, 2)
- Estado inicial: Todos sin auditar

**Acción:** Usuario hace clic en "Aprobar" (aprueba todos los medicamentos)

#### Flujo de Ejecución:

1. **Frontend:** `FirstReport.tsx:1955` → `handleApproveAllMedicines()`
2. **Para cada medicamento:**
   - `auditService.approveMedicine()` → `POST /medicine-audits/approve`
   - `medicine-audit.service.ts:165` → `approveMedicine()`

#### Qué se ejecuta (para cada medicamento):

```typescript
// Medicamento índice 0
await approveMedicine({
  recipeId: "2516234811123",
  medicineIndex: 0,
  reviewedBy: "fabio@gestiar.com.ar"
});

// 1. Buscar registro existente
const existingAudit = await medicineAuditRepository.findOne({
  where: { recipeId: "2516234811123", medicineIndex: 0 }
});
// → null (no existe)

// 2. Crear nuevo registro
const newAudit = medicineAuditRepository.create({
  recipeId: "2516234811123",
  medicineIndex: 0,
  status: "aprobada",
  reviewedBy: "fabio@gestiar.com.ar"
});
await medicineAuditRepository.save(newAudit);
// → Se crea registro en medicine_audits

// 3. Sincronizar recipe_audits (después de cada medicamento)
await syncRecipeAuditStatus("2516234811123", "fabio@gestiar.com.ar");
```

**Después de aprobar el primer medicamento:**
- `medicine_audits`: 1 registro (índice 0, aprobada)
- `recipe_audits`: Estado = `null` (no todos están aprobados aún)

**Después de aprobar el segundo medicamento:**
- `medicine_audits`: 2 registros (índices 0 y 1, ambos aprobadas)
- `recipe_audits`: Estado = `null` (no todos están aprobados aún)

**Después de aprobar el tercer medicamento:**
- `medicine_audits`: 3 registros (índices 0, 1, 2, todos aprobadas)
- `syncRecipeAuditStatus()` calcula:
  - `auditedMedicines.length = 3`
  - `approvedCount = 3`
  - `approvedCount === auditedMedicines.length` → **Estado = "aprobada"**
- `recipe_audits`: Se crea/actualiza registro con status `"aprobada"`

#### Resultado en BD:

**`medicine_audits`:**
```
id: 53, recipeId: "2516234811123", medicineIndex: 0, status: "aprobada", ...
id: 54, recipeId: "2516234811123", medicineIndex: 1, status: "aprobada", ...
```

**`recipe_audits`:**
```
id: "a56a8846-..."
recipeId: "2516234811123"
status: "aprobada"
reviewedBy: "fabio@gestiar.com.ar"
auditTimeInSeconds: 0.80
createdAt: "2025-11-16 18:47:54"
updatedAt: "2025-11-16 18:47:54"
```

---

### Escenario 3: Receta con 3 Medicamentos - Observar Uno Después de Aprobar Todos

**Situación inicial:**
- Receta: `"2516234811123"`
- Medicamentos: 3 (índices 0, 1, 2)
- Estado: Todos aprobados

**Acción:** Usuario observa el medicamento índice 1

#### Flujo de Ejecución:

1. **Frontend:** `MedicineAuditModal.tsx:159` → `auditService.rejectMedicine()`
2. **Backend:** `POST /medicine-audits/reject`
3. **Service:** `medicine-audit.service.ts:205` → `rejectMedicine()`

#### Qué se ejecuta:

```typescript
// 1. Buscar registro existente
const existingAudit = await medicineAuditRepository.findOne({
  where: { recipeId: "2516234811123", medicineIndex: 1 }
});
// → { id: 54, status: "aprobada", ... }

// 2. Actualizar estado
existingAudit.status = "observada";
existingAudit.reviewedBy = "fabio@gestiar.com.ar";
await medicineAuditRepository.save(existingAudit);
// → Se actualiza registro en medicine_audits:
//    id: 54, status: "observada", updatedAt: "2025-11-16 18:48:10"

// 3. Sincronizar recipe_audits
await syncRecipeAuditStatus("2516234811123", "fabio@gestiar.com.ar");
```

#### Sincronización de `recipe_audits`:

```typescript
// 1. Calcular estado de la receta
const medicineAudits = await getMedicineAudits("2516234811123");
// → [
//     { medicineIndex: 0, status: "aprobada" },
//     { medicineIndex: 1, status: "observada" },
//     { medicineIndex: 2, status: "aprobada" }
//   ]

// 2. Filtrar medicamentos auditados
const auditedMedicines = medicineAudits.filter(a => a.status !== "sin_auditar");
// → 3 medicamentos auditados

// 3. Contar estados
// observedCount = 1, approvedCount = 2

// 4. Como observedCount > 0 → estado = "observada"

// 5. Verificar si existe registro en recipe_audits
const existingAudit = await recipeAuditService.getRecipeAudit("2516234811123");
// → { id: "a56a8846-...", status: "aprobada", ... }

// 6. Actualizar registro existente
await recipeAuditService.rejectRecipe({
  recipeId: "2516234811123",
  reviewedBy: "fabio@gestiar.com.ar"
});
// → Se actualiza registro en recipe_audits:
//    status: "observada", updatedAt: "2025-11-16 18:48:10"
```

#### Resultado en BD:

**`medicine_audits`:**
```
id: 53, medicineIndex: 0, status: "aprobada", ...
id: 54, medicineIndex: 1, status: "observada", updatedAt: "2025-11-16 18:48:10"
id: 55, medicineIndex: 2, status: "aprobada", ...
```

**`recipe_audits`:**
```
id: "a56a8846-..."
recipeId: "2516234811123"
status: "observada"  ← CAMBIÓ de "aprobada" a "observada"
reviewedBy: "fabio@gestiar.com.ar"
updatedAt: "2025-11-16 18:48:10"  ← ACTUALIZADO
```

---

### Escenario 4: Receta con 3 Medicamentos - Resetear Uno a "Sin Auditar"

**Situación inicial:**
- Receta: `"2516134705304"`
- Medicamentos: 2 (índices 0, 1)
- Estado: Índice 0 = "observada", Índice 1 = "aprobada"

**Acción:** Usuario resetea el medicamento índice 1 a "sin auditar"

#### Flujo de Ejecución:

1. **Frontend:** `MedicineAuditModal.tsx:147` → `auditService.resetMedicineAudit()`
2. **Backend:** `POST /medicine-audits/reset`
3. **Service:** `medicine-audit.service.ts:245` → `resetMedicineAudit()`

#### Qué se ejecuta:

```typescript
// 1. Buscar registro existente
const existingAudit = await medicineAuditRepository.findOne({
  where: { recipeId: "2516134705304", medicineIndex: 1 }
});
// → { id: 61, status: "aprobada", ... }

// 2. En lugar de eliminar, actualizar status a UNAUDITED
existingAudit.status = "sin_auditar";
existingAudit.reviewedBy = "fabio@gestiar.com.ar";
await medicineAuditRepository.save(existingAudit);
// → Se actualiza registro en medicine_audits:
//    id: 61, status: "sin_auditar", updatedAt: "2025-11-16 18:47:45"

// 3. Sincronizar recipe_audits
await syncRecipeAuditStatus("2516134705304", "fabio@gestiar.com.ar");
```

#### Sincronización de `recipe_audits`:

```typescript
// 1. Calcular estado de la receta
const medicineAudits = await getMedicineAudits("2516134705304");
// → [
//     { medicineIndex: 0, status: "observada" },
//     { medicineIndex: 1, status: "sin_auditar" }
//   ]

// 2. Filtrar medicamentos auditados (excluir UNAUDITED)
const auditedMedicines = medicineAudits.filter(a => a.status !== "sin_auditar");
// → [{ medicineIndex: 0, status: "observada" }]

// 3. Contar estados
// observedCount = 1, approvedCount = 0

// 4. Como observedCount > 0 → estado = "observada"

// 5. Verificar si existe registro en recipe_audits
const existingAudit = await recipeAuditService.getRecipeAudit("2516134705304");
// → { id: "5efb30a3-...", status: "observada", ... }

// 6. Actualizar registro (mantiene "observada" porque el índice 0 sigue observado)
await recipeAuditService.rejectRecipe({
  recipeId: "2516134705304",
  reviewedBy: "fabio@gestiar.com.ar"
});
```

#### Resultado en BD:

**`medicine_audits`:**
```
id: 60, medicineIndex: 0, status: "observada", ...
id: 61, medicineIndex: 1, status: "sin_auditar", updatedAt: "2025-11-16 18:47:45"
```

**`recipe_audits`:**
```
id: "5efb30a3-..."
recipeId: "2516134705304"
status: "observada"  ← Se mantiene porque el índice 0 sigue observado
reviewedBy: "fabio@gestiar.com.ar"
updatedAt: "2025-11-16 18:47:45"
```

---

### Escenario 5: Receta con 2 Medicamentos - Resetear Ambos a "Sin Auditar"

**Situación inicial:**
- Receta: `"2516134705304"`
- Medicamentos: 2 (índices 0, 1)
- Estado: Índice 0 = "observada", Índice 1 = "sin_auditar"

**Acción:** Usuario resetea el medicamento índice 0 a "sin auditar"

#### Flujo de Ejecución:

Similar al Escenario 4, pero después de resetear:

#### Sincronización de `recipe_audits`:

```typescript
// 1. Calcular estado de la receta
const medicineAudits = await getMedicineAudits("2516134705304");
// → [
//     { medicineIndex: 0, status: "sin_auditar" },
//     { medicineIndex: 1, status: "sin_auditar" }
//   ]

// 2. Filtrar medicamentos auditados (excluir UNAUDITED)
const auditedMedicines = medicineAudits.filter(a => a.status !== "sin_auditar");
// → [] (array vacío)

// 3. Como auditedMedicines.length === 0 → estado = null (sin auditar)

// 4. Verificar si existe registro en recipe_audits
const existingAudit = await recipeAuditService.getRecipeAudit("2516134705304");
// → { id: "5efb30a3-...", status: "observada", ... }

// 5. Hacer soft-delete del registro
await recipeAuditService.resetRecipeAudit({
  recipeId: "2516134705304",
  reviewedBy: "fabio@gestiar.com.ar"
});
// → Se actualiza registro en recipe_audits:
//    deletedAt: "2025-11-16 18:47:50"  ← SOFT-DELETE
```

#### Resultado en BD:

**`medicine_audits`:**
```
id: 60, medicineIndex: 0, status: "sin_auditar", updatedAt: "2025-11-16 18:47:50"
id: 61, medicineIndex: 1, status: "sin_auditar", ...
```

**`recipe_audits`:**
```
id: "5efb30a3-..."
recipeId: "2516134705304"
status: "observada"
deletedAt: "2025-11-16 18:47:50"  ← SOFT-DELETE (no se muestra en queries normales)
```

---

## Funciones Clave

### Backend

#### `MedicineAuditService.approveMedicine()`
- **Ubicación:** `medicine-audit.service.ts:165`
- **Qué hace:**
  1. Busca o crea registro en `medicine_audits` con status `"aprobada"`
  2. Guarda el registro
  3. Llama a `syncRecipeAuditStatus()` para sincronizar `recipe_audits`

#### `MedicineAuditService.rejectMedicine()`
- **Ubicación:** `medicine-audit.service.ts:205`
- **Qué hace:**
  1. Busca o crea registro en `medicine_audits` con status `"observada"`
  2. Guarda el registro
  3. Llama a `syncRecipeAuditStatus()` para sincronizar `recipe_audits`

#### `MedicineAuditService.resetMedicineAudit()`
- **Ubicación:** `medicine-audit.service.ts:245`
- **Qué hace:**
  1. Busca registro en `medicine_audits`
  2. Si existe, actualiza status a `"sin_auditar"` (NO elimina)
  3. Si no existe, crea registro con status `"sin_auditar"`
  4. Guarda el registro
  5. Llama a `syncRecipeAuditStatus()` para sincronizar `recipe_audits`

#### `MedicineAuditService.calculateRecipeStatusFromMedicines()`
- **Ubicación:** `medicine-audit.service.ts:50`
- **Qué hace:**
  1. Obtiene todos los registros de `medicine_audits` para la receta
  2. Filtra los que tienen status `"sin_auditar"` (se ignoran)
  3. Calcula el estado:
     - Si hay al menos uno `"observada"` → retorna `"observada"`
     - Si todos están `"aprobada"` → retorna `"aprobada"`
     - Si no hay medicamentos auditados → retorna `null` (sin auditar)

#### `MedicineAuditService.syncRecipeAuditStatus()`
- **Ubicación:** `medicine-audit.service.ts:94`
- **Qué hace:**
  1. Calcula el estado de la receta usando `calculateRecipeStatusFromMedicines()`
  2. Si estado es `null` (sin auditar):
     - Hace soft-delete del registro en `recipe_audits` si existe
  3. Si estado es `"aprobada"` o `"observada"`:
     - Si existe registro en `recipe_audits`, lo actualiza
     - Si no existe, crea uno nuevo

#### `RecipeAuditService.approveRecipe()`
- **Ubicación:** `recipe-audit.service.ts:37`
- **Qué hace:**
  1. Busca registro en `recipe_audits` (incluso soft-deleted)
  2. Si existe:
     - Si está soft-deleted, lo restaura (`deletedAt = null`)
     - Actualiza status a `"aprobada"`
  3. Si no existe, crea nuevo registro con status `"aprobada"`

#### `RecipeAuditService.rejectRecipe()`
- **Ubicación:** `recipe-audit.service.ts:68`
- **Qué hace:** Similar a `approveRecipe()` pero con status `"observada"`

#### `RecipeAuditService.resetRecipeAudit()`
- **Ubicación:** `recipe-audit.service.ts:99`
- **Qué hace:**
  1. Busca registro en `recipe_audits`
  2. Si existe, hace soft-delete (`deletedAt = fecha actual`)

---

## Resumen de Reglas

### Reglas de Estado de Receta

1. **Receta Aprobada:**
   - TODOS los medicamentos auditados (excluyendo `"sin_auditar"`) deben estar `"aprobada"`
   - Si hay al menos un medicamento `"sin_auditar"`, la receta NO puede estar aprobada

2. **Receta Observada:**
   - AL MENOS UN medicamento auditado está `"observada"`
   - Tiene prioridad sobre "aprobada"

3. **Receta Sin Auditar:**
   - NO hay medicamentos auditados (todos están en `"sin_auditar"` o no hay registros)
   - O hay una mezcla de estados que no cumple las reglas anteriores

### Reglas de Persistencia

1. **Todos los movimientos se guardan:**
   - Aprobar medicamento → crea/actualiza registro en `medicine_audits`
   - Observar medicamento → crea/actualiza registro en `medicine_audits`
   - Resetear medicamento → actualiza registro a `"sin_auditar"` (NO elimina)

2. **Sincronización automática:**
   - Cada cambio en `medicine_audits` sincroniza `recipe_audits`
   - El estado de `recipe_audits` siempre refleja el estado actual de los medicamentos

3. **Historial completo:**
   - Todos los cambios se registran con `createdAt` y `updatedAt`
   - Se puede rastrear quién hizo cada cambio (`reviewedBy`)
   - Se puede ver el historial completo de estados de cada medicamento

---

## Ejemplo Completo: Flujo de una Receta

**Receta:** `"2516234848558"` con 2 medicamentos (índices 0 y 1)

### Paso 1: Observar medicamento 0
- `medicine_audits`: Crea registro `{ medicineIndex: 0, status: "observada" }`
- `recipe_audits`: Crea registro `{ status: "observada" }`

### Paso 2: Observar medicamento 1
- `medicine_audits`: Crea registro `{ medicineIndex: 1, status: "observada" }`
- `recipe_audits`: Actualiza registro `{ status: "observada" }` (se mantiene)

### Paso 3: Aprobar medicamento 0
- `medicine_audits`: Actualiza registro `{ medicineIndex: 0, status: "aprobada" }`
- `recipe_audits`: Actualiza registro `{ status: "observada" }` (porque el índice 1 sigue observado)

### Paso 4: Aprobar medicamento 1
- `medicine_audits`: Actualiza registro `{ medicineIndex: 1, status: "aprobada" }`
- `recipe_audits`: Actualiza registro `{ status: "aprobada" }` (todos están aprobados)

### Paso 5: Resetear medicamento 0 a "sin auditar"
- `medicine_audits`: Actualiza registro `{ medicineIndex: 0, status: "sin_auditar" }`
- `recipe_audits`: Actualiza registro `{ status: "aprobada" }` (porque el índice 1 sigue aprobado)

### Paso 6: Resetear medicamento 1 a "sin auditar"
- `medicine_audits`: Actualiza registro `{ medicineIndex: 1, status: "sin_auditar" }`
- `recipe_audits`: Soft-delete del registro (todos los medicamentos están sin auditar)

**Resultado final en BD:**

**`medicine_audits`:**
```
id: X, recipeId: "2516234848558", medicineIndex: 0, status: "sin_auditar", ...
id: Y, recipeId: "2516234848558", medicineIndex: 1, status: "sin_auditar", ...
```

**`recipe_audits`:**
```
id: Z, recipeId: "2516234848558", status: "aprobada", deletedAt: "2025-11-16 18:48:25"
```

---

## Notas Importantes

1. **No se eliminan registros:** Cuando se resetea un medicamento, se actualiza a `"sin_auditar"` en lugar de eliminarlo, manteniendo el historial completo.

2. **Sincronización automática:** Cada cambio en medicamentos dispara automáticamente la sincronización de `recipe_audits`.

3. **Un solo registro por receta:** En `recipe_audits` solo puede haber un registro activo por receta (sin `deletedAt`). Si hay múltiples, es un error que se corrigió.

4. **Tiempo de auditoría:** El campo `auditTimeInSeconds` en `recipe_audits` se actualiza cuando se guarda el tiempo de auditoría (ver `useEventTracker`).

