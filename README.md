# Explicación del Código: `componentToAtc`

Este documento explica en detalle cómo funciona la función `componentToAtc` y cómo se transforman los datos paso a paso.

## Objetivo

La función `componentToAtc` crea un mapa que relaciona cada componente (droga/fármaco) con sus códigos ATC (Anatomical Therapeutic Chemical) correspondientes. El resultado es un `Map<string, Set<string>>` donde:
- **Clave**: Nombre del componente (droga)
- **Valor**: Set de códigos ATC asociados a ese componente

## Estructura de Datos Inicial

### `AlfaBetaRegistry`

El `AlfaBetaRegistry` es un registro que contiene información temporal de productos farmacéuticos. Cada producto tiene:

- **`key`**: Un número identificador único del producto
- **`atcCodes`**: Una serie temporal (`TimeSeries`) que contiene los códigos ATC del producto en diferentes momentos
- **`components`**: Una serie temporal que contiene los componentes (drogas) del producto en diferentes momentos

### `AlfaBetaTimeSeries`

Cada entrada del registro es un `AlfaBetaTimeSeries` que contiene:
- `atcCodes.allMoments`: Array de fechas donde hay códigos ATC definidos
- `atcCodes.lookup(moment)`: Función que devuelve un `Set<string>` con los códigos ATC para una fecha específica
- `components.allMoments`: Array de fechas donde hay componentes definidos
- `components.lookup(moment)`: Función que devuelve un array de `AlfaBetaComponent` para una fecha específica

## Transformación Paso a Paso

### Paso 1: Cargar el Registro

```typescript
const registry: AlfaBetaRegistry = AlfaBetaRegistry.load();
```

**¿Qué contiene `registry`?**
- Un mapa interno de productos farmacéuticos
- Cada producto tiene información temporal (cambios a lo largo del tiempo)
- Puede contener miles de productos

**Estructura conceptual:**
```
registry = {
  key1: AlfaBetaTimeSeries {
    atcCodes: TimeSeries<Set<string>>,
    components: TimeSeries<AlfaBetaComponent[]>
  },
  key2: AlfaBetaTimeSeries { ... },
  ...
}
```

### Paso 2: Obtener Todas las Claves

```typescript
registry.getAllKeys()
```

**¿Qué devuelve?**
- Un array de números: `number[]`
- Ejemplo: `[1, 2, 3, 4, 5, ...]`
- Cada número es un identificador único de un producto farmacéutico

**Tipo de retorno:** `number[]`

### Paso 3: `flatMap` sobre las Claves

```typescript
registry.getAllKeys().flatMap((key: number): [string, string][] => {
  const entry: AlfaBetaTimeSeries = registry.getTimeSeries(key) as AlfaBetaTimeSeries;
  // ...
})
```

**¿Qué hace `flatMap`?**
- Itera sobre cada `key` del array
- Para cada `key`, obtiene el `AlfaBetaTimeSeries` correspondiente
- Cada iteración puede devolver un array de tuplas `[string, string][]`
- `flatMap` "aplana" todos estos arrays en un solo array

**Ejemplo:**
```typescript
// Si tenemos 3 productos:
// Producto 1 devuelve: [["droga1", "ATC1"], ["droga1", "ATC2"]]
// Producto 2 devuelve: [["droga2", "ATC3"]]
// Producto 3 devuelve: [["droga3", "ATC4"], ["droga3", "ATC5"]]

// flatMap los combina en:
[
  ["droga1", "ATC1"],
  ["droga1", "ATC2"],
  ["droga2", "ATC3"],
  ["droga3", "ATC4"],
  ["droga3", "ATC5"]
]
```

**Tipo de retorno:** `[string, string][]` (array de tuplas [componente, códigoATC])

### Paso 4: Obtener Todos los Momentos Temporales

```typescript
Array.from([...entry.atcCodes.allMoments, ...entry.components.allMoments], ...)
```

**¿Qué hace?**
- Combina todos los momentos (fechas) donde hay códigos ATC definidos
- Combina todos los momentos donde hay componentes definidos
- Usa el spread operator (`...`) para combinar ambos arrays
- `Array.from` crea un nuevo array iterando sobre estos momentos

**Ejemplo:**
```typescript
// Si entry.atcCodes.allMoments = [Date1, Date2]
// Y entry.components.allMoments = [Date1, Date3]

// Resultado: [Date1, Date2, Date1, Date3]
// (puede haber duplicados, pero se procesan todos)
```

**Tipo de retorno:** `[Set<string> | undefined, string[] | undefined][]`

### Paso 5: Mapear Cada Momento a sus Datos

```typescript
(moment: Date): [Set<string> | undefined, string[] | undefined] => [
  entry.atcCodes.lookup(moment),
  entry.components.lookup(moment)?.map(({ drug }: AlfaBetaComponent): string => drug),
]
```

