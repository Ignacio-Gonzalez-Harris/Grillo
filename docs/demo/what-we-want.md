# What we want: the room booking app

> **Everything here is invented** (Quillfeather Tea Co., the Teacup Building, the rooms). This is the one sheet the
> demo cast answers from, so every run gets the same answers. When a question is not covered here, answer
> "not decided yet, keep it open" rather than inventing something new.

## Rooms

One building only: the Teacup Building. Four rooms; the office team can add a room or mark one closed for a period.

| Room | Floor | Seats | Equipment |
|---|---|---|---|
| Lighthouse | Ground | 12 | Big screen, video-call kit |
| Haystack | Ground | 6 | Whiteboard, small screen |
| Moonbeam | First | 4 | Whiteboard |
| Puddle | First | 2 | Phone-call corner, nothing else |

People can filter free rooms by seats and by equipment.

## Booking rules

- Bookings use **15-minute slots**, from 08:00 to 19:00, Monday to Friday, in the building's own time zone.
- **Shortest booking 15 minutes, longest 2 hours.** No exceptions in the first version.
- Book **up to 4 weeks ahead**.
- **Repeating bookings:** weekly only, for at most 8 weeks; then the person books again.
- **No-shows:** if nobody checks in within **10 minutes** of the start, the booking is released and the room is free.
  Check-in is a button in the app.
- **Double booking is impossible.** When two people book the same slot at once, one wins and the other sees a clear
  "already booked" message.
- Anyone can cancel their own booking up to the start time.

## Who may book

- **Every employee signed in with the company sign-in**, and nobody else. Leavers lose access when their company
  account ends.
- **Visitors and customers never book.** The employee who invites them books the room.
- The **office team** manages the room list and closures, and may cancel any booking (the owner is told why).
- Everyone sees which rooms are busy and who booked them.

## Integrations wanted

- **Company calendar: one-way.** A booking made in the app appears in the booker's calendar. Changes made in the
  calendar do not flow back in the first version.
- **Company chat tool:** a reminder 10 minutes before the start, and a message when a no-show releases a booking.
- **Usage export:** the office team downloads a spreadsheet file of room usage per week. No charts in the app.

## Platform

- **Hosting:** on the company's own servers, never an outside host.
- **Sign-in:** the company sign-in only; no separate passwords.
- **Reliability:** up during working hours (08:00 to 19:00, Monday to Friday) 99.5% of the time. Evenings and
  weekends may have planned downtime.
- **Backups:** every night, kept for 30 days; a restore is tested once a quarter.
- **History:** past bookings are kept for **12 months**, then deleted.

## Out of scope (first version)

- Tablets or screens at the room doors (a later version may add them).
- A separate phone app (the web page works on a phone).
- Catering or ordering anything with a room.
- Desk booking.
- Billing teams for room use.
- Visitor accounts or visitor sign-in.
- A second building or office.
- Two-way calendar sync.
