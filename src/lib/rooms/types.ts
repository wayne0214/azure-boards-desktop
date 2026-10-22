/** A Teamup sub-calendar; each one is a meeting room. */
export interface Room {
  id: number
  name: string
  color?: number
  active?: boolean
  readonly?: boolean
}

/** A Teamup event, trimmed to what the room view uses. Times carry the calendar's offset. */
export interface Booking {
  id: string
  version?: string
  subcalendar_ids: number[]
  title: string
  who?: string
  start_dt: string
  end_dt: string
  all_day: boolean
  /** Custom field values by field id, e.g. { type_of_meeting: ['external'] }. */
  custom?: Record<string, string[]>
}

/** A dropdown field on the calendar's events, e.g. "Type of meeting". */
export interface ChoiceField {
  id: string
  name: string
  choices: { id: string; name: string }[]
}

export interface NewBooking {
  subcalendar_ids: number[]
  title: string
  who: string
  start_dt: string
  end_dt: string
  all_day: false
  custom?: Record<string, string[]>
}
