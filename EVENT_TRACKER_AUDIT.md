# Auditoría: useEventTracker - Sistema de Tracking de Tiempo de Auditoría

## Resumen

`useEventTracker` es un hook de React que mide y registra el tiempo que un auditor pasa auditando una receta. Este documento explica en detalle cómo funciona, cuándo se usa, y qué eventos disparan el inicio y fin del tracking.

---

## Propósito

El sistema de tracking de tiempo permite:
- Medir cuánto tiempo tarda un auditor en revisar cada receta
- Registrar este tiempo en la base de datos (`recipe_audits.auditTimeInSeconds`)
- Analizar la eficiencia de los auditores
- Generar métricas de productividad

---

## Ubicación del Código

**Frontend:**
- Hook: `reportes-frontend/src/hooks/useEventTracker.ts`
- Uso: `reportes-frontend/src/components/reports/first-report/FirstReport.tsx`

**Backend:**
- Endpoint: `POST /recipe-audits/update-time`
- Service: `reportes-backend/src/recipe-audit/recipe-audit.service.ts:138` → `updateAuditTime()`
- Controller: `reportes-backend/src/recipe-audit/recipe-audit.controller.ts:102` → `updateAuditTime()`

---

## Estructura del Hook

```typescript
const useEventTracker = (getRecipeStatus?: (recipeId: string) => string | null) => {
  const startTimeRef = useRef<number | null>(null);

  const start = (): void => {
    startTimeRef.current = Date.now();
  };

  const stop = async (
    eventName: string,        // recipeId
    additionalInfo?: string,  // user email
    status?: string          // estado de la receta
  ): Promise<number | null> => {
    if (startTimeRef.current !== null) {
      const elapsed = Date.now() - startTimeRef.current;
      const elapsedSeconds = (elapsed / 1000).toFixed(1);
      
      // Guardar en BD si hay información adicional
      if (additionalInfo && eventName && elapsed > 0) {
        await auditService.updateAuditTime(
          eventName,           // recipeId
          additionalInfo,      // user email
          parseFloat(elapsedSeconds),
          status || getRecipeStatus?.(eventName) || 'aprobada'
        );
      }
      
      startTimeRef.current = null;
      return elapsed;
    }
    return null;
  };

  return { start, stop };
};
```

---

## Cuándo se Inicia el Tracking (`eventTracker.start()`)

### 1. Al Seleccionar una Receta Nueva

**Ubicación:** `FirstReport.tsx:1199`

**Cuándo se dispara:**
- Usuario hace clic en una fila de la tabla de recetas
- La receta seleccionada es diferente a la actual

**Código:**
```typescript
const handleRowClick = (recipeId: string) => {
  if (selectedRecipe !== recipeId) {
    // Si hay una receta seleccionada anteriormente, detener su tracking
    if (selectedRecipe !== null) {
      eventTracker.stop(selectedRecipe, user?.email, currentStatus);
      leaveRecipe(selectedRecipe);
    }
    
    // Iniciar tracking de la nueva receta
    eventTracker.start();  // ← AQUÍ
    setSelectedRecipe(recipeId);
    joinRecipe(recipeId);
  }
};
```

**Qué hace:**
- Guarda el timestamp actual en `startTimeRef.current`
- Este timestamp se usará para calcular el tiempo transcurrido cuando se detenga

---

## Cuándo se Detiene el Tracking (`eventTracker.stop()`)

### 1. Al Cambiar de Receta

**Ubicación:** `FirstReport.tsx:1195`

**Cuándo se dispara:**
- Usuario hace clic en otra receta diferente
- Antes de iniciar el tracking de la nueva receta

**Código:**
```typescript
if (selectedRecipe !== null) {
  const currentStatus = getRecipeAuditStatus(selectedRecipe);
  eventTracker.stop(
    selectedRecipe,                    // recipeId
    user?.email || 'unknown_user@mail.com',  // user email
    currentStatus || 'aprobada'        // estado actual
  );
  leaveRecipe(selectedRecipe);
}

eventTracker.start(); // Iniciar tracking de la nueva receta
```

**Qué hace:**
- Calcula el tiempo transcurrido desde `eventTracker.start()`
- Guarda el tiempo en `recipe_audits.auditTimeInSeconds`
- Resetea el timer para la nueva receta

---

