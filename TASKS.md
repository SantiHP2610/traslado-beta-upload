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
- [ ] Evaluación de advertencia nocturna en CabaPanel: reemplazar advertencia estática por verificación real (hora fin > 22:00) y adaptar el texto según corresponda

## Done

- [x] Fix bug: charter PE cards flickering — removed onMouseEnter/onMouseLeave SET_HIGHLIGHTED_PE dispatches from card div; click-to-preview pattern from CabaPeSelectionPanel now applies to charter cards too
- [x] Fix bug: PE marker InfoWindow mostraba botón "Elegir" incluso cuando el PE ya era el punto confirmado — ahora muestra "✓ Punto de encuentro seleccionado" como texto estático
- [x] Feature: cards de selección de PE en flujo estándar — useStepTwo fetches allMeetingPoints en paralelo con calculateDriverRoute; PeaPanel muestra sección colapsable "Cambiar punto de encuentro" que recalcula solo la ruta base al hacer click
- [x] Planificación de pickup para charter: cuando remainingPool.status === 'charter', rediseño completo del flujo de charter con nuevo modelo de estado (charterAssignment), selección de PE en paso 2, asignación de empleados por PE/pickup en paso 3, modal de confirmación y output final específicos para charter
- [x] Fix bug 1 charter: back button desde paso 3 ahora vuelve correctamente a paso 2 (limpia meetingPoint y vehicles; INIT_VEHICLES effect ya no auto-avanza para charter)
- [x] Fix bug 2 charter: etiqueta de vehículo ya no muestra "Uber charter_1" — muestra "Charter" en todos los panels (AssignmentSummaryPanel, UnassignedPanel, StaffMarkers, ConfirmationModal, FinalOutputBlocks)
- [x] Fix bug 3 charter: selección de PE separada en dos pasos (click en card = preview; click en "Elegir este PE" = confirmación); ruta PE→evento calculada antes de avanzar a paso 3
- [x] Fix bug charter: MeetingPointMarkers ahora renderiza el marker de preview (highlightedPE) aunque meetingPoint sea null (charter paso 2 antes de confirmar)
- [x] Fix bug charter: empleados asignados al PE del charter ahora son amarillos (#FBBC04) — coincide con el color del marcador PE
- [x] Fix bug charter: quitar un punto de recogida ya no limpia la ruta (REMOVE_VEHICLE_PICKUP deja route intacto); botón "Elegir pickup" reaparece correctamente
- [x] Fix bug charter: labels de pickup en español "Recogida N:" (AssignmentSummaryPanel, StaffMarkers, UnassignedPanel)
- [x] Fix bug charter: empleados en pickups[] del charter incluidos en pickup_passengers al validar (buildAssignmentsInput + buildBody en modal)
- [x] Feature charter: sección "O ingresar punto de encuentro manualmente" en CharterPeSelectionSection con geocodificación inline y confirmación de PE
