/**
 * FrescosPanel.jsx
 * Floating panel for the frescos vehicle question and its result summary.
 *
 * ── Why a floating panel, not a modal ────────────────────────────────────────
 * A modal dims and disables the map behind it.  This app's core UX principle
 * is that the map always stays fully interactive: the user can pan, zoom, and
 * inspect staff markers at any time — including while answering the van
 * question.  Seeing where the staff live gives useful spatial context when
 * deciding whether the company van is worth deploying.
 * A floating Card (position: absolute, no backdrop) achieves this: it sits
 * above the map canvas without capturing pointer events outside its own
 * bounds, so the map beneath remains fully clickable.
 *
 * ── Why all 4 backend calls happen in one handler ────────────────────────────
 * All four calls (frescos, second miniflete, remaining pool, personal vehicle)
 * depend on a single user decision: has_own_van true or false.  Once the
 * user answers, all four results can be fetched immediately and atomically —
 * there are no intermediate choices required between them.  Splitting them
 * into separate user actions would force the user through an unnecessary
 * multi-step wizard for information the app can derive on its own.
 * Sequencing them in one async handler also makes error handling simpler:
 * a single try/catch covers the whole sequence, and if any call fails the
 * state is left in a consistent "nothing committed" state.
 *
 * ── Why SET_CURRENT_STEP is dispatched last ──────────────────────────────────
 * SET_CURRENT_STEP advances the app's view.  If it were dispatched before the
 * API calls completed, the panel would switch to the summary view while
 * frescosResult is still null — causing a flash of empty content or, worse,
 * a crash from trying to read .assigned_names on null.  Dispatching it last,
 * after all state slices are populated, guarantees the summary view has all
 * the data it needs on its very first render.
 */

import { useState } from 'react'
import { useAppState, ACTIONS } from '../../state/appState'
import {
  determineFrescos,
  determineSecondMiniflete,
  getRemainingPool,
  detectPersonalVehicle,
} from '../../api/endpoints'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