### 2. Al Cerrar un Modal

**Ubicaciones:**
- `FirstReport.tsx:2388` - Al cerrar `AddObsModal` (modal de agregar observación)
- `FirstReport.tsx:2400` - Al cerrar `PatientProfileModal` (modal de perfil de paciente)
- `FirstReport.tsx:2413` - Al cerrar `ViewCommentsModal` (modal de ver comentarios)

**Cuándo se dispara:**
- Usuario cierra cualquier modal mientras tiene una receta seleccionada

**Código:**
```typescript
<AddObsModal
  isOpen={isObsModalOpen}
  onClose={async () => {
    if (selectedRecipe) {
      const currentStatus = getRecipeAuditStatus(selectedRecipe);
      await eventTracker.stop(
        selectedRecipe,
        user?.email || 'usuario@desconocido.com',
        currentStatus || 'aprobada'
      );
    }
    setIsObsModalOpen(false);
  }}
/>
```

**Qué hace:**
- Detiene el tracking temporalmente
- Guarda el tiempo acumulado hasta ese momento
- Cuando el usuario vuelve a la receta, se reinicia el tracking

---

### 3. Al Resetear Filtros

**Ubicación:** `FirstReport.tsx:1078`

**Cuándo se dispara:**
- Usuario hace clic en el botón de resetear filtros
- Esto deselecciona la receta actual

**Código:**
```typescript
const handleResetFilter = () => {
  if (selectedRecipe !== null) {
    const currentStatus = getRecipeAuditStatus(selectedRecipe);
    eventTracker.stop(
      selectedRecipe,
      user?.email || 'usuario@desconocido.com',
      currentStatus || 'aprobada'
    );
    leaveRecipe(selectedRecipe);
  }
  // ... resetear otros estados
  setSelectedRecipe(null);
};
```

**Qué hace:**
- Detiene el tracking de la receta actual
- Guarda el tiempo en la BD
- No inicia tracking de otra receta (porque se deselecciona)

---

### 4. Al Desmontar el Componente

**Ubicación:** `FirstReport.tsx:508`

**Cuándo se dispara:**
- El componente `FirstReport` se desmonta (usuario navega a otra página)
- Hay una receta seleccionada al momento del desmontaje

**Código:**
```typescript
useEffect(() => {
  return () => {
    // Cleanup al desmontar
    if (selectedRecipe !== null) {
      const currentStatus = getRecipeAuditStatus(selectedRecipe);
      eventTracker.stop(
        selectedRecipe,
        user?.email || 'usuario@desconocido.com',
        currentStatus || 'aprobada'
      );
      leaveRecipe(selectedRecipe);
    }
  };
}, []);
```

**Qué hace:**
- Asegura que el tiempo se guarde incluso si el usuario cierra la página
- Evita perder datos de tiempo de auditoría

---

### 5. Al Aprobar/Rechazar Medicamentos (desde modales)

**Ubicaciones:**
- `FirstReport.tsx:2388` - Después de aprobar/rechazar desde `MedicineSelectionModal`
- `FirstReport.tsx:2400` - Después de aprobar/rechazar desde `MedicineAuditModal`

**Cuándo se dispara:**
- Usuario aprueba o rechaza medicamentos desde un modal
- El modal se cierra después de guardar

**Código:**
```typescript
// En el callback onClose del modal
await eventTracker.stop(
  selectedRecipe,
  user?.email || 'usuario@desconocido.com',
  currentStatus || 'aprobada'
);
```

**Qué hace:**
- Guarda el tiempo transcurrido hasta ese momento
- El tracking se reinicia cuando el usuario vuelve a interactuar con la receta

---

## Flujo Completo de Tracking

### Ejemplo: Usuario Audita una Receta

**Tiempo 0:00** - Usuario hace clic en receta `"2516234848558"`
```typescript
eventTracker.start();
// startTimeRef.current = 1700164800000 (timestamp)
```

**Tiempo 0:15** - Usuario abre modal de perfil de paciente
```typescript
// No se detiene el tracking, continúa corriendo
```

**Tiempo 0:30** - Usuario cierra el modal
```typescript
eventTracker.stop("2516234848558", "fabio@gestiar.com.ar", "observada");
// Calcula: 30 segundos transcurridos
// Guarda en BD: auditTimeInSeconds = 30.0
// startTimeRef.current = null
```

