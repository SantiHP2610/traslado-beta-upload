---
project: App Traslado Personal
next_estimated_delivery: 2026-06-04
---

# Tasks

## To do

- [ ] Rediseño del output final (paso 4): reemplazar los dos bloques draggables de FinalOutputBlocks.jsx por un único panel grande con backdrop semi-transparente, consolidando frescos y transporte como secciones, con botón "Volver a editar" que preserva todo el estado
- [ ] Highlight visual de pickup en el mapa: overlay de círculo alrededor de cross-points y candidatos de pickup para revisión del manager
- [ ] Teléfonos de empleados: mostrar campo Telefono (columna 9 de Equipo) en InfoWindow, panel lateral y menú contextual de asignación — bloqueado por formato final de Excel
- [ ] pickup_place siempre null en build_final_output: pasar el pickup confirmado al endpoint /final-output y propagarlo en transport_block.personal_vehicle
- [ ] assigned_roles hardcodeados en /evaluate-pea: reemplazar la lista fija por los roles reales recibidos como parámetro desde el frontend
- [ ] Routing de regreso para eventos en CABA: paso post-evento que calcula rutas de regreso desde el venue hasta el domicilio de cada empleado, agrupadas por tránsito o Uber
## Done

- [x] Planificación de pickup para charter: cuando remainingPool.status === 'charter', rediseño completo del flujo de charter con nuevo modelo de estado (charterAssignment), selección de PE en paso 2, asignación de empleados por PE/pickup en paso 3, modal de confirmación y output final específicos para charter
