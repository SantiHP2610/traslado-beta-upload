/**
 * UploadScreen.jsx
 * Full-screen upload gate shown before the map.
 *
 * Three ways to load an Excel file:
 *   A) Drag and drop onto the drop zone.
 *   B) File browser (hidden <input type="file">).
 *   C) "Usar Excel de prueba" — loads the bundled sample file.
 *
 * On successful upload, shows a brief event summary and a "Comenzar
 * planificación" button that dispatches SET_FILE_UPLOADED and hands off
 * to the map flow.
 *
 * Drop zone drag states:
 *   "idle"          — default, gray dashed border
 *   "valid-hover"   — blue border, "Soltá para cargar"
 *   "invalid-hover" — red border, "Solo archivos .xlsx o .xls"
 *   "loading"       — spinner, "Verificando archivo..."
 *   "success"       — green check, event summary, "Comenzar" button
 *   "error"         — red X, error message, "Intentar nuevamente" link
 */

import { useRef, useState, useEffect } from 'react'
import { Upload, FolderOpen,
         CheckCircle2, XCircle }       from 'lucide-react'
import { useAppState, ACTIONS }        from '../state/appState'
import { uploadExcel, getTestFiles, loadTestCase } from '../api/endpoints'
import { Button }                      from '@/components/ui/button'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel',                                          // .xls
])

function isValidFile(file) {
  if (!file) return false
  // Check MIME type first; fall back to name extension for edge cases where
  // the browser reports an empty or generic MIME type.
  if (VALID_MIMES.has(file.type)) return true
  const name = (file.name ?? '').toLowerCase()
  return name.endsWith('.xlsx') || name.endsWith('.xls')
}

function isValidDragItem(item) {
  if (!item) return null   // null = unknown
  if (VALID_MIMES.has(item.type)) return true
  if (item.type && item.type !== '') return false
  return null  // MIME unavailable during dragover — treat as unknown
}