**¿Qué hace?**
- Para cada momento (fecha), busca:
  1. Los códigos ATC en esa fecha: `entry.atcCodes.lookup(moment)` → `Set<string> | undefined`
  2. Los componentes en esa fecha: `entry.components.lookup(moment)` → `AlfaBetaComponent[] | undefined`
- Extrae solo el nombre de la droga de cada componente: `.map(({ drug }) => drug)`

**Ejemplo:**
```typescript
// Para un momento específico:
// entry.atcCodes.lookup(moment) → Set(["A01AA01", "A01AA02"])
// entry.components.lookup(moment) → [
//   { drug: "Paracetamol", ... },
//   { drug: "Ibuprofeno", ... }
// ]

// Después del map:
// ["Paracetamol", "Ibuprofeno"]

// Resultado de la tupla:
// [Set(["A01AA01", "A01AA02"]), ["Paracetamol", "Ibuprofeno"]]
```

**Tipo de retorno:** `[Set<string> | undefined, string[] | undefined][]`

### Paso 6: Filtrar Pares Válidos

```typescript
.filter(
  (pair: [Set<string> | undefined, string[] | undefined]): pair is [Set<string>, string[]] =>
    undefined !== pair[0] && undefined !== pair[1] && 0 < pair[0].size && 0 < pair[1].length,
)
```

**¿Qué hace?**
- Elimina pares donde:
  - Los códigos ATC son `undefined`
  - Los componentes son `undefined`
  - Los códigos ATC están vacíos (`size === 0`)
  - Los componentes están vacíos (`length === 0`)
- Usa un type guard para asegurar que después del filtro, ambos valores están definidos

**Ejemplo:**
```typescript
// Antes del filter:
[
  [Set(["A01AA01"]), ["Paracetamol"]],  // ✅ Válido
  [undefined, ["Ibuprofeno"]],            // ❌ Filtrado (ATC undefined)
  [Set([]), ["Aspirina"]],                // ❌ Filtrado (ATC vacío)
  [Set(["A01AA02"]), []],                 // ❌ Filtrado (componentes vacíos)
  [Set(["A01AA03"]), ["Diclofenac"]]      // ✅ Válido
]

// Después del filter:
[
  [Set(["A01AA01"]), ["Paracetamol"]],
  [Set(["A01AA03"]), ["Diclofenac"]]
]
```

**Tipo de retorno:** `[Set<string>, string[]][]` (solo pares válidos)

### Paso 7: `flatMap` para Generar Combinaciones

```typescript
.flatMap(([atcCodes, components]: [Set<string>, string[]]): [string, string][] => {
  const normalizedAtcCodes: string[] = Array.from(atcCodes.values(), (atcCode: string): string =>
    atcCode.toUpperCase(),
  );
  return array_cartesian(components, normalizedAtcCodes);
})
```

**¿Qué hace?**
1. **Normaliza códigos ATC**: Convierte todos los códigos ATC a mayúsculas
2. **Genera producto cartesiano**: Crea todas las combinaciones posibles entre componentes y códigos ATC

**¿Qué es `array_cartesian`?**
```typescript
array_cartesian(components, normalizedAtcCodes)
// Si components = ["Paracetamol", "Ibuprofeno"]
// Y normalizedAtcCodes = ["A01AA01", "A01AA02"]
// Resultado:
[
  ["Paracetamol", "A01AA01"],
  ["Paracetamol", "A01AA02"],
  ["Ibuprofeno", "A01AA01"],
  ["Ibuprofeno", "A01AA02"]
]
```

**Ejemplo completo:**
```typescript
// Entrada:
[Set(["a01aa01", "A01AA02"]), ["Paracetamol", "Ibuprofeno"]]

// Paso 1: Normalizar ATC
normalizedAtcCodes = ["A01AA01", "A01AA02"]

// Paso 2: Producto cartesiano
[
  ["Paracetamol", "A01AA01"],
  ["Paracetamol", "A01AA02"],
  ["Ibuprofeno", "A01AA01"],
  ["Ibuprofeno", "A01AA02"]
]
```

**Tipo de retorno:** `[string, string][]` (array de tuplas [componente, códigoATC])

### Paso 8: `array_categorize` - Agrupar por Componente

```typescript
array_categorize(
  [...todas las tuplas [string, string]...],
  ([drug]: [string, string]): string => drug,
)
```

**¿Qué hace `array_categorize`?**
- Toma un array y una función categorizadora
- Agrupa los elementos del array por la categoría que devuelve la función
- Devuelve un `Map` donde:
  - **Clave**: La categoría (en este caso, el nombre del componente)
  - **Valor**: Array de todos los elementos que pertenecen a esa categoría