// ---------------------------------------------------------------------------
// Internal helper — derive Profesion strings from assigned names.
//
// get_remaining_pool() on the backend filters the staff list by exact Profesion
// match.  determine_frescos_vehicle() now returns employee names ("Juan García"),
// not role strings ("Manager Senior").  To bridge the gap we look up each
// assigned name in the full staff list to find their Profesion.
//
// This is better than hardcoding role strings in the frontend because:
//   - It stays correct even if Profesion values change (e.g. "Parrillero Senior"
//     vs "Jefe de Parrilla Senior").
//   - It draws from the actual data rather than assumptions.
// ---------------------------------------------------------------------------
function deriveProfesiones(assignedNames, staff) {
  return assignedNames
    .map((fullName) =>
      staff.find(
        (emp) => `${emp.Nombre} ${emp.Apellido}` === fullName,
      )?.Profesion,
    )
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// Sub-component: the question card (step 1)
// ---------------------------------------------------------------------------

function VanQuestion({ onAnswer, loading }) {
  return (
    <>
      <p className="text-sm font-medium text-foreground">
        ¿Está disponible el Vehículo QH?
      </p>
      <div className="flex gap-2 pt-1">
        <Button
          className="flex-1"
          onClick={() => onAnswer(true)}
          disabled={loading}
        >
          {loading === 'si' ? (
            // Inline spinner replaces the label of the active button only.
            // Using border-t-transparent on a rounded element produces the
            // standard CSS spinner without an external icon library.
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
          ) : (
            'Sí'
          )}
        </Button>
        <Button
          className="flex-1"
          variant="outline"
          onClick={() => onAnswer(false)}
          disabled={loading}
        >
          {loading === 'no' ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
          ) : (
            'No'
          )}
        </Button>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Sub-component: the result summary (step 2+)
// ---------------------------------------------------------------------------

function FrescosSummary({ frescosResult, secondMiniflete, remainingPool, personalVehicle }) {
  const hasVehicle = personalVehicle?.has_personal_vehicle
  const driver     = personalVehicle?.driver
  const carWarning = personalVehicle?.warning
  const poolStatus = remainingPool?.status

  return (
    <div className="space-y-3 text-sm">

      {/* Frescos vehicle */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Vehículo frescos
        </p>
        <p className="font-medium">
          {frescosResult.vehicle === 'camioneta propia'
            ? 'Vehículo QH'
            : 'Miniflete contratado'}
        </p>
        <p className="text-xs text-muted-foreground">
          {frescosResult.assigned_names.join(', ')}
        </p>
      </div>

      {/* Second miniflete */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Segundo miniflete
        </p>
        <p className={secondMiniflete.needs_second_miniflete ? 'font-medium text-amber-600' : 'text-muted-foreground'}>
          {secondMiniflete.needs_second_miniflete ? 'Sí requerido' : 'No requerido'}
        </p>
        <p className="text-xs text-muted-foreground">{secondMiniflete.reason}</p>
      </div>

      {/* Remaining pool */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Pool restante
        </p>
        {poolStatus === 'proceed' && (
          <p>{remainingPool.remaining_count} empleados para asignar</p>
        )}
        {poolStatus === 'charter' && (
          <p className="font-medium text-destructive">
            ⚠ Charter requerido ({remainingPool.remaining_count} personas)
          </p>
        )}
        {poolStatus === 'alternative' && (
          <p className="font-medium text-destructive">
            ⚠ Solo 1 persona — buscar alternativa (moto, baúl, etc.)
          </p>
        )}
      </div>

      {/* Personal vehicle */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Vehículo personal
        </p>
        {hasVehicle ? (
          <>
            <p>
              {driver.Nombre} {driver.Apellido} — {personalVehicle.vehicle_description}
            </p>
            {carWarning && (
              <p className="text-xs text-amber-600">{carWarning}</p>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">Sin vehículo personal</p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function FrescosPanel() {
  const { state, dispatch } = useAppState()

  // Local state tracks which button was clicked so only that button shows its
  // spinner.  "si" | "no" | null — null means idle.
  const [activeButton, setActiveButton] = useState(null)

  // Aliases for readability
  const event  = state.excelData?.event
  const staff  = state.excelData?.staff ?? []
  const done   = state.currentStep > 1

  async function handleAnswer(hasOwnVan) {
    setActiveButton(hasOwnVan ? 'si' : 'no')
    dispatch({ type: ACTIONS.SET_LOADING_STEP, payload: 'frescos' })
    dispatch({ type: ACTIONS.SET_ERROR,        payload: null })

    try {
      // ── 1. Determine frescos vehicle ────────────────────────────────────────
      // The backend reads staff from the Excel itself; we only send the flag.
      const frescosResult = await determineFrescos({ has_own_van: hasOwnVan })
      dispatch({ type: ACTIONS.SET_FRESCOS_RESULT, payload: frescosResult })

      // ── 2. Determine second miniflete ───────────────────────────────────────
      // The backend reads services from the Excel itself; no body needed.
      const secondMiniflete = await determineSecondMiniflete()
      dispatch({ type: ACTIONS.SET_SECOND_MINIFLETE, payload: secondMiniflete })

      // ── 3. Build remaining pool ─────────────────────────────────────────────
      // get_remaining_pool() filters by Profesion (exact string match).
      // frescosResult.assigned_names contains full employee names, not role
      // strings, so we look up each name in the staff list to get their
      // Profesion.  See deriveProfesiones() at the top of this file.
      const assignedRoles = deriveProfesiones(frescosResult.assigned_names, staff)
      const remainingPool = await getRemainingPool({ assigned_roles: assignedRoles })
      dispatch({ type: ACTIONS.SET_REMAINING_POOL, payload: remainingPool })

      // ── 4. Detect personal vehicle ──────────────────────────────────────────
      // Reads the full staff list on the backend — no body needed.
      const personalVehicle = await detectPersonalVehicle()
      dispatch({ type: ACTIONS.SET_PERSONAL_VEHICLE, payload: personalVehicle })

      // ── Advance step only after all data is populated ───────────────────────
      // Dispatching SET_CURRENT_STEP last ensures the summary view renders
      // with all four state slices already set — no flash of null content.
      dispatch({ type: ACTIONS.SET_LOADING_STEP,  payload: null })
      dispatch({ type: ACTIONS.SET_CURRENT_STEP,  payload: 2 })

    } catch (err) {
      dispatch({
        type:    ACTIONS.SET_ERROR,
        payload: err?.response?.data?.detail ??
                 err?.message ??
                 'Error al determinar el vehículo de frescos.',
      })
    } finally {
      setActiveButton(null)
    }
  }

  // Always render — the panel is visible at every step (question or summary).
  return (
    // Absolute positioning places the panel over the map without removing
    // it from the stacking context.  z-10 puts it above the map canvas
    // (z-index 0) but below future modals (z-20+) if we add them later.
    // pointer-events-auto is explicit here because AppMap's parent div does
    // not suppress pointer events, but it serves as documentation of intent.
    <div className="absolute top-4 left-4 z-10 w-72 pointer-events-auto">
      <Card className="shadow-lg">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Vehículo de Frescos</CardTitle>

          {/* Event context — gives the user a quick sanity check that they
              are looking at the right event before answering the question. */}
          {event && (
            <div className="space-y-0.5 text-xs text-muted-foreground">
              <p>{event.tipo} · {event.comensales} comensales</p>
              <p>{event.fecha} · {event.hora_inicio}</p>
            </div>
          )}
        </CardHeader>

        <CardContent className="pt-0 space-y-3">
          {done ? (
            // Summary view — shown once the sequence has completed.
            // All four state slices are guaranteed non-null here because
            // SET_CURRENT_STEP is only dispatched after all four succeed.
            <FrescosSummary
              frescosResult={state.frescosResult}
              secondMiniflete={state.secondMinifleteResult}
              remainingPool={state.remainingPool}
              personalVehicle={state.personalVehicle}
            />
          ) : (
            // Question view
            <VanQuestion
              onAnswer={handleAnswer}
              loading={activeButton}
            />
          )}

          {/* Inline error — displayed below the buttons without hiding the panel */}
          {state.error && !done && (
            <p className="text-xs text-destructive">{state.error}</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