**Tiempo 0:35** - Usuario vuelve a la receta (selecciona la misma)
```typescript
// No se reinicia automáticamente, el usuario debe hacer clic de nuevo
// O el tracking se reinicia cuando se abre un modal y se cierra
```

**Tiempo 0:40** - Usuario hace clic en otra receta
```typescript
// Si había tracking activo, se detiene y guarda
eventTracker.stop("2516234848558", "fabio@gestiar.com.ar", "observada");
// Inicia tracking de la nueva receta
eventTracker.start();
```

---

## Cómo se Guarda el Tiempo en la BD

### Frontend → Backend

**Frontend:**
```typescript
// useEventTracker.ts:31
await auditService.updateAuditTime(
  eventName,           // "2516234848558" (recipeId)
  additionalInfo,     // "fabio@gestiar.com.ar" (user email)
  parseFloat(elapsedSeconds),  // 30.5 (segundos)
  currentStatus || 'aprobada'  // "observada"
);
```

**Backend Endpoint:** `POST /recipe-audits/update-time`

**Controller:**
```typescript
// recipe-audit.controller.ts:102
async updateAuditTime(body: {
  recipeId: string;
  reviewedBy: string;
  auditTimeInSeconds: number;
  status?: string;
}) {
  // 1. Intentar actualizar registro existente
  let audit = await recipeAuditService.updateAuditTime(
    body.recipeId,
    body.reviewedBy,
    body.auditTimeInSeconds
  );
  
  // 2. Si no existe, crear uno nuevo
  if (audit === null) {
    audit = await recipeAuditService.createAuditWithTime(
      body.recipeId,
      body.reviewedBy,
      body.auditTimeInSeconds,
      body.status || 'aprobada'
    );
  }
  
  return audit;
}
```

**Service:**
```typescript
// recipe-audit.service.ts:138
async updateAuditTime(
  recipeId: string,
  reviewedBy: string,
  auditTimeInSeconds: number
): Promise<RecipeAudit | null> {
  const existingAudit = await this.getRecipeAudit(recipeId);
  
  if (existingAudit !== null) {
    existingAudit.auditTimeInSeconds = auditTimeInSeconds;
    existingAudit.reviewedBy = reviewedBy;
    return await this.recipeAuditRepository.save(existingAudit);
  }
  
  return null; // No existe, se creará en el controller
}
```

### Qué se Guarda en la BD

**Tabla:** `recipe_audits`

**Campos actualizados:**
- `auditTimeInSeconds`: Tiempo en segundos (ej: `30.5`)
- `reviewedBy`: Email del auditor
- `updatedAt`: Fecha de actualización
- `status`: Estado de la receta (si se proporciona)

**Ejemplo de registro:**
```
id: "d887cdf6-..."
recipeId: "2516234848558"
status: "observada"
reviewedBy: "fabio@gestiar.com.ar"
auditTimeInSeconds: 30.5
createdAt: "2025-11-16 18:48:00"
updatedAt: "2025-11-16 18:48:30"
deletedAt: null
```

---

## Casos Especiales

### 1. Tracking Múltiple (Acumulación)

**Problema:** Si un usuario abre y cierra modales múltiples veces, ¿se acumula el tiempo?

**Respuesta:** NO, cada vez que se llama `stop()`, se guarda el tiempo transcurrido desde el último `start()`. Si se vuelve a llamar `start()`, se reinicia el contador.

**Ejemplo:**
```
start() → 0s
stop() → guarda 15s
start() → 0s (reinicia)
stop() → guarda 20s (sobrescribe el anterior, NO suma)
```

**Nota:** El tiempo guardado es el tiempo de la última sesión, no el acumulado.

### 2. Cambio de Receta sin Detener

**Problema:** ¿Qué pasa si el usuario cambia de receta sin detener explícitamente?

**Respuesta:** En `handleRowClick`, antes de iniciar el tracking de la nueva receta, se detiene el tracking de la anterior:

```typescript
if (selectedRecipe !== null) {
  eventTracker.stop(selectedRecipe, user?.email, currentStatus);
}
eventTracker.start(); // Nueva receta
```

### 3. Cierre de Página sin Guardar

**Problema:** ¿Se pierde el tiempo si el usuario cierra la página?

