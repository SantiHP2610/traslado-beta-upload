/**
 * MeetingPointCard.jsx
 * Zone B — center-bottom floating card for step 3.
 *
 * Shows the confirmed meeting point (name + address) with a color that
 * signals whether the user chose the original PE (yellow) or a PEA
 * alternative (orange), matching the map marker colors from CLAUDE.md.
 *
 * Rendered as position:absolute inside the map area div so it floats over
 * the map without affecting the flex layout.  pointer-events:none keeps the
 * map fully interactive underneath.
 */

import { useAppState } from '../../state/appState'

export default function MeetingPointCard() {
  const { state } = useAppState()
  const { chosenMeetingPoint, meetingPoint } = state

  if (!chosenMeetingPoint) return null

  // PE = original meeting point; PEA = user chose a different candidate.
  const isPea = meetingPoint && chosenMeetingPoint.name !== meetingPoint.name

  return (
    <div
      style={{
        position:       'absolute',
        bottom:         28,
        left:           '50%',
        transform:      'translateX(-50%)',
        zIndex:         10,
        pointerEvents:  'none',
        width:          '60%',
        maxWidth:       360,
        minWidth:       240,
      }}
    >
      <div
        style={{
          background:   isPea ? 'rgba(255, 237, 213, 0.97)' : 'rgba(254, 249, 195, 0.97)',
          border:       `1.5px solid ${isPea ? '#f97316' : '#eab308'}`,
          borderRadius: 12,
          padding:      '10px 18px',
          boxShadow:    '0 4px 16px rgba(0,0,0,0.13)',
          textAlign:    'center',
        }}
      >
        <p
          style={{
            fontSize:      11,
            fontWeight:    700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color:         isPea ? '#c2410c' : '#854d0e',
            margin:        '0 0 4px',
          }}
        >
          {isPea ? 'Punto de encuentro alternativo (PEA)' : 'Punto de encuentro (PE)'}
        </p>
        <p style={{ fontSize: 15, fontWeight: 600, color: '#111827', margin: '0 0 3px' }}>
          {chosenMeetingPoint.name}
        </p>
        {chosenMeetingPoint.address && (
          <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
            {chosenMeetingPoint.address}
          </p>
        )}
      </div>
    </div>
  )
}