function formatFecha(fecha) {
  if (!fecha) return null
  // openpyxl sometimes returns "YYYY-MM-DD 00:00:00" — trim the time part
  return typeof fecha === 'string' ? fecha.split(' ')[0] : fecha
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Spinner() {
  return (
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-blue-500" />
  )
}

function EventSummary({ summary }) {
  if (!summary) return null
  const fecha = formatFecha(summary.fecha)
  return (
    <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-left space-y-1">
      {summary.tipo && (
        <p className="text-sm font-medium text-green-900">{summary.tipo}</p>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-green-700">
        {fecha && <span>📅 {fecha}</span>}
        {summary.hora_inicio && <span>🕐 {summary.hora_inicio}</span>}
        {summary.comensales != null && (
          <span>👥 {summary.comensales} comensales</span>
        )}
        {summary.staff_count != null && (
          <span>👔 {summary.staff_count} en equipo</span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function UploadScreen() {
  const { dispatch } = useAppState()
  const fileInputRef  = useRef(null)

  // Upload flow state for the primary drop-zone / file-browser path
  const [dragState,    setDragState]    = useState('idle')
  const [errorMessage, setErrorMessage] = useState(null)
  const [successData,  setSuccessData]  = useState(null)

  // Test-case dropdown state — separate from the main drop-zone state machine
  const [testCases,         setTestCases]         = useState([])
  const [selectedTestFile,  setSelectedTestFile]  = useState('')
  const [testCaseLoading,   setTestCaseLoading]   = useState(false)
  const [testCaseError,     setTestCaseError]     = useState(null)

  // Load available test cases from the backend on mount.
  useEffect(() => {
    getTestFiles()
      .then((cases) => {
        setTestCases(cases)
        if (cases.length > 0) setSelectedTestFile(cases[0].filename)
      })
      .catch(() => {})   // non-critical — the section simply won't render
  }, [])

  // ── Core upload logic ────────────────────────────────────────────────────

  async function handleFile(file) {
    if (!isValidFile(file)) {
      setDragState('error')
      setErrorMessage('Solo se aceptan archivos .xlsx o .xls')
      return
    }
    setDragState('loading')
    setErrorMessage(null)
    try {
      const result = await uploadExcel(file)
      setSuccessData(result)
      setDragState('success')
    } catch (err) {
      const detail = err?.response?.data?.detail
      const msg = typeof detail === 'string'
        ? detail
        : (detail?.message ?? err?.message ?? 'Error al cargar el archivo.')
      setErrorMessage(msg)
      setDragState('error')
    }
  }

  function handleConfirm() {
    if (!successData) return
    dispatch({
      type:    ACTIONS.SET_FILE_UPLOADED,
      payload: { uploaded: true, summary: successData.event_summary ?? null },
    })
  }

  function handleReset() {
    setDragState('idle')
    setErrorMessage(null)
    setSuccessData(null)
  }

  // ── Drag events ──────────────────────────────────────────────────────────

  function onDragOver(e) {
    e.preventDefault()
    // Avoid flickering when already in a settled state
    if (dragState === 'loading' || dragState === 'success') return

    const item  = e.dataTransfer.items?.[0] ?? null
    const valid = isValidDragItem(item)
    // null = MIME unknown during dragover → show valid-hover optimistically
    setDragState(valid === false ? 'invalid-hover' : 'valid-hover')
  }

  function onDragLeave(e) {
    // Only reset if the pointer truly left the drop zone, not an inner element
    if (!e.currentTarget.contains(e.relatedTarget)) {
      if (dragState === 'valid-hover' || dragState === 'invalid-hover') {
        setDragState('idle')
      }
    }
  }

  function onDrop(e) {
    e.preventDefault()
    if (dragState === 'loading' || dragState === 'success') return
    const file = e.dataTransfer.files?.[0]
    handleFile(file)
  }

  // ── File browser ─────────────────────────────────────────────────────────

  function onFileSelected(e) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    // Reset input so the same file can be selected again after an error
    e.target.value = ''
  }

  // ── Test case loader ──────────────────────────────────────────────────────

  async function handleLoadTestCase() {
    if (!selectedTestFile) return
    setTestCaseLoading(true)
    setTestCaseError(null)
    try {
      const result = await loadTestCase(selectedTestFile)
      // Skip the upload-screen summary and go directly to map
      dispatch({
        type:    ACTIONS.SET_FILE_UPLOADED,
        payload: { uploaded: true, summary: result.event_summary ?? null },
      })
    } catch (err) {
      const detail = err?.response?.data?.detail
      setTestCaseError(
        typeof detail === 'string'
          ? detail
          : (err?.message ?? 'Error al cargar el archivo de prueba.')
      )
    } finally {
      setTestCaseLoading(false)
    }
  }

  // ── Drop zone visual config ───────────────────────────────────────────────

  const zoneStyles = {
    idle:           'border-gray-300 bg-gray-50',
    'valid-hover':  'border-blue-400 bg-blue-50',
    'invalid-hover':'border-red-400  bg-red-50',
    loading:        'border-blue-300 bg-blue-50',
    success:        'border-green-400 bg-green-50',
    error:          'border-red-400  bg-red-50',
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white px-4 py-12">

      {/* Header */}
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
          Plan de Traslado
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          Cargá el archivo Excel del evento para comenzar
        </p>
      </div>

      {/* Drop zone */}
      <div
        className={`
          relative flex w-full max-w-md cursor-pointer flex-col items-center justify-center
          gap-3 rounded-xl border-2 border-dashed px-8 py-14
          transition-colors duration-150
          ${zoneStyles[dragState] ?? zoneStyles.idle}
        `}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => {
          if (dragState === 'idle' || dragState === 'error') {
            fileInputRef.current?.click()
          }
        }}
      >
        {/* ── Idle ── */}
        {dragState === 'idle' && (
          <>
            <Upload className="h-10 w-10 text-gray-400" strokeWidth={1.5} />
            <p className="text-sm font-medium text-gray-600">
              Arrastrá el archivo Excel aquí
            </p>
            <p className="text-xs text-gray-400">o hacé clic para explorar</p>
          </>
        )}

        {/* ── Valid hover ── */}
        {dragState === 'valid-hover' && (
          <>
            <Upload className="h-10 w-10 text-blue-500" strokeWidth={1.5} />
            <p className="text-sm font-semibold text-blue-700">Soltá para cargar</p>
          </>
        )}

        {/* ── Invalid hover ── */}
        {dragState === 'invalid-hover' && (
          <>
            <XCircle className="h-10 w-10 text-red-500" />
            <p className="text-sm font-semibold text-red-700">
              Solo archivos .xlsx o .xls
            </p>
          </>
        )}

        {/* ── Loading ── */}
        {dragState === 'loading' && (
          <>
            <Spinner />
            <p className="text-sm font-medium text-blue-700">
              Verificando archivo...
            </p>
          </>
        )}

        {/* ── Success ── */}
        {dragState === 'success' && (
          <div
            className="w-full space-y-1 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <CheckCircle2 className="mx-auto h-10 w-10 text-green-500" />
            <p className="text-sm font-semibold text-green-800">
              Archivo cargado correctamente
            </p>
            <EventSummary summary={successData?.event_summary} />
          </div>
        )}

        {/* ── Error ── */}
        {dragState === 'error' && (
          <div
            className="w-full space-y-2 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <XCircle className="mx-auto h-10 w-10 text-red-500" />
            <p className="text-sm font-semibold text-red-700">
              No se pudo cargar el archivo
            </p>
            {errorMessage && (
              <p className="text-xs text-red-600">{errorMessage}</p>
            )}
            <button
              className="mt-1 text-xs text-blue-600 underline underline-offset-2 hover:text-blue-800"
              onClick={(e) => { e.stopPropagation(); handleReset() }}
            >
              Intentar nuevamente
            </button>
          </div>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={onFileSelected}
      />

      {/* ── Confirm button (visible after success) ── */}
      {dragState === 'success' && (
        <Button
          className="mt-5 w-full max-w-md text-sm"
          style={{ background: '#111827', color: '#fff' }}
          onClick={handleConfirm}
        >
          Comenzar planificación →
        </Button>
      )}

      {/* ── File browser + test file (hidden during loading/success) ── */}
      {dragState !== 'loading' && dragState !== 'success' && (
        <div className="mt-4 w-full max-w-md space-y-3">

          {/* File browser button */}
          <Button
            variant="outline"
            className="w-full gap-2 text-sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <FolderOpen className="h-4 w-4" />
            Examinar...
          </Button>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-gray-200" />
            <span className="text-xs text-gray-400">o</span>
            <div className="flex-1 border-t border-gray-200" />
          </div>

          {/* Test case dropdown — only shown when test cases loaded from backend */}
          {testCases.length > 0 && (
            <div className="space-y-2">
              <p className="text-center text-xs text-gray-400">o usá un caso de prueba</p>
              <div className="flex gap-2">
                <select
                  value={selectedTestFile}
                  onChange={(e) => setSelectedTestFile(e.target.value)}
                  disabled={testCaseLoading}
                  className="
                    flex-1 rounded border border-gray-200 bg-white px-2 py-1.5
                    text-xs text-gray-600
                    focus:border-blue-300 focus:outline-none
                    disabled:cursor-default disabled:opacity-50
                  "
                >
                  {testCases.map((tc) => (
                    <option key={tc.filename} value={tc.filename}>
                      {tc.label}
                    </option>
                  ))}
                </select>
                <button
                  disabled={testCaseLoading || !selectedTestFile}
                  onClick={handleLoadTestCase}
                  className="
                    rounded border border-gray-200 px-3 py-1.5
                    text-xs text-gray-600 transition-colors
                    hover:border-gray-300 hover:bg-gray-50
                    disabled:cursor-default disabled:opacity-50
                  "
                >
                  {testCaseLoading ? 'Cargando...' : 'Cargar'}
                </button>
              </div>
              {testCaseError && (
                <p className="text-xs text-red-600">{testCaseError}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