**Respuesta:** NO, el `useEffect` de cleanup se ejecuta al desmontar el componente y guarda el tiempo:

```typescript
useEffect(() => {
  return () => {
    if (selectedRecipe !== null) {
      eventTracker.stop(selectedRecipe, user?.email, currentStatus);
    }
  };
}, []);
```

### 4. Múltiples Modales Abiertos

**Problema:** ¿Qué pasa si se abren múltiples modales?

**Respuesta:** Cada vez que se cierra un modal, se detiene el tracking y se guarda el tiempo. Cuando se vuelve a la receta, el tracking se reinicia (si el usuario hace clic de nuevo o interactúa).

---

## Resumen de Eventos

### Eventos que Inician Tracking

1. ✅ **Clic en receta nueva** (`handleRowClick`)
   - Ubicación: `FirstReport.tsx:1199`
   - Condición: Receta diferente a la actual

### Eventos que Detienen Tracking

1. ✅ **Clic en otra receta** (`handleRowClick`)
   - Ubicación: `FirstReport.tsx:1195`
   - Guarda tiempo antes de cambiar

2. ✅ **Cerrar modal de agregar observación** (`AddObsModal.onClose`)
   - Ubicación: `FirstReport.tsx:2388`
   - Guarda tiempo acumulado

3. ✅ **Cerrar modal de perfil de paciente** (`PatientProfileModal.onClose`)
   - Ubicación: `FirstReport.tsx:2400`
   - Guarda tiempo acumulado

4. ✅ **Cerrar modal de ver comentarios** (`ViewCommentsModal.onClose`)
   - Ubicación: `FirstReport.tsx:2413`
   - Guarda tiempo acumulado

5. ✅ **Resetear filtros** (`handleResetFilter`)
   - Ubicación: `FirstReport.tsx:1078`
   - Guarda tiempo y deselecciona receta

6. ✅ **Desmontar componente** (`useEffect cleanup`)
   - Ubicación: `FirstReport.tsx:508`
   - Guarda tiempo al salir de la página

---

## Flujo de Datos

```
Usuario hace clic en receta
    ↓
eventTracker.start()
    ↓
startTimeRef.current = Date.now()
    ↓
[Usuario interactúa con la receta]
    ↓
Usuario cierra modal / cambia de receta / sale de página
    ↓
eventTracker.stop(recipeId, userEmail, status)
    ↓
Calcula: elapsed = Date.now() - startTimeRef.current
    ↓
auditService.updateAuditTime(recipeId, userEmail, elapsedSeconds, status)
    ↓
POST /recipe-audits/update-time
    ↓
recipeAuditService.updateAuditTime() o createAuditWithTime()
    ↓
Actualiza/Crea registro en recipe_audits
    ↓
auditTimeInSeconds = elapsedSeconds
reviewedBy = userEmail
updatedAt = ahora
```

---

## Ejemplo Real del Log

Cuando se detiene el tracking, se muestra en consola:

```
Para la receta 2516234848558, 0.5s. (fabio@gestiar.com.ar)
```

**Desglose:**
- `2516234848558`: recipeId
- `0.5s`: Tiempo transcurrido (0.5 segundos)
- `fabio@gestiar.com.ar`: Email del auditor

Este tiempo se guarda en `recipe_audits.auditTimeInSeconds`.

---

## Notas Importantes

1. **El tiempo se sobrescribe:** Cada vez que se detiene el tracking, se guarda el tiempo desde el último `start()`. Si el usuario vuelve a la receta y se reinicia el tracking, el tiempo anterior se sobrescribe (no se acumula).

2. **El estado se actualiza:** Cuando se guarda el tiempo, también se actualiza el `status` de la receta si se proporciona. Esto asegura que el estado en `recipe_audits` esté sincronizado.

3. **No hay tracking en background:** El tracking solo funciona mientras el usuario está interactuando con la receta. Si cambia de pestaña o minimiza la ventana, el tiempo continúa contando hasta que se detenga explícitamente.

4. **Múltiples usuarios:** Cada usuario tiene su propio tracking. Si dos usuarios auditan la misma receta, cada uno guarda su tiempo por separado (aunque `reviewedBy` se actualiza con el último usuario).

5. **Tiempo mínimo:** Solo se guarda si `elapsed > 0`. Si el usuario hace clic y cierra inmediatamente, no se guarda tiempo.