**Ejemplo:**
```typescript
// Entrada (array de tuplas):
[
  ["Paracetamol", "A01AA01"],
  ["Paracetamol", "A01AA02"],
  ["Ibuprofeno", "A01AA01"],
  ["Ibuprofeno", "A01AA02"],
  ["Paracetamol", "A01AA03"]
]

// Después de array_categorize:
Map {
  "Paracetamol" => [
    ["Paracetamol", "A01AA01"],
    ["Paracetamol", "A01AA02"],
    ["Paracetamol", "A01AA03"]
  ],
  "Ibuprofeno" => [
    ["Ibuprofeno", "A01AA01"],
    ["Ibuprofeno", "A01AA02"]
  ]
}
```

**Tipo de retorno:** `Map<string, [string, string][]>`

### Paso 9: `map_map` - Transformar Arrays en Sets

```typescript
map_map(
  Map<string, [string, string][]>,
  (pairs: [string, string][]): Set<string> =>
    new Set<string>(pairs.map(([, atcCode]: [string, string]): string => atcCode)),
)
```

**¿Qué hace `map_map`?**
- Toma un `Map<K, V>` y una función `f: (v: V) => U`
- Transforma cada valor del mapa aplicando la función
- Mantiene las mismas claves
- Devuelve un `Map<K, U>`

**En este caso:**
- **Entrada**: `Map<string, [string, string][]>` (componente → array de tuplas)
- **Función**: Extrae solo los códigos ATC de cada tupla y los convierte en un `Set`
- **Salida**: `Map<string, Set<string>>` (componente → set de códigos ATC)

**Ejemplo:**
```typescript
// Entrada:
Map {
  "Paracetamol" => [
    ["Paracetamol", "A01AA01"],
    ["Paracetamol", "A01AA02"],
    ["Paracetamol", "A01AA03"]
  ],
  "Ibuprofeno" => [
    ["Ibuprofeno", "A01AA01"],
    ["Ibuprofeno", "A01AA02"]
  ]
}

// Para "Paracetamol":
pairs.map(([, atcCode]) => atcCode)
// → ["A01AA01", "A01AA02", "A01AA03"]
// new Set(...) → Set(["A01AA01", "A01AA02", "A01AA03"])

// Resultado final:
Map {
  "Paracetamol" => Set(["A01AA01", "A01AA02", "A01AA03"]),
  "Ibuprofeno" => Set(["A01AA01", "A01AA02"])
}
```

**Tipo de retorno:** `Map<string, Set<string>>`

## Resumen del Flujo Completo

```
1. registry.getAllKeys()
   → [1, 2, 3, ...] (números)

2. .flatMap(key => ...)
   → Para cada producto, genera tuplas [componente, ATC]
   → Resultado: [["Paracetamol", "A01AA01"], ["Paracetamol", "A01AA02"], ...]

3. array_categorize(..., drug => drug)
   → Agrupa por componente
   → Resultado: Map { "Paracetamol" => [[...tuplas...]], ... }

4. map_map(..., pairs => Set de ATCs)
   → Convierte arrays de tuplas en Sets de códigos ATC
   → Resultado: Map { "Paracetamol" => Set(["A01AA01", ...]), ... }
```

## Funciones Auxiliares Utilizadas

### `flatMap`
- **Propósito**: Aplana arrays anidados
- **Ejemplo**: `[1, 2].flatMap(x => [x, x*2])` → `[1, 2, 2, 4]`

### `array_cartesian`
- **Propósito**: Genera el producto cartesiano de dos arrays
- **Implementación**: `arrayA.flatMap(a => arrayB.map(b => [a, b]))`
- **Ejemplo**: `array_cartesian([1, 2], [3, 4])` → `[[1, 3], [1, 4], [2, 3], [2, 4]]`

### `array_categorize`
- **Propósito**: Agrupa elementos de un array por categoría
- **Implementación**: Itera sobre el array y agrupa en un Map
- **Ejemplo**: `array_categorize([1, 2, 3, 4], x => x % 2)` → `Map { 0 => [2, 4], 1 => [1, 3] }`

### `map_map`
- **Propósito**: Transforma los valores de un Map
- **Implementación**: `new Map(Array.from(map.entries(), ([k, v]) => [k, f(v)]))`
- **Ejemplo**: `map_map(Map { "a" => 1, "b" => 2 }, x => x * 2)` → `Map { "a" => 2, "b" => 4 }`

## Resultado Final

El resultado es un `Map<string, Set<string>>` donde:
- Cada clave es el nombre de un componente (droga)
- Cada valor es un Set de códigos ATC asociados a ese componente
- Los códigos ATC están normalizados (mayúsculas)
- Un componente puede tener múltiples códigos ATC (porque puede aparecer en diferentes productos o momentos temporales)

Este mapa se utiliza posteriormente para traducir nombres de componentes a sus códigos ATC correspondientes.

