/** A timed event on the phone that blocks time, from a calendar other than Zenflow's. */
export interface BusyEvent {
  /** Stable within the phone: `<calendar id>:<event id>`. */
  externalKey: string;
  title: string;
  start: Date;
  end: Date;
}
